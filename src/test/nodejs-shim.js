/* global globalThis */
import { webcrypto } from 'crypto'

globalThis.DEBUG = false
globalThis.IS_BROWSER = false

if (!globalThis.crypto) {
  globalThis.crypto = webcrypto
}

if (!globalThis.navigator) {
  globalThis.navigator = {
    userAgent: 'node.js',
    language: 'en-US',
    languages: ['en-US'],
  }
}

const defaultLocation = new URL('https://example.test/dist/html/test.html?ci=true')

globalThis.window = {
  location: defaultLocation,
  navigator: globalThis.navigator,
  addEventListener() {
    // noop
  },
  removeEventListener() {
    // noop
  },
  localStorage: {
    _data: {},
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(this._data, key)
        ? this._data[key]
        : null
    },
    setItem(key, value) {
      this._data[key] = String(value)
    },
    removeItem(key) {
      delete this._data[key]
    },
  },
  floccusTestLogs: [],
}

globalThis.self = {
  location: defaultLocation,
  constructor: { name: 'NodeGlobalScope' },
}
