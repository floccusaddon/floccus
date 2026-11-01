/**
 * AWS Signature Version 4 for S3 requests, built on WebCrypto so that it runs
 * unchanged in the extension, the Capacitor WebView and node.
 *
 * Only `host` and the `x-amz-*` headers are signed (plus any header the caller
 * names in `signedHeaders`): `fetch` and CapacitorHttp may rewrite other headers
 * like Content-Type on the way out, which would break the signature.
 */

export interface IS3Credentials {
  accessKeyId: string
  secretAccessKey: string
  sessionToken?: string
  region: string
}

export interface IS3SignInput {
  method: string
  // Absolute URL whose path is already encoded with `s3UriEncode`
  url: string
  headers?: Record<string, string>
  // Lower-cased names of further headers in `headers` to sign
  signedHeaders?: string[]
  payloadHash: string
  credentials: IS3Credentials
  date?: Date
}

export const EMPTY_PAYLOAD_HASH = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'

const encoder = new TextEncoder()

/**
 * Percent-encodes everything except the unreserved characters, as SigV4
 * requires (encodeURIComponent leaves !'()* alone).
 */
export function s3UriEncode(str: string, encodeSlash = true): string {
  const encoded = encodeURIComponent(str).replace(
    /[!'()*]/g,
    (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase()
  )
  return encodeSlash ? encoded : encoded.replace(/%2F/g, '/')
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export async function sha256Hex(data: string): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', encoder.encode(data)))
}

async function hmac(key: ArrayBuffer | Uint8Array<ArrayBuffer>, message: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  return crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(message))
}

function amzDate(date: Date): string {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, '')
}

function canonicalQueryString(search: string): string {
  if (!search || search === '?') return ''
  return search
    .slice(1)
    .split('&')
    .filter(Boolean)
    .map((pair) => {
      const idx = pair.indexOf('=')
      const key = decodeURIComponent((idx < 0 ? pair : pair.slice(0, idx)).replace(/\+/g, ' '))
      const value = idx < 0 ? '' : decodeURIComponent(pair.slice(idx + 1).replace(/\+/g, ' '))
      return [s3UriEncode(key), s3UriEncode(value)]
    })
    .sort(([k1, v1], [k2, v2]) => (k1 < k2 ? -1 : k1 > k2 ? 1 : v1 < v2 ? -1 : v1 > v2 ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('&')
}

/**
 * Returns the headers to send: the given ones plus `x-amz-date`,
 * `x-amz-content-sha256`, `x-amz-security-token` (if any) and `Authorization`.
 */
export async function signS3Request(input: IS3SignInput): Promise<Record<string, string>> {
  const url = new URL(input.url)
  const date = input.date || new Date()
  const timestamp = amzDate(date)
  const day = timestamp.slice(0, 8)
  const { accessKeyId, secretAccessKey, sessionToken, region } = input.credentials

  const headers: Record<string, string> = {
    ...(input.headers || {}),
    'x-amz-date': timestamp,
    'x-amz-content-sha256': input.payloadHash,
  }
  if (sessionToken) {
    headers['x-amz-security-token'] = sessionToken
  }

  const toSign: Record<string, string> = { host: url.host }
  const extra = new Set((input.signedHeaders || []).map((h) => h.toLowerCase()))
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase()
    if (lower.startsWith('x-amz-') || extra.has(lower)) {
      toSign[lower] = String(value).trim().replace(/\s+/g, ' ')
    }
  }
  const signedHeaderNames = Object.keys(toSign).sort()
  const canonicalHeaders = signedHeaderNames.map((h) => `${h}:${toSign[h]}\n`).join('')
  const signedHeaders = signedHeaderNames.join(';')

  const canonicalRequest = [
    input.method.toUpperCase(),
    url.pathname || '/',
    canonicalQueryString(url.search),
    canonicalHeaders,
    signedHeaders,
    input.payloadHash,
  ].join('\n')

  const scope = `${day}/${region}/s3/aws4_request`
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    timestamp,
    scope,
    await sha256Hex(canonicalRequest),
  ].join('\n')

  const kDate = await hmac(encoder.encode('AWS4' + secretAccessKey), day)
  const kRegion = await hmac(kDate, region)
  const kService = await hmac(kRegion, 's3')
  const kSigning = await hmac(kService, 'aws4_request')
  const signature = toHex(await hmac(kSigning, stringToSign))

  headers.Authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
  return headers
}
