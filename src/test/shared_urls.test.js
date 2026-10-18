import { expect } from './utils'
import { extractSharedUrls } from '../lib/SharedUrls'

describe('extractSharedUrls', function() {
  it('returns a single shared URL unchanged', function() {
    expect(extractSharedUrls('https://example.com/foo?bar=baz')).to.deep.equal(['https://example.com/foo?bar=baz'])
  })

  it('finds a URL at the end of a shared text', function() {
    expect(extractSharedUrls('Look at this product https://example.com/item')).to.deep.equal(['https://example.com/item'])
  })

  it('splits several tabs shared from Firefox for Android', function() {
    const text = 'http://example1.com/\n\nhttp://example2.com\n\nhttp://example3.com/foo/index.html\n\nhttp://example4.com'
    expect(extractSharedUrls(text)).to.deep.equal([
      'http://example1.com/',
      'http://example2.com',
      'http://example3.com/foo/index.html',
      'http://example4.com',
    ])
  })

  it('drops duplicates and text between the URLs', function() {
    const text = 'Two pages:\nhttps://a.example/ and https://b.example/\nhttps://a.example/'
    expect(extractSharedUrls(text)).to.deep.equal(['https://a.example/', 'https://b.example/'])
  })

  it('returns nothing for an empty share', function() {
    expect(extractSharedUrls('')).to.deep.equal([])
    expect(extractSharedUrls(undefined)).to.deep.equal([])
  })
})
