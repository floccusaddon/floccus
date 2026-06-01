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
  SlashError, FileSizeMismatch, FileSizeUnknown, InvalidUrlError
} from '../../errors/Error'
import { CapacitorHttp as Http } from '@capacitor/core'
import Html from '../serializers/Html'
import { Folder, TItemLocation } from '../Tree'

declare const IS_BROWSER: boolean

const LOCK_INTERVAL = 2 * 60 * 1000 // Lock every 2mins while syncing
const LOCK_TIMEOUT = 15 * 60 * 1000 // Override lock 0.25h after last time lock has been set
const PUT_FILE_SIZE_RETRIES = 2
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
    let serverURL
    try {
      serverURL = new URL(input)
    } catch (e) {
      throw new InvalidUrlError(input)
    }
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

  getBookmarkTempURL() {
    return this.getBookmarkURL() + '.temp'
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

    let res, lockFreed, i = 0
    try {
      do {
        Logger.log('Freeing lock: ' + fullUrl)
        res = await this.deleteFile(fullUrl)
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
      if (IS_BROWSER) {
        const fileSize = await this.getRemoteFileSizeOrNull(fullUrl)

        if (fileSize === null || Number.isNaN(fileSize)) {
          throw new FileSizeUnknown()
        }

        const byteLength = new TextEncoder().encode(xmlDocText).length
        if (fileSize !== byteLength) {
          Logger.log('File size mismatch: ' + fileSize + ' != ' + byteLength)
          throw new FileSizeMismatch()
        }
      }

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

  async getBookmarksTree(): Promise<Folder<TItemLocation>> {
    // setHashSettings is called after onSyncStart only but before getBookmarksTree
    // thus we get the hash here again
    this.initialTreeHash = await this.bookmarksCache.hash(this.hashSettings)
    return super.getBookmarksTree()
  }

  async onSyncStart(needLock = true, forceLock = false) {
    Logger.log('onSyncStart: begin')
    this.ended = false

    if (IS_BROWSER) {
      const browser = (await import('../browser-api')).default
      let hasPermissions, error = false
      try {
        hasPermissions = await browser.permissions.contains({ origins: [this.server.url + '/'] })
      } catch (e) {
        error = true
        console.warn(e)
      }
      const {isOrion} = await browser.storage.local.get({'isOrion': false})
      if (!error && !hasPermissions && !isOrion) {
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

    this.initialTreeHash = await this.bookmarksCache.hash(this.hashSettings)

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

    this.bookmarksCache = this.bookmarksCache.clone(false)
    const newTreeHash = await this.bookmarksCache.hash(this.hashSettings)
    if (newTreeHash !== this.initialTreeHash) {
      const fullUrl = this.getBookmarkURL()
      let xbel = this.server.bookmark_file_type === 'xbel' ? createXBEL(this.bookmarksCache, this.highestId) : createHTML(this.bookmarksCache, this.highestId)
      if (this.server.passphrase) {
        const salt = Crypto.bufferToHexstr(Crypto.getRandomBytes(64))
        const ciphertext = await Crypto.encryptAES(this.server.passphrase, xbel, salt)
        xbel = JSON.stringify({ciphertext, salt})
      }
      await this.uploadBookmarkFile(fullUrl, this.server.bookmark_file_type === 'xbel' ? 'application/xml' : 'text/html', xbel)
    } else {
      Logger.log('No changes to the server version necessary')
    }

    await this.freeLock()
  }

  /**
   * Gets the size of a remote file, returning null or NaN if it cannot be determined
   * Likely won't work reliably on native because PROPFIND is not supported there
   */
  async getRemoteFileSizeOrNull(url) {
    try {
      return await this.getFileSize(url)
    } catch (e) {
      if (e instanceof CancelledSyncError) {
        throw e
      }
      console.warn(e)
      Logger.log('Error getting file size: ' + e.message)
      return null
    }
  }

  getContentByteLength(data) {
    return new TextEncoder().encode(data).length
  }

  async verifyUploadedFileSize(url, expectedByteLength) {
    if (!IS_BROWSER) {
      return
    }
    const fileSize = await this.getRemoteFileSizeOrNull(url)

    if (fileSize === null || Number.isNaN(fileSize)) {
      throw new FileSizeUnknown()
    }

    if (fileSize !== expectedByteLength) {
      Logger.log('Uploaded file size mismatch: ' + fileSize + ' != ' + expectedByteLength)
      throw new FileSizeMismatch()
    }
  }

  async uploadBookmarkFile(url, content_type, data) {
    const tempUrl = this.getBookmarkTempURL()
    const expectedByteLength = this.getContentByteLength(data)

    for (let attempt = 0; attempt <= PUT_FILE_SIZE_RETRIES; attempt++) {
      try {
        if (IS_BROWSER) {
          await this.uploadFile(tempUrl, content_type, data)
          await this.verifyUploadedFileSize(tempUrl, expectedByteLength)
          await this.moveFile(tempUrl, url)
        } else {
          await this.uploadFile(url, content_type, data)
        }
        await this.verifyUploadedFileSize(url, expectedByteLength)
        return
      } catch (e) {
        const isLastAttempt = attempt === PUT_FILE_SIZE_RETRIES
        const shouldRetry = e instanceof FileSizeMismatch || e instanceof FileSizeUnknown
        if (IS_BROWSER) {
          await this.deleteBookmarkTempFile(tempUrl)
        }
        if (!shouldRetry || isLastAttempt) {
          throw e
        }
        Logger.log('Uploaded file size verification failed. Retrying upload (' + (attempt + 2) + '/' + (PUT_FILE_SIZE_RETRIES + 1) + ')')
      }
    }
  }

  async uploadFile(url, content_type, data) {
    if (IS_BROWSER) {
      return this.uploadFileWeb(url, content_type, data)
    } else {
      return this.uploadFileNative(url, content_type, data)
    }
  }

  async deleteBookmarkFile(url) {
    const res = await this.deleteFile(url)
    if ((res.status < 200 || res.status >= 300) && res.status !== 404) {
      throw new HttpError(res.status, 'DELETE')
    }
  }

  async deleteBookmarkTempFile(url) {
    try {
      await this.deleteBookmarkFile(url)
    } catch (e) {
      Logger.log('Failed to clean up temporary bookmark file: ' + e.message)
    }
  }

  async deleteFile(url) {
    if (IS_BROWSER) {
      return this.deleteFileWeb(url)
    } else {
      return this.deleteFileNative(url)
    }
  }

  async moveFile(url, destinationUrl) {
    if (IS_BROWSER) {
      return this.moveFileWeb(url, destinationUrl)
    } else {
      return this.moveFileNative(url, destinationUrl)
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
        credentials: this.server.includeCredentials ? 'include' : 'omit',
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
          Authorization: 'Basic ' + authString,
        },
        data,
        disableRedirects: !this.server.allowRedirects,
      })
    } catch (e) {
      Logger.log('Error Caught')
      Logger.log(e)
      throw new NetworkError()
    }
    if (res.status === 401 || res.status === 403) {
      throw new AuthenticationError()
    }

    if (res.status < 400 && res.status >= 300) {
      throw new RedirectError()
    }

    if (res.status >= 300) {
      throw new HttpError(res.status, 'PUT')
    }
  }

  async deleteFileWeb(url) {
    const authString = Base64.encode(
      this.server.username + ':' + this.server.password
    )
    let res
    try {
      res = await fetch(url, {
        method: 'DELETE',
        credentials: this.server.includeCredentials ? 'include' : 'omit',
        headers: {
          Authorization: 'Basic ' + authString
        },
        signal: this.abortSignal,
        ...(!this.server.allowRedirects && {redirect: 'manual'}),
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
    return res
  }

  async deleteFileNative(url) {
    const authString = Base64.encode(
      this.server.username + ':' + this.server.password
    )
    let res
    try {
      res = await Http.request({
        url,
        method: 'DELETE',
        headers: {
          Authorization: 'Basic ' + authString,
        },
        webFetchExtra: {
          credentials: 'omit',
        },
        disableRedirects: !this.server.allowRedirects,
      })
    } catch (e) {
      Logger.log('Error Caught')
      Logger.log(e)
      throw new NetworkError()
    }
    if (res.status === 401 || res.status === 403) {
      throw new AuthenticationError()
    }

    if (res.status < 400 && res.status >= 300) {
      throw new RedirectError()
    }

    return res
  }

  async moveFileWeb(url, destinationUrl) {
    const authString = Base64.encode(
      this.server.username + ':' + this.server.password
    )
    let res
    try {
      res = await fetch(url, {
        method: 'MOVE',
        credentials: this.server.includeCredentials ? 'include' : 'omit',
        headers: {
          Authorization: 'Basic ' + authString,
          Destination: destinationUrl,
          Overwrite: 'T',
        },
        signal: this.abortSignal,
        ...(!this.server.allowRedirects && {redirect: 'manual'}),
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
      throw new HttpError(res.status, 'MOVE')
    }
    return res
  }

  async moveFileNative(url, destinationUrl) {
    const authString = Base64.encode(
      this.server.username + ':' + this.server.password
    )
    let res
    try {
      res = await Http.request({
        url,
        method: 'MOVE',
        headers: {
          Authorization: 'Basic ' + authString,
          Destination: destinationUrl,
          Overwrite: 'T',
        },
        disableRedirects: !this.server.allowRedirects,
      })
    } catch (e) {
      Logger.log('Error Caught')
      Logger.log(e)
      throw new NetworkError()
    }
    if (res.status === 401 || res.status === 403) {
      throw new AuthenticationError()
    }

    if (res.status < 400 && res.status >= 300) {
      throw new RedirectError()
    }

    if (res.status >= 300) {
      throw new HttpError(res.status, 'MOVE')
    }

    return res
  }

  async downloadFile(url) {
    if (IS_BROWSER) {
      return this.downloadFileWeb(url)
    } else {
      return this.downloadFileNative(url)
    }
  }

  async getFileSize(url) {
    if (IS_BROWSER) {
      return this.getFileSizeWeb(url)
    } else {
      return this.getFileSizeNative(url)
    }
  }

  async getFileSizeWeb(url): Promise<number|null> {
    const authString = Base64.encode(
      this.server.username + ':' + this.server.password
    )
    let res
    try {
      res = await fetch(url,{
        method: 'PROPFIND',
        headers: {
          Authorization: 'Basic ' + authString,
          Depth: '0',
        },
        cache: 'no-store',
        credentials: this.server.includeCredentials ? 'include' : 'omit',
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
      throw new HttpError(res.status, 'PROPFIND')
    }

    const xml = await res.text()
    const match = xml.match(/<.*?:?getcontentlength[^>]*?>(.*?)</)
    return match ? parseInt(match[1]) : null
  }

  async getFileSizeNative(url): Promise<number|null> {
    let res
    const authString = Base64.encode(
      this.server.username + ':' + this.server.password
    )

    try {
      res = await Http.request({
        url: url,
        method: 'HEAD',
        headers: {
          Authorization: 'Basic ' + authString,
          Pragma: 'no-cache',
          'Cache-Control': 'no-cache',
        },
        responseType: 'text',
        disableRedirects: !this.server.allowRedirects,
      })
    } catch (e) {
      Logger.log('Error Caught')
      Logger.log(e)
      throw new NetworkError()
    }

    if (res.status === 401 || res.status === 403) {
      throw new AuthenticationError()
    }

    if (res.status < 400 && res.status >= 300) {
      throw new RedirectError()
    }

    if (res.status >= 300 && res.status !== 404) {
      throw new HttpError(res.status, 'HEAD')
    }

    const size = res.headers['Content-Length'] || res.headers['content-length']
    return parseInt(size)
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
        credentials: this.server.includeCredentials ? 'include' : 'omit',
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

    return { status: res.status, data: await res.text(), headers: Object.fromEntries(res.headers.entries()) }
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
          'Cache-Control': 'no-cache',
        },
        responseType: 'text',
        disableRedirects: !this.server.allowRedirects,
      })
    } catch (e) {
      Logger.log('Error Caught')
      Logger.log(e)
      throw new NetworkError()
    }

    if (res.status === 401 || res.status === 403) {
      throw new AuthenticationError()
    }

    if (res.status < 400 && res.status >= 300) {
      throw new RedirectError()
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
