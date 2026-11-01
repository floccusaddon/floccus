import CachingAdapter from './Caching'
import XbelSerializer from '../serializers/Xbel'
import Html from '../serializers/Html'
import Logger from '../Logger'
import Crypto from '../Crypto'
import {
  AuthenticationError,
  CancelledSyncError,
  DecryptionError,
  FileUnreadableError,
  HttpError,
  InvalidUrlError,
  LockFileError,
  MissingPermissionsError,
  NetworkError,
  RemoteFileChangedError,
  ResourceLockedError,
  S3BucketNotFoundError,
  SlashError,
} from '../../errors/Error'
import { CapacitorHttp as Http } from '@capacitor/core'
import { Folder, TItemLocation } from '../Tree'
import { EMPTY_PAYLOAD_HASH, s3UriEncode, sha256Hex, signS3Request } from '../S3Signer'

declare const IS_BROWSER: boolean

const LOCK_INTERVAL = 2 * 60 * 1000 // Refresh the lock every 2mins while syncing
const LOCK_TIMEOUT = 15 * 60 * 1000 // Override a lock 0.25h after it was last refreshed
const CONNECT_TIMEOUT = 30 * 1000 // native only
const READ_TIMEOUT = 60 * 1000 // native only: max. silence while waiting for data

interface IS3Response {
  status: number
  data: string
  // lower-cased header names
  headers: Record<string, string>
}

interface IConditions {
  // Only write if the object still has this ETag
  ifMatch?: string
  // Only write if the object doesn't exist
  ifNoneMatch?: boolean
}

/**
 * Stores the bookmarks in one object of an S3 (compatible) bucket, the same
 * file format WebDAV uses (XBEL or HTML, optionally encrypted).
 *
 * Concurrent syncs are kept apart by a `<key>.lock` object like on WebDAV. On
 * top of that, writes are conditional where the server supports it: the lock
 * is created with `If-None-Match: *` (or taken over with `If-Match` on the
 * stale lock's ETag), and the bookmarks object is only overwritten if it still
 * has the ETag it had when the sync downloaded it. A server that doesn't
 * implement conditional writes answers 501 and is then written to without
 * conditions, leaving the lock object as the only safeguard.
 */
export default class S3Adapter extends CachingAdapter {
  private lockingInterval: any
  private lockingPromise: Promise<any>
  private locked: boolean
  private ended: boolean
  private abortController: AbortController
  private abortSignal: AbortSignal
  private cancelCallback: () => void
  private initialTreeHash: string
  // ETag of the bookmarks object as downloaded, null if there was none
  private remoteEtag: string | null = null
  private conditionalWritesUnsupported = false

  constructor(server) {
    super(server)
    this.server = server
    this.locked = false
    this.ended = true
    this.lockingInterval = null
    this.abortController = new AbortController()
    this.abortSignal = this.abortController.signal
  }

  static getDefaultValues() {
    return {
      type: 's3',
      url: 'https://s3.amazonaws.com/',
      region: 'us-east-1',
      bucket: 'bookmarks',
      pathStyle: true,
      username: '',
      password: '',
      bookmark_file: 'bookmarks.xbel',
      bookmark_file_type: 'xbel',
      passphrase: '',
      allowNetwork: false,
    }
  }

  getData() {
    return { ...S3Adapter.getDefaultValues(), ...this.server }
  }

  getLabel(): string {
    const data = this.getData()
    if (data.label) return data.label
    let host = data.url
    try {
      host = new URL(data.url).host
    } catch (e) {
      // keep the raw value
    }
    return data.bucket + '/' + data.bookmark_file + '@' + host
  }

  cancel() {
    this.abortController.abort()
    this.cancelCallback && this.cancelCallback()
  }

  timeout(ms) {
    return new Promise((resolve, reject) => {
      setTimeout(resolve, ms)
      this.cancelCallback = () => reject(new CancelledSyncError())
    })
  }

