import CachingAdapter from './Caching'
import Logger from '../Logger'
import XbelSerializer from '../serializers/Xbel'
import Crypto from '../Crypto'
import Credentials from '../../../google-api.credentials.json'
import {
  AuthenticationError,
  DecryptionError, FileUnreadableError,
  GoogleDriveAuthenticationError, HttpError, CancelledSyncError, MissingPermissionsError,
  NetworkError,
  OAuthTokenError, ResourceLockedError, GoogleDriveSearchError
} from '../../errors/Error'
import { OAuth2Client } from '@byteowls/capacitor-oauth2'
import { Capacitor, CapacitorHttp as Http } from '@capacitor/core'

const OAuthConfig = {
  authorizationBaseUrl: 'https://accounts.google.com/o/oauth2/auth',
  accessTokenEndpoint: 'https://oauth2.googleapis.com/token',
  scope: 'https://www.googleapis.com/auth/drive.file',
  resourceUrl: 'https://www.googleapis.com/drive/v3/about?fields=user/displayName',
  logsEnabled: true,
  android: {
    appId: Credentials.android.client_id,
    responseType: 'code', // if you configured a android app in google dev console the value must be "code"
    redirectUrl: 'org.handmadeideas.floccus:/' // package name from google dev console
  },
  ios: {
    appId: Credentials.ios.client_id,
    responseType: 'code',
    redirectUrl: 'org.handmadeideas.floccus:/'
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
export default class GoogleDriveAdapter extends CachingAdapter {
  static SCOPES = ['https://www.googleapis.com/auth/drive.metadata.readonly']

  private initialTreeHash: string
  private fileId: string
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
    const platform = Capacitor.getPlatform()

    if (platform !== 'web') {
      const result = await OAuth2Client.authenticate(OAuthConfig)
      const refresh_token = result.access_token_response.refresh_token
      const username = result.user.displayName
      return { refresh_token, username }
    }

    if (platform === 'web') {
      const browser = (await import('../browser-api')).default
      const origins = ['https://oauth2.googleapis.com/', 'https://www.googleapis.com/']
      if (!(await browser.permissions.contains({ origins }))) {
        throw new MissingPermissionsError()
      }
    }

    // see https://developers.google.com/identity/protocols/oauth2/native-app
    const challenge = Crypto.bufferToHexstr(await Crypto.getRandomBytes(128)).substr(0, 128)
    const state = Crypto.bufferToHexstr(await Crypto.getRandomBytes(128)).substr(0, 64)
    const redirectURL = chrome.identity.getRedirectURL()
    const scopes = ['https://www.googleapis.com/auth/drive.file']
    let authURL = 'https://accounts.google.com/o/oauth2/auth'
    authURL += `?client_id=${Credentials.web.client_id}`
    authURL += `&response_type=code`
    authURL += `&redirect_uri=${encodeURIComponent(redirectURL)}`
    authURL += `&scope=${encodeURIComponent(scopes.join(' '))}`
    authURL += `&approval_prompt=force&access_type=offline`
    authURL += `&code_challenge=${challenge}`
    authURL += `&state=${state}`

    const browser = (await import('../browser-api')).default

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
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: `code=${code}` +
        `&client_id=${Credentials.web.client_id}` +
        `&client_secret=${Credentials.web.client_secret}` +
        `&redirect_uri=${encodeURIComponent(chrome.identity.getRedirectURL())}` +
        `&code_verifier=${challenge}` +
        '&grant_type=authorization_code'
    })

    if (response.status !== 200) {
      Logger.log('Failed to retrieve refresh token from Google API: ' + await response.text())
      throw new OAuthTokenError()
    }
    const json = await response.json()
    if (!json.access_token || !json.refresh_token) {
      Logger.log('Failed to retrieve refresh token from Google API: ' + JSON.stringify(json))
      throw new OAuthTokenError()
    }

    const res = await fetch('https://www.googleapis.com/drive/v3/about?fields=user/displayName', {
      headers: {
        Authorization: 'Bearer ' + json.access_token
      }
    })
    const about = await res.json()

    return { refresh_token: json.refresh_token, username: about.user.displayName }
  }

  async getAccessToken(refreshToken:string) {
    const platform = Capacitor.getPlatform()

    const response = await this.request('POST', 'https://oauth2.googleapis.com/token',
      {
        refresh_token: refreshToken,
        client_id: Credentials[platform].client_id,
        ...(platform === 'web' && {client_secret: Credentials.web.client_secret}),
        grant_type: 'refresh_token',
      },
      'application/x-www-form-urlencoded'
    )

    if (response.status !== 200) {
      Logger.log('Failed to retrieve access token from Google API: ' + await response.text())
      throw new GoogleDriveAuthenticationError()
    }

    const json = await response.json()
    if (json.access_token) {
      return json.access_token
    } else {
      throw new OAuthTokenError()
    }
  }

  getLabel():string {
    return this.server.label || 'Google Drive: ' + this.server.bookmark_file
  }

  static getDefaultValues() {
    return {
      type: 'google-drive',
      username: '',
      password: '',
      refreshToken: null,
      bookmark_file: 'bookmarks.xbel',
      allowNetwork: false,
    }
  }

  getUrl() :string {
    return 'https://www.googleapis.com/drive/v3'
  }

  timeout(ms) {
    return new Promise((resolve, reject) => {
      setTimeout(resolve, ms)
      this.cancelCallback = () => reject(new CancelledSyncError())
    })
  }

  async onSyncStart(needLock = true, forceLock = false) {
    Logger.log('onSyncStart: begin')

    if (Capacitor.getPlatform() === 'web') {
      const browser = (await import('../browser-api')).default
      const origins = ['https://oauth2.googleapis.com/', 'https://www.googleapis.com/']
      let hasPermissions, error = false
      try {
        hasPermissions = await browser.permissions.contains({ origins })
      } catch (e) {
        error = true
        console.warn(e)
      }
      if (!error && !hasPermissions) {
        throw new MissingPermissionsError()
      }
    }

    this.accessToken = await this.getAccessToken(this.server.refreshToken)

    const fileList = await this.listFiles(`name = '${this.server.bookmark_file}'`, 100)
    if (!fileList.files) {
      throw new GoogleDriveSearchError()
    }

    const file = fileList.files.filter(file => !file.trashed)[0]

    const filesToDelete = fileList.files.filter(file => !file.trashed).slice(1)
    for (const fileToDelete of filesToDelete) {
      try {
        await this.deleteFile(fileToDelete.id)
      } catch (e) {
        Logger.log('Failed to delete superfluous file: ' + e.message)
      }
    }

    if (file) {
      this.fileId = file.id
      if (forceLock) {
        this.locked = await this.setLock(this.fileId)
      } else if (needLock) {
        const data = await this.getFileMetadata(file.id, 'appProperties')
        if (data.appProperties && data.appProperties.locked && (data.appProperties.locked === true || JSON.parse(data.appProperties.locked))) {
          const lockedDate = JSON.parse(data.appProperties.locked)
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

    this.initialTreeHash = await this.bookmarksCache.hash(true)

    Logger.log('onSyncStart: completed')

    if (!this.fileId) {
      // notify sync process that we should reset cache
      return false
    }
  }

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

  async onSyncComplete() {
    Logger.log('onSyncComplete')
    clearInterval(this.lockingInterval)

    this.bookmarksCache = this.bookmarksCache.clone()
    const newTreeHash = await this.bookmarksCache.hash(true)
    let xbel = createXBEL(this.bookmarksCache, this.highestId)

    if (this.server.password) {
      const salt = Crypto.bufferToHexstr(Crypto.getRandomBytes(64))
      const ciphertext = await Crypto.encryptAES(this.server.password, xbel, salt)
      xbel = JSON.stringify({ciphertext, salt})
    }

    if (!this.fileId) {
      await this.createFile(xbel)
      this.fileId = null
      return
    }

    if (newTreeHash !== this.initialTreeHash || this.alwaysUpload) {
      await this.uploadFile(this.fileId, xbel)
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

  async request(method: string, url: string, body: any = null, contentType: string = null) : Promise<CustomResponse> {
    return this.requestNative(method, url, body, contentType)
  }

  async requestWeb(method: string, url: string, body: any = null, contentType: string = null) : Promise<CustomResponse> {
    let resp
    try {
      resp = await fetch(url, {
        method,
        credentials: 'omit',
        headers: {
          ...(this.accessToken && {Authorization: 'Bearer ' + this.accessToken}),
          ...(contentType && {'Content-type': contentType})
        },
        ...(body && {body}),
      })
    } catch (e) {
      Logger.log('Error Caught')
      Logger.log(e)
      throw new NetworkError()
    }
    if (resp.status === 401 || resp.status === 403) {
      Logger.log('Failed to authenticate to Google API: ' + await resp.text())
      throw new AuthenticationError()
    }
    return resp
  }

  async requestNative(method: string, url: string, body: any = null, contentType: string = null) : Promise<CustomResponse> {
    let res

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
        },
        responseType: 'text',
        ...(body && {data: body})
      })
    } catch (e) {
      Logger.log('Error Caught')
      Logger.log(e)
      throw new NetworkError()
    }

    if (res.status === 401 || res.status === 403) {
      Logger.log('Failed to authenticate to Google API: ' + res.data)
      throw new AuthenticationError()
    }

    if (res.status >= 500) {
      throw new HttpError(res.status, method)
    }

    return {
      status: res.status,
      json: () => Promise.resolve(res.data),
      text: () => Promise.resolve(res.data),
    }
  }

  async listFiles(query: string, limit = 1) : Promise<any> {
    const res = await this.request('GET', this.getUrl() + `/files?corpora=user&q=${encodeURIComponent(query)}&orderBy=modifiedTime%20desc&fields=files(id%2Cname%2Ctrashed)&pageSize=${limit}`)
    return res.json()
  }

  async getFileMetadata(id: string, fields?:string): Promise<any> {
    const res = await this.request('GET', this.getUrl() + '/files/' + id + (fields ? `?fields=${encodeURIComponent(fields)}` : ''))
    return res.json()
  }

  async downloadFile(id: string): Promise<string> {
    const res = await this.request('GET', this.getUrl() + '/files/' + id + '?alt=media')
    return res.text()
  }

  async deleteFile(id: string): Promise<void> {
    await this.request('DELETE', this.getUrl() + '/files/' + id)
  }

  async freeLock(id:string) {
    if (this.lockingPromise) {
      await this.lockingPromise
    }
    let lockFreed, i = 0
    do {
      const res = await this.request('PATCH', this.getUrl() + '/files/' + id,
        JSON.stringify({
          appProperties: {
            locked: JSON.stringify(false)
          }
        }),
        'application/json'
      )
      lockFreed = res.status === 200 || res.status === 204
      if (!lockFreed) {
        await this.timeout(1000)
      }
      i++
    } while (!lockFreed && i < 10)
    return lockFreed
  }

  async setLock(id:string) {
    this.lockingPromise = this.request('PATCH', this.getUrl() + '/files/' + id,
      JSON.stringify({
        appProperties: {
          locked: JSON.stringify(Date.now())
        }
      }),
      'application/json'
    )
    const res = await this.lockingPromise
    return res.status === 200
  }

  async createFile(xbel: string) {
    let res = await this.request('POST', 'https://www.googleapis.com/upload/drive/v3/files?uploadType=media', xbel, 'application/xml')
    if (res.status !== 200 && res.status !== 201) {
      return false
    }
    const file = await res.json()
    this.fileId = file.id

    res = await this.request('PATCH', this.getUrl() + '/files/' + this.fileId,
      JSON.stringify({name: this.server.bookmark_file}),
      'application/json'
    )
    return res.status === 200
  }

  async uploadFile(id:string, xbel: string) {
    const resp = await this.request('PATCH', 'https://www.googleapis.com/upload/drive/v3/files/' + id, xbel, 'application/xml')
    return resp.status === 200
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
