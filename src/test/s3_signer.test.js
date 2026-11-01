import { expect } from './utils'
import {
  EMPTY_PAYLOAD_HASH,
  s3UriEncode,
  sha256Hex,
  signS3Request,
} from '../lib/S3Signer'

// The example from the S3 SigV4 documentation ("GET Object"):
// https://docs.aws.amazon.com/AmazonS3/latest/API/sig-v4-header-based-auth.html
const CREDENTIALS = {
  accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  region: 'us-east-1',
}
const DATE = new Date(Date.UTC(2013, 4, 24, 0, 0, 0))

describe('S3Signer', function() {
  it('hashes the empty payload', async function() {
    expect(await sha256Hex('')).to.equal(EMPTY_PAYLOAD_HASH)
  })

  it('signs the documented GET Object example', async function() {
    const headers = await signS3Request({
      method: 'GET',
      url: 'https://examplebucket.s3.amazonaws.com/test.txt',
      headers: { Range: 'bytes=0-9' },
      signedHeaders: ['range'],
      payloadHash: EMPTY_PAYLOAD_HASH,
      credentials: CREDENTIALS,
      date: DATE,
    })
    expect(headers['x-amz-date']).to.equal('20130524T000000Z')
    expect(headers.Authorization).to.equal(
      'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, ' +
      'SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, ' +
      'Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41'
    )
  })

  it('signs the documented GET Bucket lifecycle example (query string)', async function() {
    const headers = await signS3Request({
      method: 'GET',
      url: 'https://examplebucket.s3.amazonaws.com/?lifecycle',
      payloadHash: EMPTY_PAYLOAD_HASH,
      credentials: CREDENTIALS,
      date: DATE,
    })
    expect(headers.Authorization).to.equal(
      'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, ' +
      'SignedHeaders=host;x-amz-content-sha256;x-amz-date, ' +
      'Signature=fea454ca298b7da1c68078a5d1bdbfbbe0d65c699e0f91ac7a200a0136783543'
    )
  })

  it('leaves headers other than host and x-amz-* unsigned', async function() {
    const headers = await signS3Request({
      method: 'PUT',
      url: 'https://examplebucket.s3.amazonaws.com/a.xbel',
      headers: { 'Content-Type': 'application/xml', 'If-Match': '"abc"' },
      payloadHash: await sha256Hex('<xml/>'),
      credentials: { ...CREDENTIALS, sessionToken: 'token' },
      date: DATE,
    })
    expect(headers['Content-Type']).to.equal('application/xml')
    expect(headers['x-amz-security-token']).to.equal('token')
    expect(headers.Authorization).to.contain(
      'SignedHeaders=host;x-amz-content-sha256;x-amz-date;x-amz-security-token,'
    )
  })

  it('encodes keys as SigV4 requires', function() {
    expect(s3UriEncode("a b!'()*~._-")).to.equal('a%20b%21%27%28%29%2A~._-')
    expect(s3UriEncode('dir/书签.xbel', false)).to.equal('dir/%E4%B9%A6%E7%AD%BE.xbel')
    expect(s3UriEncode('dir/file', true)).to.equal('dir%2Ffile')
  })
})