  getEndpoint(): URL {
    let endpoint
    try {
      endpoint = new URL(this.server.url)
    } catch (e) {
      throw new InvalidUrlError(this.server.url)
    }
    if (!endpoint.protocol.startsWith('http')) {
      throw new InvalidUrlError(this.server.url)
    }
    return endpoint
  }

  getBookmarkKey(): string {
    return this.server.bookmark_file
  }

  getLockKey(): string {
    return this.getBookmarkKey() + '.lock'
  }

  /**
   * The URL of an object, or of the bucket itself if no key is given. The path
   * is encoded the way SigV4 needs it, so it is used verbatim for the request.
   */
  getUrl(key?: string): string {
    const endpoint = this.getEndpoint()
    const data = this.getData()
    const basePath = endpoint.pathname.replace(/\/+$/, '')
    const encodedKey = typeof key === 'string' ? s3UriEncode(key, false) : null
    if (data.pathStyle) {
      return `${endpoint.origin}${basePath}/${s3UriEncode(data.bucket)}` +
        (encodedKey !== null ? '/' + encodedKey : '')
    }
    return `${endpoint.protocol}//${data.bucket}.${endpoint.host}${basePath}/` +
      (encodedKey !== null ? encodedKey : '')
  }

  async request(method: string, key: string | undefined, { body, contentType, conditions }: {
    body?: string,
    contentType?: string,
    conditions?: IConditions,
  } = {}): Promise<IS3Response> {
    const url = this.getUrl(key)
    const headers: Record<string, string> = {}
    if (contentType) {
      headers['Content-Type'] = contentType
    }
    if (conditions?.ifMatch) {
      headers['If-Match'] = conditions.ifMatch
    }
    if (conditions?.ifNoneMatch) {
      headers['If-None-Match'] = '*'
    }
    const signedHeaders = await signS3Request({
      method,
      url,
      headers,
      payloadHash: typeof body === 'string' ? await sha256Hex(body) : EMPTY_PAYLOAD_HASH,
      credentials: {
        accessKeyId: this.server.username,
        secretAccessKey: this.server.password,
        region: this.getData().region || 'us-east-1',
      },
    })

    if (IS_BROWSER) {
      let res
      try {
        res = await fetch(url, {
          method,
          headers: signedHeaders,
          cache: 'no-store',
          credentials: 'omit',
          signal: this.abortSignal,
          ...(typeof body === 'string' && { body }),
        })
      } catch (e) {
        Logger.log('Error Caught')
        Logger.log(e)
        if (this.abortSignal.aborted) throw new CancelledSyncError()
        throw new NetworkError()
      }
      const responseHeaders = {}
      res.headers.forEach((value, name) => {
        responseHeaders[name.toLowerCase()] = value
      })
      return { status: res.status, data: method === 'HEAD' ? '' : await res.text(), headers: responseHeaders }
    }

    let res
    try {
      res = await Http.request({
        url,
        method,
        headers: {
          ...signedHeaders,
          Pragma: 'no-cache',
          'Cache-Control': 'no-cache',
        },
        responseType: 'text',
        // HttpURLConnection waits indefinitely by default, e.g. for an
        // unreachable host; readTimeout limits inactivity, not the transfer
        connectTimeout: CONNECT_TIMEOUT,
        readTimeout: READ_TIMEOUT,
        ...(typeof body === 'string' && { data: body }),
        webFetchExtra: {
          credentials: 'omit',
        },
      })
    } catch (e) {
      // Android's HttpURLConnection throws instead of answering a 4xx without
      // a body (any HEAD, an empty 404); CapacitorHttp passes that on as an error
      const status = S3Adapter.statusOfNativeError(e)
      if (status) {
        return { status, data: '', headers: {} }
      }
      Logger.log('Error Caught')
      Logger.log(e)
      throw new NetworkError()
    }
    const responseHeaders = {}
    for (const [name, value] of Object.entries(res.headers || {})) {
      responseHeaders[name.toLowerCase()] = String(value)
    }
    return {
      status: res.status,
      data: typeof res.data === 'string' ? res.data : (res.data ? JSON.stringify(res.data) : ''),
      headers: responseHeaders,
    }
  }

