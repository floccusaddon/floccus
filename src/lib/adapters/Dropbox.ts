import CachingAdapter from './Caching'
import Logger from '../Logger'
import XbelSerializer from '../serializers/Xbel'
import Crypto from '../Crypto'
import Credentials from '../../../dropbox-api.credentials.json'
import {
  AuthenticationError,
  DecryptionError, FileUnreadableError,
  DropboxAuthenticationError, HttpError, CancelledSyncError, MissingPermissionsError,
  NetworkError,
  DropboxOAuthTokenError, ResourceLockedError, RequestTimeoutError,
  DropboxSearchError,
  DropboxTemplateError,
  ParseResponseError,
} from '../../errors/Error'
import { OAuth2Client } from '@byteowls/capacitor-oauth2'
import { Capacitor, CapacitorHttp as Http } from '@capacitor/core'
import { Folder, TItemLocation } from '../Tree'

declare const IS_BROWSER: boolean

// Dropbox API Reference
// https://www.dropbox.com/developers/documentation/http/documentation

const scopes = [
  'files.content.write', // upload, create files
  'sharing.read', // get account details like email and display name
  'files.content.read', // download files
  'files.metadata.write', // get and set custom properties (property_groups) like locked and templates for users
  'account_info.read' // View basic information about your Dropbox account such as your username, email, and country
]
const oAuthBaseUrl = 'https://www.dropbox.com/oauth2'
const apiBaseUrl = 'https://api.dropboxapi.com/2'
const contentUrl = 'https://content.dropboxapi.com/2' // for download, create and upload files
const origins = ['https://www.dropbox.com/', 'https://api.dropboxapi.com/', 'https://content.dropboxapi.com/']

const templateIdRegex = /ptid:[0-9A-Za-z]+/gi

const OAuthConfig = {
  authorizationBaseUrl: oAuthBaseUrl + '/authorize',
  accessTokenEndpoint: oAuthBaseUrl + '/token',
  scope: scopes.join(' '),
  resourceUrl: null, // Dropbox uses POST method for getting account data but capacitor OAuth plugin uses GET
  logsEnabled: true,
  additionalParameters: {
    token_access_type: 'offline' //  Required to get refresh token
  },
  android: {
    appId: Credentials.android.client_id,
    responseType: 'code',
    redirectUrl: Credentials.android.redirect_uri,
    pkceEnabled: true,
    logsEnabled: true
  },
  ios: {
    appId: Credentials.ios.client_id,
    responseType: 'code',
    redirectUrl: 'org.handmadeideas.floccus:/',
    pkceEnabled: true,
    logsEnabled: true
  }
}

interface CustomResponse {
  status: number,
  json(): Promise<any>,
  text(): Promise<string>,
}

declare const chrome: any

const LOCK_INTERVAL = 2 * 60 * 1000 // Lock every two minutes while syncing
const LOCK_TIMEOUT = 15 * 60 * 1000 // Override lock 15min after last time it was set
const HTTP_TIMEOUT = 60000
export default class DropboxAdapter extends CachingAdapter {
  private initialTreeHash: string
  private fileId: string
  private templateId: string
  private accessToken: string
  private cancelCallback: () => void = null
  private alwaysUpload = false
  private lockingInterval: any
  private locked = false
  private lockingPromise: Promise<CustomResponse>

  constructor(server) {
    super(server)
    this.server = server
  }

  static async authorize(interactive = true) {
    if (!IS_BROWSER) {
      const result = await OAuth2Client.authenticate(OAuthConfig)
      const refresh_token = result.access_token_response.refresh_token

      // User details from Dropbox should be made using a POST request
      // Capacitor OAuth plugin supports only GET so handling details request separately
      const res = await fetch(apiBaseUrl + '/users/get_account', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + result.access_token_response.access_token,
          'Content-Type': 'application/json'
        },
        body: Capacitor.getPlatform() === 'ios'
          ? JSON.stringify({account_id: result.access_token_response.account_id})
          : JSON.stringify({account_id: result.access_token_response.additionalParameters.account_id})
      })

      if (res.status !== 200) {
        Logger.log('Failed to retrieve user information from Dropbox API: ' + JSON.stringify(await res.text()))
        throw new HttpError(res.status, 'POST')
      }

