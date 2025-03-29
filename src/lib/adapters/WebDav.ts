import CachingAdapter from './Caching'
import XbelSerializer from '../serializers/Xbel'
import Logger from '../Logger'
import { Base64 } from 'js-base64'

import Crypto from '../Crypto'
import {
  AuthenticationError,
  DecryptionError, FileUnreadableError,
  HttpError, CancelledSyncError,
  LockFileError, MissingPermissionsError,
  NetworkError, RedirectError, ResourceLockedError,
  SlashError
} from '../../errors/Error'
import { CapacitorHttp as Http } from '@capacitor/core'
import { Capacitor } from '@capacitor/core'
import Html from '../serializers/Html'

const LOCK_INTERVAL = 2 * 60 * 1000 // Lock every 2mins while syncing
const LOCK_TIMEOUT = 15 * 60 * 1000 // Override lock 0.25h after last time lock has been set
export default class WebDavAdapter extends CachingAdapter {
  private lockingInterval: any
  private lockingPromise: Promise<any>
  private locked: boolean
  private ended: boolean
  private abortController: AbortController
  private abortSignal: AbortSignal
  private cancelCallback: () => void
  private initialTreeHash: string
  constructor(server) {
    super(server)
    this.server = server
    this.locked = false
    this.ended = true
    this.lockingInterval = null
  }