  static statusOfNativeError(e: any): number | null {
    if (e && e.code === 'FileNotFoundException') {
      // HttpURLConnection throws this for 404 and 410 only
      return 404
    }
    const match = e && typeof e.message === 'string' && e.message.match(/response code: (\d{3})/)
    return match ? parseInt(match[1]) : null
  }

  static getErrorCode(res: IS3Response): string | null {
    const match = res.data && res.data.match(/<Code>([^<]*)<\/Code>/)
    return match ? match[1] : null
  }

  /**
   * Throws for the errors every request can run into; 404 for a missing
   * object, 412 for a failed condition and 501 are left to the caller.
   */
  checkResponse(res: IS3Response, method: string): void {
    if (res.status >= 200 && res.status < 300) return
    const code = S3Adapter.getErrorCode(res)
    if (code) {
      Logger.log(`S3 ${method} failed with ${res.status} ${code}`)
    }
    if (res.status === 401 || res.status === 403) {
      throw new AuthenticationError()
    }
    if (res.status === 404 && code === 'NoSuchBucket') {
      throw new S3BucketNotFoundError(this.getData().bucket)
    }
    if (res.status === 404 || res.status === 412 || res.status === 501) return
    // 301 PermanentRedirect / 400 AuthorizationHeaderMalformed: wrong region
    const region = res.headers['x-amz-bucket-region']
    if (region) {
      Logger.log(`The bucket is in region ${region}, not ${this.getData().region}`)
    }
    throw new HttpError(res.status, method)
  }

  static isConditionUnsupported(res: IS3Response): boolean {
    return res.status === 501 || (res.status === 400 && S3Adapter.getErrorCode(res) === 'NotImplemented')
  }

  /**
   * PUTs an object, conditionally if requested and supported.
   * Resolves to the response, whose status is 412 if a condition failed.
   */
  async putObject(key: string, contentType: string, body: string, conditions?: IConditions): Promise<IS3Response> {
    const useConditions = conditions && !this.conditionalWritesUnsupported
      ? conditions
      : undefined
    let res = await this.request('PUT', key, { body, contentType, conditions: useConditions })
    if (useConditions && S3Adapter.isConditionUnsupported(res)) {
      Logger.log('S3 server does not support conditional writes, writing without conditions')
      this.conditionalWritesUnsupported = true
      res = await this.request('PUT', key, { body, contentType })
    }
    if (res.status === 409 && S3Adapter.getErrorCode(res) === 'ConditionalRequestConflict') {
      // Another conditional write to the same key was in flight
      return { ...res, status: 412 }
    }
    this.checkResponse(res, 'PUT')
    if (res.status === 404 || res.status === 501) {
      throw new HttpError(res.status, 'PUT')
    }
    return res
  }

  async testConnection(): Promise<void> {
    const res = await this.request('HEAD', undefined)
    if (res.status === 404) {
      throw new S3BucketNotFoundError(this.getData().bucket)
    }
    const region = res.headers['x-amz-bucket-region']
    if ((res.status === 301 || res.status === 400) && region && region !== this.getData().region) {
      throw new Error(`The bucket is located in region "${region}". Please enter that region.`)
    }
    this.checkResponse(res, 'HEAD')
  }

  async obtainLock() {
    // GET rather than HEAD: an error with a body reaches us on every platform
    const res = await this.request('GET', this.getLockKey())
    this.checkResponse(res, 'GET')
    if (res.status === 200) {
      const lastModified = res.headers['last-modified']
      if (!lastModified || Date.parse(lastModified) + LOCK_TIMEOUT > Date.now()) {
        throw new ResourceLockedError()
      }
      // The lock is stale: take it over, unless someone else beats us to it
      await this.setLock({ ifMatch: res.headers['etag'] })
    } else if (res.status === 404) {
      await this.setLock({ ifNoneMatch: true })
    } else {
      throw new LockFileError(res.status, this.getLockKey())
    }
  }

