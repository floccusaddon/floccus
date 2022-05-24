import CachingAdapter from './Caching'
import XbelSerializer from '../serializers/Xbel'
import Logger from '../Logger'
import { Base64 } from 'js-base64'

import url from 'url'
import Crypto from '../Crypto'
import {
  AuthenticationError,
  DecryptionError, FileUnreadableError,
  HttpError, InterruptedSyncError,
  LockFileError,
  NetworkError, RedirectError,
  SlashError
} from '../../errors/Error'
import { Http } from '@capacitor-community/http'
import { Device } from '@capacitor/device'

const LOCK_INTERVAL = 2 * 60 * 1000 // Lock every 2mins while syncing
const LOCK_TIMEOUT = 15 * 60 * 1000 // Override lock 0.25h after last time lock has been set
export default class WebDavAdapter extends CachingAdapter {
  private lockingInterval: any
  private locked: boolean
  private cancelCallback: () => void
  private initialTreeHash: string
  constructor(server) {
    super(server)
    this.server = server
    this.locked = false
    this.lockingInterval = null
  }

  static getDefaultValues() {
    return {
      type: 'webdav',
      url: 'https://example.org/',
      username: 'bob',
      password: 's3cret',
      bookmark_file: 'bookmarks.xbel',
      includeCredentials: false,
      allowRedirects: false,
      passphrase: '',
      allowNetwork: false,
    }
  }

  getData() {
    return { ...WebDavAdapter.getDefaultValues(), ...this.server }
  }

  normalizeServerURL(input) {
    const serverURL = url.parse(input)
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

  cancel() {
    this.cancelCallback && this.cancelCallback()
  }

  getBookmarkURL() {
    return this.normalizeServerURL(this.server.url) + this.server.bookmark_file
  }

  getBookmarkLockURL() {
    return this.getBookmarkURL() + '.lock'
  }

  async checkLock() {
    const fullURL = this.getBookmarkLockURL()
    Logger.log(fullURL)

    const response = await this.downloadFile(fullURL)
    return response
  }

  timeout(ms) {
    return new Promise((resolve, reject) => {
      setTimeout(resolve, ms)
      this.cancelCallback = () => reject(new InterruptedSyncError())
    })
  }

  async obtainLock() {
    let res
    let startDate = Date.now()
    const maxTimeout = LOCK_TIMEOUT
    const base = 1.25
    for (let i = 0; Date.now() - startDate < maxTimeout; i++) {
      res = await this.checkLock()
      if (res.status === 200) {
        if (res.headers['Last-Modified']) {
          const date = new Date(res.headers['Last-Modified'])
          startDate = date.valueOf()
        }
        await this.timeout(base ** i * 1000)
      } else if (res.status !== 200) {
        break
      }
    }

    if (res.status === 200) {
      // continue anywayrStatus
    } else if (res.status === 404) {
      await this.setLock()
    } else {
      throw new LockFileError(
        res.status,
        this.server.bookmark_file + '.lock'
      )
    }
    this.locked = true
  }

  async setLock() {
    const fullURL = this.getBookmarkLockURL()
    Logger.log(fullURL)
    await this.uploadFile(
      fullURL,
      'text/html',
      '<html><body>I am a lock file</body></html>'
    )
  }

  async freeLock() {
    if (!this.locked) {
      return
    }
    const fullUrl = this.getBookmarkLockURL()

    const authString = Base64.encode(
      this.server.username + ':' + this.server.password
    )

    let res, lockFreed, i = 0
    try {
      do {
        res = await Http.request({
          url: fullUrl,
          method: 'DELETE',
          headers: {
            Authorization: 'Basic ' + authString
          },
          webFetchExtra: {
            credentials: 'omit',
          }
        })
        lockFreed = res.status === 200 || res.status === 204 || res.status === 404
        if (!lockFreed) {
          await this.timeout(1000)
        }
        i++
      } while (!lockFreed && i < 10)
      return lockFreed
    } catch (e) {
      Logger.log('Error Caught')
      Logger.log(e)
    }
  }

  async pullFromServer() {
    const fullUrl = this.getBookmarkURL()

    const response = await this.downloadFile(fullUrl)

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
    }

    return response
  }