      let about: any
      try {
        about = await res.json()
      } catch (e) {
        throw new ParseResponseError(e.message)
      }

      return { refresh_token, username: about.name.display_name }
    } else {
      const browser = (await import('../browser-api')).default
      const { isOrion } = await browser.storage.local.get({ 'isOrion': false })
      if (!(await browser.permissions.contains({ origins })) && !isOrion) {
        throw new MissingPermissionsError()
      }

      const challenge = Crypto.bufferToHexstr(await Crypto.getRandomBytes(128)).substr(0, 128)
      const state = Crypto.bufferToHexstr(await Crypto.getRandomBytes(128)).substr(0, 64)
      const redirectURL = chrome.identity.getRedirectURL()
      let authURL = oAuthBaseUrl + '/authorize'
      authURL += `?client_id=${Credentials.web.client_id}`
      authURL += `&response_type=code`
      authURL += `&redirect_uri=${encodeURIComponent(redirectURL)}`
      authURL += `&scope=${encodeURIComponent(scopes.join(' '))}`
      authURL += `&approval_prompt=force`
      authURL += `&token_access_type=offline`
      authURL += `&code_challenge=${challenge}`
      authURL += `&state=${state}`

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
          `&code_verifier=${challenge}` +
          '&grant_type=authorization_code'
      })

      if (response.status !== 200) {
        Logger.log('Failed to retrieve refresh token from Dropbox API: ' + await response.text())
        throw new DropboxOAuthTokenError()
      }
      let json:any
      try {
        json = await response.json()
      } catch (e) {
        throw new ParseResponseError(e.message)
      }

      if (!json.access_token || !json.refresh_token) {
        Logger.log('Failed to retrieve refresh token from Dropbox API: ' + JSON.stringify(json))
        throw new DropboxOAuthTokenError()
      }

      const res = await fetch(apiBaseUrl + '/users/get_account', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + json.access_token,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({account_id: json.account_id})
      })

      if (res.status !== 200) {
        Logger.log('Failed to retrieve user information from Dropbox API: ' + JSON.stringify(await res.text()))
        throw new HttpError(res.status, 'POST')
      }

      let about: any
      try {
        about = await res.json()
      } catch (e) {
        throw new ParseResponseError(e.message)
      }

      return { refresh_token: json.refresh_token, username: about.name.display_name }
    }
  }

  /**
   * Authorizes webapp for subsequent requests to make changes on behalf of user
   * This method gets access token which can be used for subsequent requests to Dropbox API
   * @param {string} refreshToken A token used to get access token to authenticate on subsequent requests
   * @returns
   */
  async getAccessToken(refreshToken:string) {
    const response = await this.request('POST', oAuthBaseUrl + '/token',
      {
        refresh_token: refreshToken,
        client_id: Credentials[Capacitor.getPlatform()].client_id,
        grant_type: 'refresh_token',
      },
      'application/x-www-form-urlencoded'
    )

    if (response.status !== 200) {
      Logger.log('Failed to retrieve access token from Dropbox API: ' + await response.text())
      throw new DropboxAuthenticationError()
    }

    let json:any
    try {
      json = await response.json()
    } catch (e) {
      throw new ParseResponseError(e.message)
    }

    if (json.access_token) {
      return json.access_token
    } else {
      throw new DropboxOAuthTokenError()
    }
  }

  getLabel():string {
    return this.server.label || 'Dropbox: ' + this.server.bookmark_file
  }

  static getDefaultValues() {
    return {
      type: 'dropbox',
      username: '',
      password: '',
      refreshToken: null,
      bookmark_file: 'bookmarks.xbel',
      allowNetwork: false,
    }
  }

  getUrl() :string {
    return apiBaseUrl
  }

  getContentUrl() :string {
    return contentUrl
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
      const {isOrion} = await browser.storage.local.get({'isOrion': false})
      if (!error && !hasPermissions && !isOrion) {
        throw new MissingPermissionsError()
      }
    }

    this.accessToken = await this.getAccessToken(this.server.refreshToken)

    let fileList
    for (let i = 0; i < 3; i++) {
      fileList = await this.listFiles(this.server.bookmark_file, 100)
      if (!fileList.matches) {
        throw new DropboxSearchError()
      }
      if (fileList.matches.length > 0) {
        break
      }
      // Try again 2 times after 2 seconds if the first time didn't yield anything
      // as not all dropbox servers may know about the file yet (mostly useful for CI)
      await this.timeout(2000)
    }

    const file = fileList.matches[0]

    const filesToDelete = fileList.matches.slice(1)
    for (const fileToDelete of filesToDelete) {
      try {
        await this.deleteFile(fileToDelete.metadata.metadata.id)
      } catch (e) {
        Logger.log('Failed to delete superfluous file: ' + e.message)
      }
    }
    if (file && file.metadata.metadata.id) {
      this.fileId = file.metadata.metadata.id

      // Get Floccus templateId for user or add one if not exists
      await this.setupTemplate()

      if (forceLock) {
        this.locked = await this.setLock(this.fileId)
      } else if (needLock) {
        const data = await this.getFileMetadata(this.fileId)
        // Here we know that we are trying to get property for "locked" as we set template_id to search for the same.
        // The value is either empty or epoch date as string
        const lockedValue = data?.property_groups?.[0]?.fields?.[0]?.value
        if (lockedValue !== '' && lockedValue !== undefined) {
          const lockedDate = parseInt(lockedValue)
          if (!Number.isInteger(lockedDate)) {
            throw new ResourceLockedError()
          }
          if (Date.now() - lockedDate < LOCK_TIMEOUT) {
            throw new ResourceLockedError()
          }
        }
        this.locked = await this.setLock(this.fileId)
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
        this.lockingInterval = setInterval(() => this.setLock(this.fileId), LOCK_INTERVAL) // Set lock every minute
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
        await this.freeLock(this.fileId)
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
      xbel = JSON.stringify({ciphertext, salt})
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
      await this.createFile(await this.getXBELContent(), this.server.bookmark_file)
      this.fileId = null
      return
    }

    if (newTreeHash !== this.initialTreeHash || this.alwaysUpload) {
      await this.uploadFile(this.fileId, await this.getXBELContent())
      this.alwaysUpload = false // reset flag
    } else {
      Logger.log('No changes to the server version necessary')
    }
    await this.freeLock(this.fileId)
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
   * @param {any} extraHeaders Object consisting on headers necessary to download files
   * @returns {any} Response status, text and JSON
   */
  async request(method: string, url: string, body: any = null, contentType: string = null, extraHeaders: any = null) : Promise<CustomResponse> {
    return this.requestNative(method, url, body, contentType, extraHeaders)
  }

  async requestWeb(method: string, url: string, body: any = null, contentType: string = null) : Promise<CustomResponse> {
    let resp, timedOut = false
    try {
      resp = await Promise.race([
        fetch(url, {
          method,
          credentials: 'omit',
          headers: {
            ...(this.accessToken && {Authorization: 'Bearer ' + this.accessToken}),
            ...(contentType && {'Content-type': contentType})
          },
          ...(body && {body}),
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
      Logger.log('Failed to authenticate to Dropbox API: ' + await resp.text())
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
   * @param {any} extraHeaders Object consisting on headers necessary to download files
   * @returns {any} Response status, text and JSON
   */
  async requestNative(method: string, url: string, body: any = null, contentType: string = null, extraHeaders: any = null) : Promise<CustomResponse> {
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
          ...(this.accessToken && {Authorization: 'Bearer ' + this.accessToken}),
          ...(contentType && {'Content-type': contentType}),
          ...extraHeaders
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
      Logger.log('Failed to authenticate to Dropbox API: ' + JSON.stringify(res.data))
      throw new AuthenticationError()
    }

    if (res.status === 403) {
      Logger.log('Dropbox API error: ' + JSON.stringify(res.data))
      throw new HttpError(res.status, method)
    }

    if (res.status >= 500) {
      Logger.log('Dropbox API error: ' + JSON.stringify(res.data))
      throw new HttpError(res.status, method)
    }

    return {
      status: res.status,
      json: () => Promise.resolve(res.data),
      text: () => Promise.resolve(res.data),
    }
  }

  /**
   * Searches files on dropbox matching query
   * It could be lot better if we get custom property (locked) on this call itself.
   * But with Dropbox API architecture we have to go through many steps to get to same result.
   * @param {string} query Search query to get files from Dropbox
   * @param {number} limit Limits count of files to return
   * @returns {any} JSON list of files
   */
  async listFiles(query: string, limit = 1) : Promise<any> {
    const res = await this.request('POST', this.getUrl() + `/files/search_v2?`,
      {
        'match_field_options': {
          'include_highlights': false
        },
        'options': {
          'file_status': 'active',
          'filename_only': false,
          'max_results': limit,
          'path': ''
        },
        'query': query
      },
      'application/json'
    )
    if (res.status >= 400) {
      Logger.log('Dropbox API error: ' + JSON.stringify(await res.text()))
      throw new HttpError(res.status, 'POST')
    }
    const json = await res.json()

    return json
  }

  /**
   * Gets file metadata for bookmarks.xbel file using existing template_id for the logged in user
   * @param {string} id A unique file identifier
   * @returns {any} JSON format data with file metadata
   */
  async getFileMetadata(id: string): Promise<any> {
    const res = await this.request('POST', this.getUrl() + `/files/get_metadata`,
      {
        'include_deleted': false,
        'include_has_explicit_shared_members': false,
        'include_media_info': false,
        'path': id,
        'include_property_groups': {
          '.tag': 'filter_some',
          'filter_some': [this.templateId]
        }
      },
      'application/json'
    )
    if (res.status >= 400) {
      Logger.log('Dropbox API error: ' + JSON.stringify(await res.text()))
      throw new HttpError(res.status, 'POST')
    }

    const json = await res.json()

    return json
  }

  /**
   * Download a file from Dropbox.
   *
   * Platform notes:
   * - iOS (Capacitor native):
   *   Uses fetch with an explicit empty body and `Connection: close`
   *   to avoid NSURLSession connection reuse issues (CFNetwork -1005).
   *
   * - Android (Capacitor native):
   *   Uses Capacitor Http with a special Content-Type to prevent 400 errors
   *   on empty POST requests.
   *
   * - Web:
   *   Uses the existing request helper.
   *
   * @param path Dropbox file path or id (e.g. "id:0_462PHa1owAAAAAAABDAg")
   * @returns File content as string
   */
  async downloadFile(path: string): Promise<string> {
    const url = this.getContentUrl() + `/files/download`
    const platform = Capacitor.getPlatform()

    // ========= iOS (Capacitor native) =========
    if (platform === 'ios' && !IS_BROWSER) {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Dropbox-API-Arg': JSON.stringify({ path }),
          'Content-Type': 'application/octet-stream',
          'Connection': 'close',
          'Cache-Control': 'no-cache',
        },
        // Important: forces a new upload task and prevents
        // NSURLSession connection reuse
        body: new Uint8Array(0),
      })

      if (res.status >= 400) {
        Logger.log('Dropbox API error: ' + JSON.stringify(await res.text()))
        throw new HttpError(res.status, 'POST')
      }

      return await res.text()
    }

    // ========= Android (Capacitor native) =========
    if (!IS_BROWSER) {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Dropbox-API-Arg': JSON.stringify({ path }),
          Accept: 'application/octet-stream'
        },
        body: new Uint8Array(0) // empty body prevents 400 error
      })

      if (res.status >= 400) {
        Logger.log('Dropbox API error: ' + JSON.stringify(await res.text()))
        throw new HttpError(res.status, 'POST')
      }

      // Decode binary response into string
      const buffer = await res.arrayBuffer()
      return new TextDecoder().decode(buffer)
    }

    // ========= Web / Browser =========
    const extraHeaders = {
      'Dropbox-API-Arg': JSON.stringify({ path }),
    }

    const res = await this.request('POST', url, null, null, extraHeaders)

    if (res.status >= 400) {
      Logger.log('Dropbox API error: ' + JSON.stringify(await res.text()))
      throw new HttpError(res.status, 'POST')
    }

    return await res.text()
  }

  /**
   * Delete file on Dropbox using file id
   * @param {string} id A unique file identifier
   * @returns {boolean} true if 200 and false if other HTTP status
   */
  async deleteFile(id: string): Promise<any> {
    const res = await this.request('POST', this.getUrl() + `/files/delete_v2`,
      { 'path': id },
      'application/json'
    )
    if (res.status >= 400) {
      Logger.log('Dropbox API error: ' + JSON.stringify(await res.text()))
      throw new HttpError(res.status, 'POST')
    }

    return res.status === 200
  }

  /**
   * Get template Id or create a new ones if not exists for setting up custom properties for files
   * A template for locking custom property is created once per user and we can reuse it in subsequent syncs
   */
  async setupTemplate() {
    // Checking if Floccus templateId is present in memory and matches Dropbox template pattern
    const templateIdMatches = templateIdRegex.test(this.templateId)

    if (!templateIdMatches) {
      // case where this.templateId doesn't exists and we need to get template_id from Dropbox
      try {
        await this.getTemplateId()
        Logger.log(`Floccus templateId for current User: ${this.templateId}`)
      } catch (e) {
        Logger.log('Failed to retrieve template id on Dropbox for user: ' + e.message)
        throw new DropboxTemplateError()
      }
    }
  }

  /**
   * Adds template to add 'locked' property to files
   *
   * A template needs to be added before we can add property groups to files
   * used lock_file_batch API call for locking but its giving error such as not supported by user as it is a business feature,
   * so reverting to custom user properties to determine lock status
   *
   * Getting/Setting up template for locked custom property is one off so its done only once per user.
   * All the subsequent times we can use this.templateId, if in case its not available then we have to call Dropbox API
   *
   * Number property isn't supported by Dropbox API in type
   * @returns {string} JSON value of template added
   */
  async addTemplate(): Promise<any> {
    const res = await this.request('POST', this.getUrl() + `/file_properties/templates/add_for_user`,
      {
        'description': 'These properties describe Floccus app properties',
        'fields': [
          {
            'description': 'Locked property',
            'name': 'locked',
            'type': 'string'
          }
        ],
        'name': 'locked'
      },
      'application/json'
    )
    if (res.status >= 400) {
      Logger.log('Dropbox API error: ' + JSON.stringify(await res.text()))
      throw new HttpError(res.status, 'POST')
    }

    const json = await res.json()

    return json
  }

  /**
   * Gets template id's from Dropbox specific to logged in user
   * @returns {string[]} A list of template_id's
   */
  async getTemplates(): Promise<string[]> {
    const url = this.getUrl() + `/file_properties/templates/list_for_user`
    let res
    let json
    // Mobile (Capacitor native)
    if (!IS_BROWSER) {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + this.accessToken,
          'Content-Type': 'text/plain; charset=dropbox-cors-hack'
        },
        body: 'null' // Dropbox needs this even if undocumented
      })
      json = JSON.parse(await res.text())
    } else {
      // Web
      res = await this.request('POST', url)
      json = await res.json()
    }
    if (res.status >= 400) {
      Logger.log('Dropbox API error: ' + JSON.stringify(await res.text()))
      throw new HttpError(res.status, 'POST')
    }
    return json.template_ids
  }

  /**
   * Gets template from Dropbox based on template_id
   * @param {string} templateId A unique template identifier
   * @returns {string} JSON value of template
   */
  async getTemplate(templateId:string): Promise<any> {
    const res = await this.request('POST', this.getUrl() + `/file_properties/templates/get_for_user`,
      {
        'template_id': templateId
      },
      'application/json'
    )
    if (res.status >= 400) {
      Logger.log('Dropbox API error: ' + JSON.stringify(await res.text()))
      throw new HttpError(res.status, 'POST')
    }

    const json = await res.json()

    return json
  }

  /**
   * Retrieves templateId to be used for metadata retrieval
   *
   * It could be lot easier if we can get metadata directly from file but Dropbox architecture different.
   *
   * The architecture:
   * A template is a schema in which we can store properties in a specific format
   * Then we can use template_id to store a custom property and it should adhere to its template schema
   * There can be multiple templates for an specific user and there are multiple properties
   * In order to get specific property we need to retrieve metadata with specific template_id
   *
   * So in order to have custom property 'locked' we need to add a template with predetermined
   * format for our data and then add the data as one of property groups.
   *
   * We get all templates and then find out if we have any template with name 'locked'
   * If present then return template_id otherwise create one and then return template_id
   * @returns {string} Template Id of template which has 'locked' property group
   */
  async getTemplateId(): Promise<string> {
    try {
      const templateIds = await this.getTemplates()

      if (templateIds.length === 0) {
        // no templates as its first time so create our template for custom properties
        const template = await this.addTemplate()
        this.templateId = template.template_id
        return this.templateId
      }

      // templates exists so search for our needed template if exists
      const templatesInfo = {}
      await Promise.all(
        templateIds.map(async templateId => {
          templatesInfo[templateId] = await this.getTemplate(templateId)
        })
      )

      let foundTemplate = false
      Object.keys(templatesInfo).forEach((id) => {
        if (templatesInfo[id].name === 'locked') {
          this.templateId = id
          foundTemplate = true
        }
      }
      )

      if (foundTemplate) {
        return this.templateId
      }

      // templates exists but not our template so creating one named 'locked' for custom properties on files
      const template = await this.addTemplate()
      this.templateId = template.template_id
      return this.templateId
    } catch (error) {
      const message = error && (error as any).message ? (error as any).message : String(error)
      Logger.log('Dropbox API error: ' + message)
      throw error
    }
  }

  /**
   * Free up lock on bookmarks.xbel file so that file editing can happen again
   * @param {string} id A unique identifier for file
   * @returns {boolean} True if lock is set on bookmarks.xbel file and false if not
   */
  async freeLock(id:string) {
    if (this.lockingPromise) {
      await this.lockingPromise
    }
    let lockFreed, i = 0
    do {
      const res = await this.request('POST', this.getUrl() + `/file_properties/properties/overwrite`,
        {
          'path': id,
          'property_groups': [
            {
              'fields': [
                {
                  'name': 'locked',
                  'value': ''
                }
              ],
              'template_id': this.templateId
            }
          ]
        },
        'application/json'
      )

      if (res.status >= 400) {
        Logger.log('Dropbox API error: ' + JSON.stringify(await res.text()))
        throw new HttpError(res.status, 'POST')
      }

      lockFreed = res.status === 200 || res.status === 204
      if (!lockFreed) {
        await this.timeout(1000)
      }
      i++
    } while (!lockFreed && i < 10)
    return lockFreed
  }

  /**
   * Sets lock on bookmarks.xbel file so that file tampering don't happen
   * @param {string} id A unique identifier for file
   * @returns {boolean} True if lock set on on bookmarks.xbel file and false if not
   */
  async setLock(id:string) {
    this.lockingPromise = this.request('POST', this.getUrl() + `/file_properties/properties/overwrite`,
      {
        'path': id,
        'property_groups': [
          {
            'fields': [
              {
                'name': 'locked',
                'value': JSON.stringify(Date.now())
              }
            ],
            'template_id': this.templateId
          }
        ]
      },
      'application/json'
    )

    const res = await this.lockingPromise
    return res.status === 200
  }

  /**
   * Create bookmarks.xbel file
   * This happens when the profile is created
   * @param {string} xbel XBEL content to create bookmarks.xbel file
   * @param {string} path File path on Dropbox
   * @returns
   */
  async createFile(xbel: string, path:string) {
    const extraHeaders = {
      'Dropbox-API-Arg': JSON.stringify({
        'autorename': false,
        'mode': 'add',
        'mute': false,
        'path': `/${path}`,
        'strict_conflict': false
      })
    }
    const res = await this.request('POST', this.getContentUrl() + `/files/upload`,
      xbel,
      'application/octet-stream',
      extraHeaders
    )

    if (res.status >= 400) {
      Logger.log('Dropbox API error: ' + JSON.stringify(await res.text()))
      throw new HttpError(res.status, 'POST')
    }

    const file = await res.json()
    this.fileId = file.id

    return res.status === 200
  }

  /**
   * Uploads bookmarks.xml file to Dropbox
   * This happens in subsequent syncs when we add/remove bookmarks in browser
   * @param {string} id A unique file identifier
   * @param {string} xbel Content of XML file
   * @returns {boolean} True if file is upload and false if not
   */
  async uploadFile(id:string, xbel: string) {
    const extraHeaders = {
      'Dropbox-API-Arg': JSON.stringify({
        'autorename': false,
        'mode': 'overwrite',
        'mute': false,
        'path': id,
        'strict_conflict': false
      })
    }
    const res = await this.request('POST', this.getContentUrl() + `/files/upload`,
      xbel,
      'application/octet-stream',
      extraHeaders
    )

    if (res.status >= 400) {
      Logger.log('Dropbox API error: ' + JSON.stringify(await res.text()))
      throw new HttpError(res.status, 'POST')
    }

    const file = await res.json()
    this.fileId = file.id

    return res.status === 200
  }
}

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
