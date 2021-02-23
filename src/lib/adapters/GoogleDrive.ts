import browser from '../browser-api'
import CachingAdapter from './Caching'
import Logger from '../Logger'
import XbelSerializer from '../serializers/Xbel'
import Crypto from '../Crypto'
import Credentials from '../../../google-api.credentials.json'

declare const chrome: any

export default class GoogleDriveAdapter extends CachingAdapter {
  static SCOPES = ['https://www.googleapis.com/auth/drive.metadata.readonly']

  private initialTreeHash: string
  private fileId: string
  private accessToken: string

  constructor(server) {
    super(server)
    this.server = server
  }

  static async authorize(interactive = true) {
    const redirectURL = chrome.identity.getRedirectURL()
    const scopes = ['https://www.googleapis.com/auth/drive.file']
    let authURL = 'https://accounts.google.com/o/oauth2/auth'
    authURL += `?client_id=${Credentials.web.client_id}`
    authURL += `&response_type=code`
    authURL += `&redirect_uri=${encodeURIComponent(redirectURL)}`
    authURL += `&scope=${encodeURIComponent(scopes.join(' '))}`
    authURL += `&approval_prompt=force&access_type=offline`

    const redirectResult = await browser.identity.launchWebAuthFlow({
      interactive,
      url: authURL
    })

    const m = redirectResult.match(/[#?](.*)/)
    if (!m || m.length < 1)
      return null
    const params = new URLSearchParams(m[1].split('#')[0])
    const code = params.get('code')

    if (!code) {
      throw new Error('Authorization failure')
    }
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: `code=${code}&` +
        `client_id=${Credentials.web.client_id}&` +
        `client_secret=${Credentials.web.client_secret}&` +
        `redirect_uri=${encodeURIComponent(chrome.identity.getRedirectURL())}&` +
        'grant_type=authorization_code'
    })

    if (response.status !== 200) {
      throw new Error('Token validation error')
    }

    const json = await response.json()
    console.log(json)
    if (json.access_token && json.refresh_token) {
      return json.refresh_token
    } else {
      throw new Error('Token validation error')
    }
  }

  static async getAccessToken(refreshToken:string) {
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: `refresh_token=${refreshToken}&` +
        `client_id=${Credentials.web.client_id}&` +
        `client_secret=${Credentials.web.client_secret}&` +
        `grant_type=refresh_token`
    })

    if (response.status !== 200) {
      throw new Error('Could not authenticate with Google Drive. Please connect floccus with your google account again.')
    }

    const json = await response.json()
    if (json.access_token) {
      return json.access_token
    } else {
      throw new Error('Token validation error')
    }
  }

  getLabel():string {
    return 'Google Drive: ' + this.server.bookmark_file
  }

  static getDefaultValues() {
    return {
      type: 'google-drive',
      password: '',
      refreshToken: null,
      bookmark_file: 'bookmarks.xbel',
    }
  }

  getUrl() :string {
    return 'https://www.googleapis.com/drive/v3'
  }

  timeout(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  async onSyncStart() {
    Logger.log('onSyncStart: begin')

    this.accessToken = await GoogleDriveAdapter.getAccessToken(this.server.refreshToken)

    let file
    const startDate = Date.now()
    const maxTimeout = 30 * 60 * 1000 // Give up after 0.5h
    const base = 1.25
    for (let i = 0; Date.now() - startDate < maxTimeout; i++) {
      const fileList = await this.listFiles('name = ' + "'" + this.server.bookmark_file + "'")
      file = fileList.files.filter(file => !file.trashed)[0]
      if (file && file['appProperties.locked']) {
        await this.timeout(base ** i * 1000)
      } else {
        break
      }
    }

    if (file) {
      this.fileId = file.id
      await this.setLock(this.fileId)

      let xmlDocText = await this.downloadFile(this.fileId)

      if (this.server.password) {
        try {
          xmlDocText = await Crypto.decryptAES(this.server.password, xmlDocText, this.server.bookmark_file)
        } catch (e) {
          throw new Error(browser.i18n.getMessage('Error030'))
        }
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
    } else {
      this.resetCache()
    }

    this.initialTreeHash = await this.bookmarksCache.hash(true)

    Logger.log('onSyncStart: completed')
  }

  async onSyncFail() {
    Logger.log('onSyncFail')
    if (this.fileId) {
      await this.freeLock(this.fileId)
    }
    this.fileId = null
  }

  async onSyncComplete() {
    Logger.log('onSyncComplete')

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

    if (newTreeHash !== this.initialTreeHash) {
      await this.uploadFile(this.fileId, xbel)
    } else {
      Logger.log('No changes to the server version necessary')
    }
    await this.freeLock(this.fileId)
    this.fileId = null
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
      throw new Error(browser.i18n.getMessage('Error017'))
    }
    if (resp.status === 401 || resp.status === 403) {
      throw new Error(browser.i18n.getMessage('Error018'))
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
      throw new Error(browser.i18n.getMessage('Error017'))
    }
    if (resp.status === 401 || resp.status === 403) {
      throw new Error(browser.i18n.getMessage('Error018'))
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
      throw new Error(browser.i18n.getMessage('Error017'))
    }
    if (resp.status === 401 || resp.status === 403) {
      throw new Error(browser.i18n.getMessage('Error018'))
    }
  }

  async freeLock(id:string) {
    let resp
    try {
      resp = await fetch(this.getUrl() + '/files/' + id,{
        method: 'PATCH',
        credentials: 'omit',
        body: JSON.stringify({appProperties: {locked: false}}),
        headers: {
          Authorization: 'Bearer ' + this.accessToken,
          'Content-type': 'application/json',
        }
      })
    } catch (e) {
      Logger.log('Error Caught')
      Logger.log(e)
      throw new Error(browser.i18n.getMessage('Error017'))
    }
    if (resp.status === 401 || resp.status === 403) {
      throw new Error(browser.i18n.getMessage('Error018'))
    }
    return resp.status === 200
  }

  async setLock(id:string) {
    let resp
    try {
      resp = await fetch(this.getUrl() + '/files/' + id,{
        method: 'PATCH',
        credentials: 'omit',
        body: JSON.stringify({appProperties: {locked: true}}),
        headers: {
          Authorization: 'Bearer ' + this.accessToken,
          'Content-type': 'application/json',
        }
      })
    } catch (e) {
      Logger.log('Error Caught')
      Logger.log(e)
      throw new Error(browser.i18n.getMessage('Error017'))
    }
    if (resp.status === 401 || resp.status === 403) {
      throw new Error(browser.i18n.getMessage('Error018'))
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
      throw new Error(browser.i18n.getMessage('Error017'))
    }
    if (resp.status === 401 || resp.status === 403) {
      throw new Error(browser.i18n.getMessage('Error018'))
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
      throw new Error(browser.i18n.getMessage('Error017'))
    }
    if (resp.status === 401 || resp.status === 403) {
      throw new Error(browser.i18n.getMessage('Error018'))
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
      throw new Error(browser.i18n.getMessage('Error017'))
    }
    if (resp.status === 401 || resp.status === 403) {
      throw new Error(browser.i18n.getMessage('Error018'))
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
