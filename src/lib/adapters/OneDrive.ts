import CachingAdapter from './Caching'
import Logger from '../Logger'
import XbelSerializer from '../serializers/Xbel'
import Crypto from '../Crypto'
import Credentials from '../../../onedrive-api.credentials.json'
import {
  AuthenticationError,
  DecryptionError, FileUnreadableError,
  OneDriveAuthenticationError, HttpError, CancelledSyncError, MissingPermissionsError,
  NetworkError,
  ParseResponseError,
  OneDriveOAuthTokenError, ResourceLockedError, OneDriveSearchError, RequestTimeoutError
} from '../../errors/Error'
import { OAuth2Client } from '@byteowls/capacitor-oauth2'
import { Capacitor, CapacitorHttp as Http } from '@capacitor/core'
import { Folder, TItemLocation } from '../Tree'

declare const IS_BROWSER: boolean

// Microsoft OneDrive documentation
// https://learn.microsoft.com/en-us/onedrive/developer/?view=odsp-graph-online

const scopes = [
  'Files.ReadWrite', // Type: Delegated, Description: Have full access to user files
  'User.Read', // Type: Delegated, Description: Sign in and read user profile
  'offline_access', // Type: Delegated, Description: Maintain access to data you have given it access to
  'openid', // Type: Delegated, Description: Sign users in
  'profile', // Type: Delegated, Description: View users' basic profile
]
const oAuthBaseUrl = 'https://login.microsoftonline.com/common/oauth2/v2.0/'
const apiBaseUrl = 'https://graph.microsoft.com/v1.0/'
const origins = ['https://login.microsoftonline.com/', 'https://graph.microsoft.com/'];

const OAuthConfig = {
  authorizationBaseUrl: oAuthBaseUrl + '/authorize',
  accessTokenEndpoint: oAuthBaseUrl + '/token',
  scope: scopes.join(' '),
  resourceUrl: apiBaseUrl + '/me',
  logsEnabled: true,
  android: {
    appId: Credentials.android.client_id,
    responseType: 'code',
    redirectUrl: Credentials.android.redirect_uri // setup the same url in redirect urls in azure portal under mobile and desktop
  },
  ios: {
    appId: Credentials.ios.client_id,
    responseType: 'code',
    redirectUrl: Credentials.ios.redirect_uri
  }
}

interface CustomResponse {
  status: number,
  json(): Promise<any>,
  text(): Promise<string>,
}

type OneDriveTokenCache = {
  accessToken: string
  refreshToken?: string
  expiresAt: number
  scope?: string
}

declare const chrome: any

const LOCK_INTERVAL = 2 * 60 * 1000 // Lock every two minutes while syncing
const LOCK_TIMEOUT = 15 * 60 * 1000 // Override lock 15min after last time it was set
const HTTP_TIMEOUT = 60000
export default class OneDriveAdapter extends CachingAdapter {
  private initialTreeHash: string
  private fileId: string
  private accessToken: string
  private cancelCallback: () => void = null
  private alwaysUpload = false
  private lockingInterval: any
  private locked = false
  private lockingPromise: Promise<CustomResponse>
  private tokenCache: OneDriveTokenCache | null = null

  constructor(server) {
    super(server)
    this.server = server
  }