  async setLock(conditions?: IConditions) {
    Logger.log('Setting lock: ' + this.getLockKey())
    this.lockingPromise = this.putObject(
      this.getLockKey(),
      'text/plain',
      'I am a lock file',
      conditions
    )
    let res
    try {
      res = await this.lockingPromise
    } catch (e) {
      this.locked = false
      throw e
    }
    if (res.status === 412) {
      this.locked = false
      throw new ResourceLockedError()
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

    let lockFreed = false, i = 0
    try {
      do {
        Logger.log('Freeing lock: ' + this.getLockKey())
        const res = await this.request('DELETE', this.getLockKey())
        lockFreed = (res.status >= 200 && res.status < 300) || res.status === 404
        if (!lockFreed) {
          await this.timeout(1000)
        }
        i++
      } while (!lockFreed && i < 10)
      if (lockFreed) {
        this.locked = false
      }
      return lockFreed
    } catch (e) {
      Logger.log('Error Caught')
      Logger.log(e)
    }
  }

  async pullFromServer(): Promise<IS3Response> {
    const res = await this.request('GET', this.getBookmarkKey())
    this.checkResponse(res, 'GET')

    if (res.status === 404) {
      this.remoteEtag = null
      this.resetCache()
      return res
    }
    if (res.status !== 200) {
      throw new HttpError(res.status, 'GET')
    }

    this.remoteEtag = res.headers['etag'] || null
    let xmlDocText = res.data

    if (this.server.passphrase) {
      try {
        const json = JSON.parse(xmlDocText)
        xmlDocText = await Crypto.decryptAES(this.server.passphrase, json.ciphertext, json.salt)
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

    return res
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

    if (this.server.bookmark_file[0] === '/') {
      throw new SlashError()
    }

    if (IS_BROWSER) {
      const browser = (await import('../browser-api')).default
      let hasPermissions, error = false
      try {
        hasPermissions = await browser.permissions.contains({ origins: [new URL(this.getUrl()).origin + '/'] })
      } catch (e) {
        error = true
        console.warn(e)
      }
      const {isOrion} = await browser.storage.local.get({'isOrion': false})
      if (!error && !hasPermissions && !isOrion) {
        throw new MissingPermissionsError()
      }
    }

    this.abortController = new AbortController()
    this.abortSignal = this.abortController.signal

    if (forceLock) {
      await this.setLock()
    } else if (needLock) {
      await this.obtainLock()
    }

    // If this throws, Account#sync calls onSyncFail, which frees the lock
    const resp = await this.pullFromServer()

    this.initialTreeHash = await this.bookmarksCache.hash(this.hashSettings)

    Logger.log('onSyncStart: completed')

    if (this.lockingInterval) {
      clearInterval(this.lockingInterval)
    }
    if (needLock || forceLock) {
      this.lockingInterval = setInterval(() => {
        if (this.ended) return
        this.setLock().catch((e) => {
          Logger.log('Failed to refresh lock')
          Logger.log(e)
        })
      }, LOCK_INTERVAL)
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
      let content = this.server.bookmark_file_type === 'xbel'
        ? createXBEL(this.bookmarksCache, this.highestId)
        : createHTML(this.bookmarksCache, this.highestId)
      if (this.server.passphrase) {
        const salt = Crypto.bufferToHexstr(Crypto.getRandomBytes(64))
        const ciphertext = await Crypto.encryptAES(this.server.passphrase, content, salt)
        content = JSON.stringify({ciphertext, salt})
      }
      const res = await this.putObject(
        this.getBookmarkKey(),
        this.server.bookmark_file_type === 'xbel' ? 'application/xml' : 'text/html',
        content,
        this.remoteEtag ? { ifMatch: this.remoteEtag } : { ifNoneMatch: true }
      )
      if (res.status === 412) {
        // Somebody wrote the file since we downloaded it (e.g. a forced sync
        // that ignored our lock). Don't clobber their changes; onSyncFail
        // frees the lock.
        throw new RemoteFileChangedError()
      }
      this.remoteEtag = res.headers['etag'] || null
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