  static getDefaultValues() {
    return {
      type: 'webdav',
      url: 'https://example.org/',
      username: 'bob',
      password: 's3cret',
      bookmark_file: 'bookmarks.xbel',
      bookmark_file_type: 'xbel',
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
    const serverURL = new URL(input)
    if (!serverURL.pathname) serverURL.pathname = ''
    serverURL.search = ''
    serverURL.hash = ''
    const output = serverURL.toString()
    return output + (output[output.length - 1] !== '/' ? '/' : '')
  }

  cancel() {
    this.abortController.abort()
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
      this.cancelCallback = () => reject(new CancelledSyncError())
    })
  }

  async obtainLock() {
    const res = await this.checkLock()
    if (res.status === 200) {
      if (res.headers['Last-Modified']) {
        const date = new Date(res.headers['Last-Modified'])
        const dateLocked = date.valueOf()
        if (dateLocked + LOCK_TIMEOUT > Date.now()) {
          throw new ResourceLockedError()
        }
      } else {
        throw new ResourceLockedError()
      }
    }

    if (res.status === 200) {
      // continue anyway
      this.locked = true
    } else if (res.status === 404) {
      await this.setLock()
    } else {
      throw new LockFileError(
        res.status,
        this.server.bookmark_file + '.lock'
      )
    }
  }

  async setLock() {
    const fullURL = this.getBookmarkLockURL()
    Logger.log('Setting lock: ' + fullURL)
    this.lockingPromise = this.uploadFile(
      fullURL,
      'text/html',
      '<html><body>I am a lock file</body></html>'
    )
    try {
      await this.lockingPromise
    } catch (e) {
      if (e instanceof HttpError && (e.status === 423 || e.status === 409)) {
        this.locked = false
        throw new ResourceLockedError()
      }
      throw e
    }
    this.locked = true
  }

  async freeLock() {
    if (this.lockingPromise) {
      try {
        await this.lockingPromise
      } catch (e) {
        console.warn(e)
      }
    }
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
        Logger.log('Freeing lock: ' + fullUrl)
        if (Capacitor.getPlatform() === 'web') {
          res = await fetch(fullUrl, {
            method: 'DELETE',
            credentials: 'omit',
            headers: {
              Authorization: 'Basic ' + authString
            },
            signal: this.abortSignal,
            ...(!this.server.allowRedirects && {redirect: 'manual'}),
          })
        } else {
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
        }
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
          try {
            const json = JSON.parse(xmlDocText)
            xmlDocText = await Crypto.decryptAES(this.server.passphrase, json.ciphertext, json.salt)
          } catch (e) {
            xmlDocText = await Crypto.decryptAES(this.server.passphrase, xmlDocText, this.server.bookmark_file)
          }
        } catch (e) {
          if (xmlDocText && (xmlDocText.includes('<?xml version="1.0" encoding="UTF-8"?>') || xmlDocText.includes('<!DOCTYPE NETSCAPE-Bookmark-file-1>'))) {
            // not encrypted, yet => noop
          } else {
            throw new DecryptionError()
          }
        }
      }
      if (!xmlDocText || (!xmlDocText.includes('<?xml version="1.0" encoding="UTF-8"?>') && !xmlDocText.includes('<!DOCTYPE NETSCAPE-Bookmark-file-1>'))) {
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

      switch (this.server.bookmark_file_type) {
        case 'xbel':
          if (!xmlDocText.includes('<?xml version="1.0" encoding="UTF-8"?>')) {
            throw new FileUnreadableError()
          }
          this.bookmarksCache = XbelSerializer.deserialize(xmlDocText)
          break
        case 'html':
          if (!xmlDocText.includes('<!DOCTYPE NETSCAPE-Bookmark-file-1>')) {
            throw new FileUnreadableError()
          }
          this.bookmarksCache = Html.deserialize(xmlDocText)
          break
        default:
          throw new Error('Invalid bookmark file type')
      }
    }

    return response
  }

  async onSyncStart(needLock = true, forceLock = false) {
    Logger.log('onSyncStart: begin')
    this.ended = false

    if (Capacitor.getPlatform() === 'web') {
      const browser = (await import('../browser-api')).default
      let hasPermissions, error = false
      try {
        hasPermissions = await browser.permissions.contains({ origins: [this.server.url + '/'] })
      } catch (e) {
        error = true
        console.warn(e)
      }
      if (!error && !hasPermissions) {
        throw new MissingPermissionsError()
      }
    }

    if (this.server.bookmark_file[0] === '/') {
      throw new SlashError()
    }

    this.abortController = new AbortController()
    this.abortSignal = this.abortController.signal

    if (forceLock) {
      await this.setLock()
    } else if (needLock) {
      await this.obtainLock()
    }

    const resp = await this.pullFromServer()

    if (resp.status !== 200) {
      if (resp.status !== 404) {
        throw new HttpError(resp.status, 'GET')
      }
    }

    this.initialTreeHash = await this.bookmarksCache.hash(true)

    Logger.log('onSyncStart: completed')

    if (this.lockingInterval) {
      clearInterval(this.lockingInterval)
    }
    if (needLock || forceLock) {
      this.lockingInterval = setInterval(() => !this.ended && this.setLock(), LOCK_INTERVAL) // Set lock every minute
    }

    if (resp.status === 404) {
      // Notify sync process that we need to reset cache
      return false
    }
  }

  async onSyncFail() {
    Logger.log('onSyncFail')
    this.ended = true
    clearInterval(this.lockingInterval)
    await this.freeLock()
  }

  async onSyncComplete() {
    Logger.log('onSyncComplete')
    this.ended = true
    clearInterval(this.lockingInterval)

    this.bookmarksCache = this.bookmarksCache.clone()
    const newTreeHash = await this.bookmarksCache.hash(true)
    if (newTreeHash !== this.initialTreeHash) {
      const fullUrl = this.getBookmarkURL()
      let xbel = this.server.bookmark_file_type === 'xbel' ? createXBEL(this.bookmarksCache, this.highestId) : createHTML(this.bookmarksCache, this.highestId)
      if (this.server.passphrase) {
        const salt = Crypto.bufferToHexstr(Crypto.getRandomBytes(64))
        const ciphertext = await Crypto.encryptAES(this.server.passphrase, xbel, salt)
        xbel = JSON.stringify({ciphertext, salt})
      }
      await this.uploadFile(fullUrl, this.server.bookmark_file_type === 'xbel' ? 'application/xml' : 'text/html', xbel)
    } else {
      Logger.log('No changes to the server version necessary')
    }

    await this.freeLock()
  }

  async uploadFile(url, content_type, data) {
    if (Capacitor.getPlatform() === 'web') {
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
        signal: this.abortSignal,
        ...(!this.server.allowRedirects && {redirect: 'manual'}),
        body: data,
      })
    } catch (e) {
      Logger.log('Error Caught')
      Logger.log(e)
      if (this.abortSignal.aborted) throw new CancelledSyncError()
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
    if (Capacitor.getPlatform() === 'web') {
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
        cache: 'no-store',
        credentials: 'omit',
        signal: this.abortSignal,
        ...(!this.server.allowRedirects && {redirect: 'manual'})
      })
    } catch (e) {
      Logger.log('Error Caught')
      Logger.log(e)
      if (this.abortSignal.aborted) throw new CancelledSyncError()
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
          Authorization: 'Basic ' + authString,
          Pragma: 'no-cache',
          'Cache-Control': 'no-cache'
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

function createHTML(rootFolder, highestId) {
  let output = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>`

  output +=
    '<!--- highestId :' +
    highestId +
    `: for Floccus bookmark sync browser extension -->
`

  output += Html.serialize(rootFolder)

  output += '</html>'

  return output
}