  /**
   * User authorizes webapp to make changes on your behalf
   * @param {boolean} interactive
   * @returns 
   */
  static async authorize(interactive = true) {
    if (!IS_BROWSER) {
      const result = await OAuth2Client.authenticate(OAuthConfig)
      const refresh_token = result.access_token_response.refresh_token
      const username = result.displayName
      return { refresh_token, username }
    } else {
      const browser = (await import('../browser-api')).default
      const { isOrion } = await browser.storage.local.get({ 'isOrion': false })
      if (!(await browser.permissions.contains({ origins })) && !isOrion) {
        throw new MissingPermissionsError()
      }

      const verifier = Crypto.base64UrlEncode(Crypto.getRandomBytes(32))
      const challenge = await Crypto.generatePKCECodeChallenge(verifier)
        
      const state = Crypto.bufferToHexstr(await Crypto.getRandomBytes(128)).substr(0, 64)
      const redirectURL = chrome.identity.getRedirectURL()
      let authURL = oAuthBaseUrl + '/authorize'
      authURL += `?client_id=${Credentials.web.client_id}`
      authURL += `&response_type=code`
      authURL += `&redirect_uri=${encodeURIComponent(redirectURL)}`
      authURL += `&scope=${encodeURIComponent(scopes.join(' '))}`
      authURL += `&code_challenge=${challenge}`
      authURL += `&code_challenge_method=S256`;
      authURL += `&state=${state}`
      authURL += `&prompt=consent`;

      const redirectResult = await browser.identity.launchWebAuthFlow({
        interactive,
        url: authURL
      })

      const m = redirectResult.match(/[#?](.*)/)
      if (!m || m.length < 1)
        return null
      const params = new URLSearchParams(m[1].split('#')[0])
      const code = params.get('code')
      const resState = params.get('state')

      if (!code) {
        throw new Error('Authorization failure')
      }
      if (resState !== state) {
        throw new Error('Authorization failure: State param does not match')
      }
        
      const response = await fetch(oAuthBaseUrl + '/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: `code=${code}` +
          `&client_id=${Credentials.web.client_id}` +
          `&redirect_uri=${encodeURIComponent(chrome.identity.getRedirectURL())}` +
          `&code_verifier=${verifier}` +
          '&grant_type=authorization_code'
      })

      if (response.status !== 200) {
        Logger.log('Failed to retrieve refresh token from Microsoft API: ' + await response.text())
        throw new OneDriveOAuthTokenError()
      }

      let json: any
      try {
        json = await response.json()
      } catch (e) {
        throw new ParseResponseError(e.message)
      }

      if (!json.access_token || !json.refresh_token) {
        Logger.log('Failed to retrieve refresh token from Microsoft API: ' + JSON.stringify(json))
        throw new OneDriveOAuthTokenError()
      }

      const res = await fetch(apiBaseUrl + '/me', {
        method: 'GET',
        headers: {
          Authorization: 'Bearer ' + json.access_token,
          'Content-Type': 'application/json'
        },
      })

      let about: any
      try {
        about = await res.json()
      } catch (e) {
        throw new ParseResponseError(e.message)
      }

      return { refresh_token: json.refresh_token, username: about.displayName }
    }
  }
    
  async getAccessToken(refreshToken: string) {
    // Try cache first
    const token = await this.loadToken()
    
    if (token && this.isTokenValid(token)) {
      Logger.log('OneDrive: using cached access token')
      return token.accessToken
    }

    Logger.log('OneDrive: refreshing access token')

    const platform = Capacitor.getPlatform()

    const response = await this.request('POST', oAuthBaseUrl + '/token',
      {
        refresh_token: refreshToken,
        client_id: Credentials[platform].client_id,
        grant_type: 'refresh_token',
      },
      'application/x-www-form-urlencoded'
    )

    if (response.status !== 200) {
      Logger.log('Failed to retrieve access token from Microsoft API: ' + await response.text())
      throw new OneDriveAuthenticationError()
    }

    let json: any
    try {
      json = await response.json()
    } catch (e) {
      throw new ParseResponseError(e.message)
    }

    if (json.access_token) {
      const expiresIn = json.expires_in || 3600

      const expiresAt = Date.now() + expiresIn * 1000 // Saving future time when it expires

      // Persist token
      await this.saveToken(json.access_token, json.refresh_token, expiresAt, json.scope)

      return json.access_token
    } else {
      throw new OneDriveOAuthTokenError()
    }
  }
    
  private isTokenValid(token: OneDriveTokenCache): boolean {
    const now = Date.now()
    return token.expiresAt > now + (5 * 60 * 1000) // 5 min safety margin
  }

    
  private async loadToken(): Promise<OneDriveTokenCache | null> {
    // return from memory cache if present
    if (this.tokenCache) {
      return this.tokenCache
    }

    // Browser extension storage
    if (IS_BROWSER) {
      const browser = (await import('../browser-api')).default
      const result = await browser.storage.local.get({ accounts: {} })

      // Getting token from account data
      const token = result.accounts?.[this.server.id]?.onedrive
      if (token) {
        this.tokenCache = token
        return token
      }

      return null
    }

    // Capacitor mobile/desktop storage
    try {
      const NativeAccountStorage = (await import('../native/NativeAccountStorage')).default
      const storage = new NativeAccountStorage(this.server.id)
      const accountData = await storage.getAccountData()

      const token = accountData?.onedrive
      if (token) {
        this.tokenCache = token
        return token
      }
    } catch {}

    return null
  }

  private async saveToken(
    accessToken: string,
    refreshToken: string | undefined,
    expiresAt: number,
    scope: string
  ) {
    const token: OneDriveTokenCache = {
      accessToken,
      refreshToken,
      expiresAt,
      scope
    }
    
    // Memory cache
    this.tokenCache = token

    // Browser extension
    if (IS_BROWSER) {
      this.server.onedrive = token
      const BrowserAccountStorage = (await import('../browser/BrowserAccountStorage')).default
      const storage = new BrowserAccountStorage(this.server.id)
      await storage.setAccountData(this.server, null)
      return
    }

    // Capacitor mobile/desktop
    try {
      const NativeAccountStorage = (await import('../native/NativeAccountStorage')).default
      const storage = new NativeAccountStorage(this.server.id)
      const data = (await storage.getAccountData()) || {}

      data.onedrive = token

      await storage.setAccountData(data, null)
    } catch {}
  }

  getLabel(): string {
    return this.server.label || 'OneDrive: ' + this.server.bookmark_file
  }

  static getDefaultValues() {
    return {
      type: 'onedrive',
      username: '',
      password: '',
      refreshToken: null,
      bookmark_file: 'bookmarks.xbel',
      allowNetwork: false,
    }
  }

  getUrl(): string {
    return apiBaseUrl
  }

  getLockFileName(): string { 
    return `.${this.server.bookmark_file}.lock`
  }

  timeout(ms) {
    return new Promise((resolve, reject) => {
      setTimeout(resolve, ms)
      this.cancelCallback = () => reject(new CancelledSyncError())
    })
  }
    
  async getBookmarksTree(): Promise<Folder<TItemLocation>> {
    // setHashSettings is called after onSyncStart only but before getBookmarksTree
    // thus we get the hash here again
    this.initialTreeHash = await this.bookmarksCache.hash(this.hashSettings)
    return super.getBookmarksTree()
  }

  /**
   * This method defines what should happen when sync starts.
   * @param {boolean} needLock If we need lock
   * @param {boolean} forceLock If lock needs to be forced
   * @returns 
   */
  async onSyncStart(needLock = true, forceLock = false) {
    Logger.log('onSyncStart: begin')

    if (IS_BROWSER) {
      const browser = (await import('../browser-api')).default
      let hasPermissions, error = false
      try {
        hasPermissions = await browser.permissions.contains({ origins })
      } catch (e) {
        error = true
        console.warn(e)
      }
      const { isOrion } = await browser.storage.local.get({ 'isOrion': false })
      if (!error && !hasPermissions && !isOrion) {
        throw new MissingPermissionsError()
      }
    }

    this.accessToken = await this.getAccessToken(this.server.refreshToken)

    const fileList = await this.listFiles(this.server.bookmark_file, 100)
    if (!fileList.value) {
      throw new OneDriveSearchError()
    }

    // In listFiles we get bookmarks.xbel and .bookmarks.xbel.lock, we need to remove files other than these
    const file = fileList.value.filter(file => !file.deleted && file.name !== this.getLockFileName())[0]
    
    const filesToDelete = fileList.value.filter(file => !file.deleted && file.name !== this.getLockFileName()).slice(1)
    for (const fileToDelete of filesToDelete) {
      try {
        await this.deleteFile(fileToDelete.id)
      } catch (e) {
        Logger.log('Failed to delete superfluous file: ' + e.message)
      }
    }

    if (file && file.id) {
      this.fileId = file.id
      
      // Make sure we have .bookmarks.xbel.lock file before proceeding
      await this.ensureLockFile()
      
      if (forceLock) {
        this.locked = await this.setLock()
      } else if (needLock) {
        const lockFileData = await this.getLock()
        const data = JSON.parse(lockFileData)
        const lockedDate = data?.locked
        if (data !== null && lockedDate !== false && lockedDate !== null) {
          if (!Number.isInteger(data)) {
            throw new ResourceLockedError()
          }
          if (Date.now() - data < LOCK_TIMEOUT) {
            throw new ResourceLockedError()
          }
        }
        this.locked = await this.setLock()
      }

      let xmlDocText = await this.downloadFile(this.fileId)
        
      if (this.server.password) {
        try {
          try {
            const json = JSON.parse(xmlDocText)
            xmlDocText = await Crypto.decryptAES(this.server.password, json.ciphertext, json.salt)
          } catch (e) {
            xmlDocText = await Crypto.decryptAES(this.server.password, xmlDocText, this.server.bookmark_file)
          }
        } catch (e) {
          if (xmlDocText && xmlDocText.includes('<?xml version="1.0" encoding="UTF-8"?>')) {
            // not encrypted, yet => noop
            this.alwaysUpload = true
          } else {
            throw new DecryptionError()
          }
        }
      }
      if (!xmlDocText || !xmlDocText.includes('<?xml version="1.0" encoding="UTF-8"?>')) {
        throw new FileUnreadableError()
      }

      /* let's get the highestId */
      const byNL = xmlDocText.split('\n')
      for (const line of byNL) {
        if (line.indexOf('<!--- highestId :') >= 0) {
          const idxStart = line.indexOf(':') + 1
          const idxEnd = line.lastIndexOf(':')

          this.highestId = parseInt(line.substring(idxStart, idxEnd))
          break
        }
      }

      this.bookmarksCache = XbelSerializer.deserialize(xmlDocText)
      if (this.lockingInterval) {
        clearInterval(this.lockingInterval)
      }
      if (needLock || forceLock) {
        this.lockingInterval = setInterval(() => this.setLock(), LOCK_INTERVAL) // Set lock every minute
      }
    } else {
      this.resetCache()
      this.alwaysUpload = true
    }

    this.initialTreeHash = await this.bookmarksCache.hash(this.hashSettings)

    Logger.log('onSyncStart: completed')

    if (!this.fileId) {
      // notify sync process that we should reset cache
      return false
    }
  }

  /**
   * This method defines what should happen when sync fails
   */
  async onSyncFail() {
    Logger.log('onSyncFail')
    if (this.fileId) {
      clearInterval(this.lockingInterval)
      if (this.locked) {
        await this.freeLock()
      }
    }
    this.fileId = null
  }

  /**
   * Gets XBEL content from bookmarks cache to create bookmarks.xbel file
   */
  async getXBELContent() {
    let xbel = createXBEL(this.bookmarksCache, this.highestId)

    if (this.server.password) {
      const salt = Crypto.bufferToHexstr(Crypto.getRandomBytes(64))
      const ciphertext = await Crypto.encryptAES(this.server.password, xbel, salt)
      xbel = JSON.stringify({ ciphertext, salt })
    }
    return xbel
  }

  /**
   * This method defines what should happen when sync completes
   */
  async onSyncComplete() {
    Logger.log('onSyncComplete')
    clearInterval(this.lockingInterval)

    this.bookmarksCache = this.bookmarksCache.clone(false)
    const newTreeHash = await this.bookmarksCache.hash(this.hashSettings)

    if (!this.fileId) {
      await this.createFile(await this.getXBELContent())
      this.fileId = null
      return
    }

    if (newTreeHash !== this.initialTreeHash || this.alwaysUpload) {
      await this.uploadFile(this.fileId, await this.getXBELContent())
      this.alwaysUpload = false // reset flag
    } else {
      Logger.log('No changes to the server version necessary')
    }
    await this.freeLock()
    this.fileId = null
  }

  cancel() {
    this.cancelCallback && this.cancelCallback()
  }

  /**
   * Wrapper method for all network calls
   * @param {string} method HTTP method
   * @param {string} url Url of API call
   * @param {any} body Body segment of API call
   * @param {string} contentType Determines how we want to send content to API
   * @returns {any} Response status, text and JSON
   */
  async request(method: string, url: string, body: any = null, contentType: string = null): Promise<CustomResponse> {
    return this.requestNative(method, url, body, contentType)
  }

  async requestWeb(method: string, url: string, body: any = null, contentType: string = null): Promise<CustomResponse> {
    let resp, timedOut = false
    try {
      resp = await Promise.race([
        fetch(url, {
          method,
          credentials: 'omit',
          headers: {
            ...(this.accessToken && { Authorization: 'Bearer ' + this.accessToken }),
            ...(contentType && { 'Content-type': contentType })
          },
          ...(body && { body }),
        }),
        new Promise((resolve, reject) =>
          setTimeout(() => {
            timedOut = true
            reject(new RequestTimeoutError())
          }, HTTP_TIMEOUT)
        )
      ])
    } catch (e) {
      Logger.log('Error Caught')
      Logger.log(e)
      if (timedOut) throw e
      throw new NetworkError()
    }
    if (resp.status === 401 || resp.status === 403) {
      Logger.log('Failed to authenticate to Microsoft Graph API: ' + await resp.text())
      throw new AuthenticationError()
    }
    return resp
  }

  /**
   * Makes API calls to Dropbox and returns errors/results
   * @param {string} method HTTP method
   * @param {string} url Url of API call
   * @param {any} body Body segment of API call
   * @param {string} contentType Determines how we want to send content to API
   * @returns {any} Response status, text and JSON
   */
  async requestNative(method: string, url: string, body: any = null, contentType: string = null): Promise<CustomResponse> {
    let res

    Logger.log(`FETCHING ${method} ${url}`)

    if (contentType === 'application/x-www-form-urlencoded') {
      const params = new URLSearchParams()
      for (const [key, value] of Object.entries(body || {})) {
        params.set(key, value as string)
      }
      body = params.toString()
    }

    try {
      res = await Http.request({
        url,
        method,
        headers: {
          ...(this.accessToken && { Authorization: 'Bearer ' + this.accessToken }),
          ...(contentType && { 'Content-type': contentType }),
        },
        responseType: 'text',
        ...(body && { data: body })
      })
    } catch (e) {
      Logger.log('Error Caught')
      Logger.log(e)
      throw new NetworkError()
    }

    Logger.log(`Receiving response for ${method} ${url}`)

    if (res.status === 401) {
      Logger.log('Failed to authenticate to Microsoft Graph API: ' + JSON.stringify(res.data))
      throw new AuthenticationError()
    }

    if (res.status === 403) {
      Logger.log('Microsoft Graph API error: ' + JSON.stringify(res.data))
      throw new HttpError(res.status, method)
    }

    if (res.status >= 500) {
      Logger.log('Microsoft Graph API error: ' + JSON.stringify(res.data))
      throw new HttpError(res.status, method)
    }

    return {
      status: res.status,
      json: () => Promise.resolve(res.data),
      text: () => Promise.resolve(res.data),
    }
  }

  /**
   * Searches files on OneDrive matching query
   * @param {string} query Search query to get files from OneDrive
   * @param {number} limit Limits count of files to return
   * @returns {any} JSON list of files
   */
  async listFiles(query: string, limit = 1): Promise<any> {
    const res = await this.request('GET', this.getUrl() + `/me/drive/root/search(q='${encodeURIComponent(query)}')?$select=id,name,size,lastModifiedDateTime,deleted,description&$orderby=lastModifiedDateTime%20desc&stop=${limit}`)
    if (res.status >= 400) {
      Logger.log('Microsoft Graph API error: ' + JSON.stringify(res.text()))
      throw new HttpError(res.status, 'GET')
    }
    let json = await res.json()
      
    // When search returned results
    if (json.value && json.value.length > 0) {
      return json
    }

    // When search returned no results
    // Fallback: lookup by path
    // This is needed because while running test cases we are hitting Microsoft Graph API so many times
    // When we create/update a file then within a second or two if we try to search for the same file then
    // we wont get the result, so at that time only lookup up path works.
    // Search results will eventually be correct and it takes 2-3 seconds for OneDrive to sync metadata
    // In regular usage we probably wont hit with this limitation
    try {
      const pathRes = await this.request(
        'GET',
        this.getUrl() + `/me/drive/root:/${query}?$select=id,name,size,lastModifiedDateTime,deleted,description`
      )

      if (pathRes.status === 200) {
        const file = await pathRes.json()

        Logger.log('Graph search miss, recovered via path lookup')

        return {
          value: [file], // Make it as search result
        }
      }
    } catch (_) {}

    return { value: [] }
  }

  /**
   * Downloads file (In our case bookmarks.xbel)
   * @param {string} id File id as in OneDrive
   * @returns {string} File contents
   */
  async downloadFile(id: string): Promise<string> {
    const res = await this.request('GET', this.getUrl() + `/me/drive/items/${id}/content`)

    if (res.status >= 400) {
      Logger.log('Microsoft Graph API error: ' + JSON.stringify(res.text()))
      throw new HttpError(res.status, 'GET')
    }

    return res.text()
  }

  /**
   * Delete file on OneDrive using file id
   * @param {string} id A unique file identifier
   * @returns {boolean} true if 204 and false if other HTTP status
   */
  async deleteFile(id: string): Promise<any> {
    const res = await this.request('DELETE', this.getUrl() + `/me/drive/items/${id}`)
    if (res.status >= 400) {
      Logger.log('Microsoft Graph API error: ' + JSON.stringify(res.text()))
      throw new HttpError(res.status, 'DELETE')
    }

    return res.status === 204
  }
    
  /**
   * In OneDrive there is no easy concept of custom properties.
   * Well there is custom properties (preview)
   * https://learn.microsoft.com/en-us/onedrive/developer/rest-api/concepts/custom-metadata-facets?view=odsp-graph-online
   * This method requires us to mail onedrive people to setup our schema and then update it.
   * It seems lot of effort for soo little result. Moreover its only for personal accounts.
   * For our case we expect that this addon works for people with all sorts of accounts.
   * We can use description property to have custom property but we never know if anything else will update it.
   * Moreover its available for personal account only.
   * We can also use tags but those are not exactly meant for this kind of utility.
   * So we used .<bookmark_file>.lock file in root directory which has `locked` property as json.
   * From here its pretty simple, whenver we need to lock we will update and to check we get this file
   * and check its content, no need to get metadata of any file. Reading this file is sufficient to get locked status
   * @returns {boolean} true if 201 or 200 and false if other HTTP status
   */
  async ensureLockFile(): Promise<boolean> {
    // Check if file exists
    const check = await this.request(
      'GET',
      this.getUrl() + `/me/drive/root:/${this.getLockFileName()}`
    )

    if (check.status === 404) {
      // Create lock file
      const content = JSON.stringify({ locked: null })

      const create = await this.request(
        'PUT',
        this.getUrl() + `/me/drive/root:/${this.getLockFileName()}:/content`,
        content,
        'application/json'
      )
      
      return create.status === 200 || create.status === 201
    }

    if (check.status >= 400) {
      Logger.log('Microsoft Graph API error: ' + JSON.stringify(check.text()))
      throw new HttpError(check.status, 'GET')
    }

    return true
  }
    
  /**
   * Get the lock status of floccus.
   * Here we get status based on .<bookmark_file>.lock file in root directory.
   * The contents will have `locked` property with date as number if locked else `null` and `false` if lock is released 
   * @returns {number| null | boolean} Returns number if locked, null if first run and false if lock is released
   */
  async getLock(): Promise<any> {
    try {
      const res = await this.request(
        'GET',
        this.getUrl() + `/me/drive/root:/${this.getLockFileName()}:/content`,
        null,
        'application/json'
      )
        
      if (res.status >= 400) {
        Logger.log('Microsoft Graph API error: ' + JSON.stringify(res.text()))
        throw new HttpError(res.status, 'GET')
      }

      const data = await res.json()

      return data
    } catch {
      return null
    }
  }

  /**
   * Sets lock on bookmarks.xbel file so that file tampering don't happen
   * Sets lock using .<bookmarks_file>.lock file with contents `locked` with date as number
   * to indicate maximum duration of lock. Once sync completes lock is reset to false
   * @returns {boolean} True if lock set on on .<bookmarks_file>.lock file and false if not
   */
  async setLock() {
    const res = await this.request('PUT', this.getUrl() + `/me/drive/root:/${this.getLockFileName()}:/content`,
      JSON.stringify({ locked: Date.now() }),
      'application/json'
    )
    if (res.status >= 400) {
      Logger.log('Microsoft Graph API error: ' + JSON.stringify(res.text()))
      throw new HttpError(res.status, 'PUT')
    }

    return res.status === 201
  }

  /**
   * Free up lock on .<bookmark_file>.lock file so that file editing can happen again
   * @returns {boolean} True if lock is set on .<bookmark_file>.lock file and false if not
   */
  async freeLock() {
    if (this.lockingPromise) {
      await this.lockingPromise
    }
    let lockFreed, i = 0
      do {
      const res = await this.request('PUT', this.getUrl() + `/me/drive/root:/${this.getLockFileName()}:/content`,
        JSON.stringify({ locked: false }),
        'application/json'
      )

      if (res.status >= 400) {
        Logger.log('Microsoft Graph API error: ' + JSON.stringify(res.text()))
        throw new HttpError(res.status, 'PUT')
      }

      lockFreed = res.status === 200 || res.status === 201
      if (!lockFreed) {
        await this.timeout(1000)
      }
      i++
    } while (!lockFreed && i < 10)
    return lockFreed
  }

  /**
   * Create bookmarks.xbel file
   * This happens when the profile is created
   * @param {string} xbel XBEL content to create bookmarks.xbel file
   * @returns 
   */
  async createFile(xbel: string) {
    const res = await this.request('PUT', this.getUrl() + `/me/drive/root:/${encodeURIComponent(this.server.bookmark_file)}:/content`,
      xbel,
      'application/xml'
    )

    if (res.status !== 200 && res.status !== 201) {
      Logger.log('Microsoft Graph API error: ' + JSON.stringify(res.text()))
      throw new HttpError(res.status, 'PUT')
    }

    const file = await res.json()
    this.fileId = file.id

    return res.status === 200 || res.status === 201
  }

  /**
   * Uploads bookmarks.xml file to OneDrive
   * This happens in subsequent syncs when we add/remove bookmarks in browser
   * @param {string} id A unique file identifier
   * @param {string} xbel Content of XML file
   * @returns {boolean} True if file is upload and false if not
   */
  async uploadFile(id: string, xbel: string) {
    const res = await this.request('PUT', this.getUrl() + `/me/drive/items/${id}/content`,
      xbel,
      'application/xml'
    )

    if (res.status >= 400) {
      Logger.log('Microsoft Graph API error: ' + JSON.stringify(res.text()))
      throw new HttpError(res.status, 'POST')
    }

    const file = await res.json()
    this.fileId = file.id

    return res.status === 200 || res.status === 201
  }
}

/**
 * Creates XBEL content for bookmarks.xml file
 * @param {any} rootFolder 
 * @param {any} highestId 
 * @returns {string} XML content for bookmarks.xml file
 */
function createXBEL(rootFolder, highestId) {
  let output = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE xbel PUBLIC "+//IDN python.org//DTD XML Bookmark Exchange Language 1.0//EN//XML" "http://pyxml.sourceforge.net/topics/dtds/xbel.dtd">
<xbel version="1.0">
`

  output +=
    '<!--- highestId :' +
    highestId +
    `: for Floccus bookmark sync browser extension -->
`

  output += XbelSerializer.serialize(rootFolder)

  output += `
</xbel>`

  return output
}