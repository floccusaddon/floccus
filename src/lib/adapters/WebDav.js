import CachingAdapter from './Caching'
import XbelSerializer from '../serializers/Xbel'
import Logger from '../Logger'
import { Base64 } from 'js-base64'

import url from 'url'
import Crypto from '../Crypto'
import {
  AuthenticationError,
  DecryptionError,
  HttpError,
  LockFileError,
  NetworkError,
  SlashError
} from '../../errors/Error'
import { Http } from '@capacitor-community/http'

export default class WebDavAdapter extends CachingAdapter {
  constructor(server) {
    super(server)
    this.server = server
  }

  static getDefaultValues() {
    return {
      type: 'webdav',
      url: 'https://example.org/',
      username: 'bob',
      password: 's3cret',
      bookmark_file: 'bookmarks.xbel',
      includeCredentials: false,
      passphrase: '',
    }
  }

  getData() {
    return { ...WebDavAdapter.getDefaultValues(), ...this.server }
  }

  normalizeServerURL(input) {
    let serverURL = url.parse(input)
    if (!serverURL.pathname) serverURL.pathname = ''
    return url.format({
      protocol: serverURL.protocol,
      auth: serverURL.auth,
      host: serverURL.host,
      port: serverURL.port,
      pathname:
        serverURL.pathname +
        (serverURL.pathname[serverURL.pathname.length - 1] !== '/' ? '/' : '')
    })
  }

  getBookmarkURL() {
    return this.normalizeServerURL(this.server.url) + this.server.bookmark_file
  }

  getBookmarkLockURL() {
    return this.getBookmarkURL() + '.lock'
  }

  async downloadFile(fullURL) {
    let res
    let authString = Base64.encode(
      this.server.username + ':' + this.server.password
    )

    try {
      res = await Http.request({
        url: fullURL,
        method: 'GET',
        headers: {
          Authorization: 'Basic ' + authString
        },
        responseType: 'text',
        webFetchExtra: {
          credentials: 'omit',
        }
      })
    } catch (e) {
      throw new NetworkError()
    }

    if (res.status === 401) {
      throw new AuthenticationError()
    }
    if (res.status >= 300 && res.status !== 404) {
      throw new HttpError(res.status, 'GET')
    }

    return res
  }

  async checkLock() {
    let fullURL = this.getBookmarkLockURL()
    Logger.log(fullURL)

    const response = await this.downloadFile(fullURL)
    return response.status
  }

  timeout(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  async uploadFile(url, content_type, data) {
    let authString = Base64.encode(
      this.server.username + ':' + this.server.password
    )
    try {
      var res = await Http.request({
        url,
        method: 'PUT',
        headers: {
          'Content-Type': content_type,
          Authorization: 'Basic ' + authString
        },
        data,
        webFetchExtra: {
          credentials: 'omit',
        }
      })
    } catch (e) {
      Logger.log('Error Caught')
      Logger.log(e)
      throw new NetworkError()
    }
    if (res.status === 401 || res.status === 403) {
      throw new AuthenticationError()
    }
    if (res.status >= 300) {
      throw new HttpError(res.status, 'PUT')
    }
  }

  async obtainLock() {
    let rStatus
    const startDate = Date.now()
    const maxTimeout = 30 * 60 * 1000 // Give up after 0.5h
    const base = 1.25
    for (let i = 0; Date.now() - startDate < maxTimeout; i++) {
      rStatus = await this.checkLock()
      if (rStatus === 200) {
        await this.timeout(base ** i * 1000)
      } else if (rStatus === 404) {
        break
      }
    }

    if (rStatus === 200) {
      // continue anyway
    } else if (rStatus === 404) {
      let fullURL = this.getBookmarkLockURL()
      Logger.log(fullURL)
      await this.uploadFile(
        fullURL,
        'text/html',
        '<html><body>I am a lock file</body></html>'
      )
    } else {
      throw new LockFileError(
        rStatus,
        this.server.bookmark_file + '.lock'
      )
    }
  }

  async freeLock() {
    let fullUrl = this.getBookmarkLockURL()

    let authString = Base64.encode(
      this.server.username + ':' + this.server.password
    )

    try {
      await Http.request({
        url: fullUrl,
        method: 'DELETE',
        headers: {
          Authorization: 'Basic ' + authString
        },
        webFetchExtra: {
          credentials: 'omit',
        }
      })
    } catch (e) {
      Logger.log('Error Caught')
      Logger.log(e)
    }
  }

  async pullFromServer() {
    let fullUrl = this.getBookmarkURL()

    let response = await this.downloadFile(fullUrl)

    if (response.status === 401) {
      throw new AuthenticationError()
    }

    if (response.status === 404) {
      this.resetCache()
      return response
    }

    if (response.status === 200) {
      let xmlDocText = response.data

      if (this.server.passphrase) {
        try {
          xmlDocText = await Crypto.decryptAES(this.server.passphrase, xmlDocText, this.server.bookmark_file)
        } catch (e) {
          if (xmlDocText.includes('<?xml version="1.0" encoding="UTF-8"?>')) {
            // not encrypted, yet => noop
          } else {
            throw new DecryptionError()
          }
        }
      } else if (!xmlDocText.includes('<?xml version="1.0" encoding="UTF-8"?>')) {
        throw new Error(browser.i18n.getMessage('Error034'))
      }

      /* let's get the highestId */
      let byNL = xmlDocText.split('\n')
      byNL.forEach(line => {
        if (line.indexOf('<!--- highestId :') >= 0) {
          let idxStart = line.indexOf(':') + 1
          let idxEnd = line.lastIndexOf(':')

          this.highestId = parseInt(line.substring(idxStart, idxEnd))
        }
      })

      this.bookmarksCache = XbelSerializer.deserialize(xmlDocText)
    }

    return response
  }

  async onSyncStart() {
    Logger.log('onSyncStart: begin')

    if (this.server.bookmark_file[0] === '/') {
      throw new SlashError()
    }

    await this.obtainLock()

    let resp = await this.pullFromServer()

    if (resp.status !== 200) {
      if (resp.status !== 404) {
        throw new HttpError(resp.status, 'GET')
      }
    }

    this.initialTreeHash = await this.bookmarksCache.hash(true)

    Logger.log('onSyncStart: completed')

    if (resp.status === 404) {
      // Notify sync process that we need to reset cache
      return false
    }
  }

  async onSyncFail() {
    Logger.log('onSyncFail')
    await this.freeLock()
  }

  async onSyncComplete() {
    Logger.log('onSyncComplete')

    this.bookmarksCache = this.bookmarksCache.clone()
    const newTreeHash = await this.bookmarksCache.hash(true)
    if (newTreeHash !== this.initialTreeHash) {
      let fullUrl = this.getBookmarkURL()
      let xbel = createXBEL(this.bookmarksCache, this.highestId)
      if (this.server.passphrase) {
        xbel = await Crypto.encryptAES(this.server.passphrase, xbel, this.server.bookmark_file)
      }
      await this.uploadFile(fullUrl, 'application/xml', xbel)
    } else {
      Logger.log('No changes to the server version necessary')
    }
    await this.freeLock()
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
