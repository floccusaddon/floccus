import browser from '../browser-api'
import CachingAdapter from './Caching'
import Logger from '../Logger'
import XbelSerializer from '../serializers/Xbel'
import Crypto from '../Crypto'

export default class GoogleDriveAdapter extends CachingAdapter {
  static SCOPES = ['https://www.googleapis.com/auth/drive.metadata.readonly']
  static CLIENT_ID = '305459871054-4rr6n0jmsdvvprtjqbma5oeksshis2bn.apps.googleusercontent.com'

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
    authURL += `?client_id=${this.CLIENT_ID}`
    authURL += `&response_type=token`
    authURL += `&redirect_uri=${encodeURIComponent(redirectURL)}`
    authURL += `&scope=${encodeURIComponent(scopes.join(' '))}`

    const redirectResult = await browser.identity.launchWebAuthFlow({
      interactive,
      url: authURL
    })
    return this.validate(redirectResult)
  }

  /**
   Validate the token contained in redirectURL.
   This follows essentially the process here:
   https://developers.google.com/identity/protocols/OAuth2UserAgent#tokeninfo-validation
   - make a GET request to the validation URL, including the access token
   - if the response is 200, and contains an "aud" property, and that property
   matches the clientID, then the response is valid
   - otherwise it is not valid
   Note that the Google page talks about an "audience" property, but in fact
   it seems to be "aud".
   */
  static async validate(redirectURL:string) {
    const accessToken = extractAccessToken(redirectURL)
    if (!accessToken) {
      throw new Error('Authorization failure')
    }
    const validationURL = `${VALIDATION_BASE_URL}?access_token=${accessToken}`
    const response = await fetch(validationURL, {
      method: 'GET'
    })

    if (response.status !== 200) {
      throw new Error('Token validation error')
    }

    const json = await response.json()
    console.log(json)
    if (json.aud && (json.aud === this.CLIENT_ID)) {
      return accessToken
    } else {
      throw new Error('Token validation error')
    }
  }

  getLabel():string {
    return 'Google Drive'
  }

  static getDefaultValues() {
    return {
      type: 'google-drive',
      password: '',
      bookmark_file: 'bookmarks.xbel'
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

    this.accessToken = await GoogleDriveAdapter.authorize(false)

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

const VALIDATION_BASE_URL = 'https://www.googleapis.com/oauth2/v3/tokeninfo'

function extractAccessToken(redirectUri) {
  const m = redirectUri.match(/[#?](.*)/)
  if (!m || m.length < 1)
    return null
  const params = new URLSearchParams(m[1].split('#')[0])
  return params.get('access_token')
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
