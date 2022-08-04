import CachingAdapter from './Caching'
import Logger from '../Logger'
import XbelSerializer from '../serializers/Xbel'
import Crypto from '../Crypto'
import Credentials from '../../../google-api.credentials.json'
import {
  AuthenticationError,
  DecryptionError, FileUnreadableError,
  GoogleDriveAuthenticationError, InterruptedSyncError,
  NetworkError,
  OAuthTokenError
} from '../../errors/Error'
import { OAuth2Client } from '@byteowls/capacitor-oauth2'
import { Device } from '@capacitor/device'

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

  constructor(server) {
    super(server)
    this.server = server
  }

  static async authorize(interactive = true) {
    const { platform } = await Device.getInfo()

    if (platform !== 'web') {
      const result = await OAuth2Client.authenticate(OAuthConfig)
      const refresh_token = result.access_token_response.refresh_token
      const username = result.user.displayName
      return { refresh_token, username }
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
      throw new OAuthTokenError()
    }
    const json = await response.json()
    console.log(json)
    if (!json.access_token || !json.refresh_token) {
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

  static async getAccessToken(refreshToken:string) {
    const {platform} = await Device.getInfo()
    const credentialType = platform

    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: `refresh_token=${refreshToken}&` +
        `client_id=${Credentials[credentialType].client_id}&` +
        (credentialType === 'web' ? `client_secret=${Credentials.web.client_secret}&` : '') +
        `grant_type=refresh_token`
    })

    if (response.status !== 200) {
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
    return 'Google Drive: ' + this.server.bookmark_file
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
      this.cancelCallback = () => reject(new InterruptedSyncError())
    })
  }

  async onSyncStart() {
    Logger.log('onSyncStart: begin')

    this.accessToken = await GoogleDriveAdapter.getAccessToken(this.server.refreshToken)

    let file
    let startDate = Date.now()
    const maxTimeout = LOCK_TIMEOUT
    const base = 1.25
    for (let i = 0; Date.now() - startDate < maxTimeout; i++) {
      const fileList = await this.listFiles('name = ' + "'" + this.server.bookmark_file + "'")
      file = fileList.files.filter(file => !file.trashed)[0]
      if (file) {
        this.fileId = file.id
        const data = await this.getFileMetadata(file.id, 'appProperties')
        if (data.appProperties && data.appProperties.locked && (data.appProperties.locked === true || JSON.parse(data.appProperties.locked))) {
          const lockedDate = JSON.parse(data.appProperties.locked)
          if (Number.isInteger(lockedDate)) {
            startDate = lockedDate
          }
          await this.timeout(base ** i * 1000)
          continue
        }
      }
      break
    }

    if (file) {
      this.fileId = file.id
      await this.setLock(this.fileId)

      let xmlDocText = await this.downloadFile(this.fileId)

      if (this.server.password) {
        try {
          xmlDocText = await Crypto.decryptAES(this.server.password, xmlDocText, this.server.bookmark_file)
        } catch (e) {
          if (xmlDocText.includes('<?xml version="1.0" encoding="UTF-8"?>')) {
            // not encrypted, yet => noop
            this.alwaysUpload = true
          } else {
            throw new DecryptionError()
          }
        }
      } else if (!xmlDocText.includes('<?xml version="1.0" encoding="UTF-8"?>')) {
        throw new FileUnreadableError()
      }

      /* let's get the highestId */
      const byNL = xmlDocText.split('\n')
      byNL.forEach(line => {
        if (line.indexOf('<!--- highestId :') >= 0) {
          const idxStart = line.indexOf(':') + 1
          const idxEnd = line.lastIndexOf(':')

          this.highestId = parseInt(line.substring(idxStart, idxEnd))
        }
      })

      this.bookmarksCache = XbelSerializer.deserialize(xmlDocText)
      this.lockingInterval = setInterval(() => this.setLock(this.fileId), LOCK_INTERVAL) // Set lock every minute
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
      await this.freeLock(this.fileId)
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
      xbel = await Crypto.encryptAES(this.server.password, xbel, this.server.bookmark_file)
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

  async listFiles(query: string) : Promise<any> {
    let resp
    try {
      resp = await fetch(this.getUrl() + '/files?corpora=user&q=' + query, {
        headers: {
          Authorization: 'Bearer ' + this.accessToken
        }
      })
    } catch (e) {
      Logger.log('Error Caught')
      Logger.log(e)
      throw new NetworkError()
    }
    if (resp.status === 401 || resp.status === 403) {
      throw new AuthenticationError()
    }
    return resp.json()
  }

  async getFileMetadata(id: string, fields?:string): Promise<any> {
    let resp
    try {
      resp = await fetch(this.getUrl() + '/files/' + id + (fields ? `?fields=${fields}` : ''), {
        headers: {
          Authorization: 'Bearer ' + this.accessToken
        }
      })
    } catch (e) {
      Logger.log('Error Caught')
      Logger.log(e)
      throw new NetworkError()
    }
    if (resp.status === 401 || resp.status === 403) {
      throw new AuthenticationError()
    }
    return resp.json()
  }

  async downloadFile(id: string): Promise<string> {
    let resp
    try {
      resp = await fetch(this.getUrl() + '/files/' + id + '?alt=media', {
        headers: {
          Authorization: 'Bearer ' + this.accessToken
        }
      })
    } catch (e) {
      Logger.log('Error Caught')
      Logger.log(e)
      throw new NetworkError()
    }
    if (resp.status === 401 || resp.status === 403) {
      throw new AuthenticationError()
    }
    return resp.text()
  }

  async deleteFile(id: string): Promise<void> {
    let resp
    try {
      resp = await fetch(this.getUrl() + '/files/' + id, {
        method: 'DELETE',
        headers: {
          Authorization: 'Bearer ' + this.accessToken
        }
      })
    } catch (e) {
      Logger.log('Error Caught')
      Logger.log(e)
      throw new NetworkError()
    }
    if (resp.status === 401 || resp.status === 403) {
      throw new AuthenticationError()
    }
  }

  async freeLock(id:string) {
    let lockFreed, i = 0
    do {
      let resp
      try {
        resp = await fetch(this.getUrl() + '/files/' + id,{
          method: 'PATCH',
          credentials: 'omit',
          body: JSON.stringify({appProperties: {locked: JSON.stringify(false)}}),
          headers: {
            Authorization: 'Bearer ' + this.accessToken,
            'Content-type': 'application/json',
          }
        })
      } catch (e) {
        Logger.log('Error Caught')
        Logger.log(e)
        throw new NetworkError()
      }
      if (resp.status === 401 || resp.status === 403) {
        throw new AuthenticationError()
      }
      lockFreed = resp.status === 200 || resp.status === 204
      if (!lockFreed) {
        await this.timeout(1000)
      }
      i++
    } while (!lockFreed && i < 10)
    return lockFreed
  }

  async setLock(id:string) {
    let resp
    try {
      resp = await fetch(this.getUrl() + '/files/' + id,{
        method: 'PATCH',
        credentials: 'omit',
        body: JSON.stringify({appProperties: {locked: JSON.stringify(Date.now())}}),
        headers: {
          Authorization: 'Bearer ' + this.accessToken,
          'Content-type': 'application/json',
        }
      })
    } catch (e) {
      Logger.log('Error Caught')
      Logger.log(e)
      throw new NetworkError()
    }
    if (resp.status === 401 || resp.status === 403) {
      throw new AuthenticationError()
    }
    return resp.status === 200
  }

  async createFile(xbel: string) {
    let resp
    try {
      resp = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=media',{
        method: 'POST',
        credentials: 'omit',
        body: xbel,
        headers: {
          'Content-Type': 'application/xml',
          Authorization: 'Bearer ' + this.accessToken,
        },
      })
    } catch (e) {
      Logger.log('Error Caught')
      Logger.log(e)
      throw new NetworkError()
    }
    if (resp.status === 401 || resp.status === 403) {
      throw new AuthenticationError()
    }
    if (resp.status !== 200 && resp.status !== 201) {
      return false
    }
    const file = await resp.json()
    this.fileId = file.id

    try {
      resp = await fetch(this.getUrl() + '/files/' + this.fileId,{
        method: 'PATCH',
        credentials: 'omit',
        body: JSON.stringify({name: this.server.bookmark_file}),
        headers: {
          Authorization: 'Bearer ' + this.accessToken,
          'Content-type': 'application/json',
        }
      })
    } catch (e) {
      Logger.log('Error Caught')
      Logger.log(e)
      throw new NetworkError()
    }
    if (resp.status === 401 || resp.status === 403) {
      throw new AuthenticationError()
    }
    return resp.status === 200
  }

  async uploadFile(id:string, xbel: string) {
    let resp
    try {
      resp = await fetch('https://www.googleapis.com/upload/drive/v3/files/' + id,{
        method: 'PATCH',
        credentials: 'omit',
        body: xbel,
        headers: {
          'Content-Type': 'application/xml',
          Authorization: 'Bearer ' + this.accessToken,
        },
      })
    } catch (e) {
      Logger.log('Error Caught')
      Logger.log(e)
      throw new NetworkError()
    }
    if (resp.status === 401 || resp.status === 403) {
      throw new AuthenticationError()
    }
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