  async onSyncStart(needLock = true) {
    Logger.log('onSyncStart: begin')

    if (this.server.bookmark_file[0] === '/') {
      throw new SlashError()
    }

    if (needLock) {
      await this.obtainLock()
    }

    const resp = await this.pullFromServer()

    if (resp.status !== 200) {
      if (resp.status !== 404) {
        throw new HttpError(resp.status, 'GET')
      }
    }

    this.lockingInterval = setInterval(() => this.setLock(), LOCK_INTERVAL) // Set lock every minute

    this.initialTreeHash = await this.bookmarksCache.hash(true)

    Logger.log('onSyncStart: completed')

    if (resp.status === 404) {
      // Notify sync process that we need to reset cache
      return false
    }
  }

  async onSyncFail() {
    Logger.log('onSyncFail')
    clearInterval(this.lockingInterval)
    await this.freeLock()
  }

  async onSyncComplete() {
    Logger.log('onSyncComplete')
    clearInterval(this.lockingInterval)

    this.bookmarksCache = this.bookmarksCache.clone()
    const newTreeHash = await this.bookmarksCache.hash(true)
    if (newTreeHash !== this.initialTreeHash) {
      const fullUrl = this.getBookmarkURL()
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

  async uploadFile(url, content_type, data) {
    const info = await Device.getInfo()
    if (info.platform === 'web') {
      return this.uploadFileWeb(url, content_type, data)
    } else {
      return this.uploadFileNative(url, content_type, data)
    }
  }

  async uploadFileWeb(url, content_type, data) {
    const authString = Base64.encode(
      this.server.username + ':' + this.server.password
    )
    let res
    try {
      res = await fetch(url,{
        method: 'PUT',
        headers: {
          'Content-Type': content_type,
          Authorization: 'Basic ' + authString
        },
        credentials: 'omit',
        ...(!this.server.allowRedirects && {redirect: 'manual'}),
        body: data,
      })
    } catch (e) {
      Logger.log('Error Caught')
      Logger.log(e)
      throw new NetworkError()
    }
    if (res.status === 0 && !this.server.allowRedirects) {
      throw new RedirectError()
    }
    if (res.status === 401 || res.status === 403) {
      throw new AuthenticationError()
    }
    if (res.status >= 300) {
      throw new HttpError(res.status, 'PUT')
    }
  }

  async uploadFileNative(url, content_type, data) {
    const authString = Base64.encode(
      this.server.username + ':' + this.server.password
    )
    let res
    try {
      res = await Http.request({
        url,
        method: 'PUT',
        headers: {
          'Content-Type': content_type,
          Authorization: 'Basic ' + authString
        },
        data
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

  async downloadFile(url) {
    const info = await Device.getInfo()
    if (info.platform === 'web') {
      return this.downloadFileWeb(url)
    } else {
      return this.downloadFileNative(url)
    }
  }

  async downloadFileWeb(url) {
    const authString = Base64.encode(
      this.server.username + ':' + this.server.password
    )
    let res
    try {
      res = await fetch(url,{
        method: 'GET',
        headers: {
          Authorization: 'Basic ' + authString
        },
        credentials: 'omit',
        ...(!this.server.allowRedirects && {redirect: 'manual'})
      })
    } catch (e) {
      Logger.log('Error Caught')
      Logger.log(e)
      throw new NetworkError()
    }
    if (res.status === 0 && !this.server.allowRedirects) {
      throw new RedirectError()
    }
    if (res.status === 401 || res.status === 403) {
      throw new AuthenticationError()
    }
    if (res.status >= 300 && res.status !== 404) {
      throw new HttpError(res.status, 'GET')
    }

    return { status: res.status, data: await res.text(), headers: res.headers }
  }

  async downloadFileNative(fullURL) {
    let res
    const authString = Base64.encode(
      this.server.username + ':' + this.server.password
    )

    try {
      res = await Http.request({
        url: fullURL,
        method: 'GET',
        headers: {
          Authorization: 'Basic ' + authString
        },
        responseType: 'text'
      })
    } catch (e) {
      Logger.log('Error Caught')
      Logger.log(e)
      throw new NetworkError()
    }

    if (res.status === 401 || res.status === 403) {
      throw new AuthenticationError()
    }
    if (res.status >= 300 && res.status !== 404) {
      throw new HttpError(res.status, 'GET')
    }

    return res
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
