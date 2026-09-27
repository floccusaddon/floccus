import { Capacitor, CapacitorHttp as Http } from '@capacitor/core'
import { Base64 } from 'js-base64'
import type { GitHttpRequest, GitHttpResponse, HttpClient } from 'isomorphic-git'

/**
 * isomorphic-git's HTTP client for the native app.
 *
 * The WebView's fetch can't reach git servers (CORS), and CapacitorHttp's
 * patched fetch, which can, turns request bodies into UTF-8 text and reads
 * responses as text -- both of which corrupt packfiles. So we talk to the
 * plugin directly, the only way it moves raw bytes: the request body as base64
 * with dataType 'file', the response as base64 via responseType 'arraybuffer'.
 */

// Android below 8 (API 26) writes nothing for a dataType 'file' body
const MIN_ANDROID_SDK_FOR_RAW_BODIES = 26

let rawBodiesSupported: Promise<boolean> = null
function supportsRawBodies(): Promise<boolean> {
  if (!rawBodiesSupported) {
    rawBodiesSupported = (async() => {
      if (Capacitor.getPlatform() !== 'android') {
        return true
      }
      const { Device } = await import('@capacitor/device')
      const { androidSDKVersion } = await Device.getInfo()
      return typeof androidSDKVersion !== 'number' || androidSDKVersion >= MIN_ANDROID_SDK_FOR_RAW_BODIES
    })()
  }
  return rawBodiesSupported
}

async function collect(body: GitHttpRequest['body']): Promise<Uint8Array> {
  const chunks: Uint8Array[] = []
  // for await takes plain arrays of chunks, too
  for await (const chunk of body) {
    chunks.push(chunk)
  }
  const result = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.byteLength, 0))
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.byteLength
  }
  return result
}

function toBytes(data: unknown, status: number): Uint8Array {
  if (data === null || typeof data === 'undefined') {
    return new Uint8Array(0)
  }
  // JSON responses come back parsed, whatever responseType says
  if (typeof data !== 'string') {
    return new TextEncoder().encode(JSON.stringify(data))
  }
  // Android reads error responses as text even for responseType 'arraybuffer';
  // iOS encodes them as base64 like everything else
  if (status >= 400 && Capacitor.getPlatform() === 'android') {
    return new TextEncoder().encode(data)
  }
  return Base64.toUint8Array(data)
}

const CapacitorGitHttp: HttpClient = {
  async request({ url, method = 'GET', headers = {}, body }: GitHttpRequest): Promise<GitHttpResponse> {
    const payload = body ? await collect(body) : null
    const requestHeaders = { ...headers }
    if (payload && payload.byteLength) {
      if (!(await supportsRawBodies())) {
        throw new Error('Git sync in the app needs Android 8 or newer')
      }
      // Android sends no body at all for a request without a Content-Type
      if (!Object.keys(requestHeaders).some((key) => key.toLowerCase() === 'content-type')) {
        requestHeaders['Content-Type'] = 'application/octet-stream'
      }
    }
    const res = await Http.request({
      url,
      method,
      headers: requestHeaders,
      responseType: 'arraybuffer',
      ...(payload && payload.byteLength && {
        data: Base64.fromUint8Array(payload),
        dataType: 'file',
      }),
    })
    // isomorphic-git looks headers up in lower case
    const responseHeaders: Record<string, string> = {}
    for (const [key, value] of Object.entries(res.headers || {})) {
      responseHeaders[key.toLowerCase()] = String(value)
    }
    return {
      url: res.url || url,
      method,
      statusCode: res.status,
      // CapacitorHttp doesn't pass on the status text
      statusMessage: String(res.status),
      headers: responseHeaders,
      body: (async function * () {
        yield toBytes(res.data, res.status)
      })(),
    }
  },
}

export default CapacitorGitHttp
