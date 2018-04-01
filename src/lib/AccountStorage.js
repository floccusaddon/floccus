import browser from './browser-api'

export default class AccountStorage {
  constructor (id) {
    this.accountId = id
  }

  static async getAsyncLock (entryName) {
    if (!this.synchronized) {
      this.synchronized = {}
    }
    const oldLock = this.synchronized[entryName]
    let releaseLock
    this.synchronized[entryName] = new Promise((r) => (releaseLock = r))

    if (oldLock) {
      await oldLock
    }

    return () => {
      this.synchronized[entryName] = null
      releaseLock()
    }
  }

  static async changeEntry (entryName, fn) {
    const release = await this.getAsyncLock(entryName)

    const d = await browser.storage.local.get({[entryName]: {}}) // default: {}
    var entry = d[entryName]
    entry = fn(entry)
    await browser.storage.local.set({[entryName]: entry})

    release()
  }

  static getEntry (entryName) {
    return browser.storage.local.get({[entryName]: {}}) // default: {}
      .then(d => {
        return d[entryName]
      })
  }

  getAccountData () {
    return AccountStorage.getEntry(`accounts`).then((accounts) => {
      return accounts[this.accountId]
    })
  }

  setAccountData (data) {
    return AccountStorage.changeEntry(`accounts`, (accounts) => {
      accounts = accounts || {}
      accounts[this.accountId] = data
      return accounts
    })
  }

  deleteAccountData () {
    return AccountStorage.changeEntry(`accounts`, (accounts) => {
      delete accounts[this.accountId]
      return accounts
    })
  }

  initCache () {
    return browser.storage.local.set({[`bookmarks[${this.accountId}].cache`]: {} })
  }

  getCache () {
    return AccountStorage.getEntry(`bookmarks[${this.accountId}].cache`)
  }

  removeFromCache (localId) {
    return AccountStorage.changeEntry(`bookmarks[${this.accountId}].cache`, (cache) => {
      delete cache[localId]
      return cache
    })
  }

  addToCache (localId, hash) {
    return AccountStorage.changeEntry(`bookmarks[${this.accountId}].cache`, (cache) => {
      cache[localId] = hash
      return cache
    })
  }

  initMappings () {
    return browser.storage.local.set({[`bookmarks[${this.accountId}].mappings`]: {
      ServerToLocal: {}
      , LocalToServer: {}
      , UrlToLocal: {}
      , LocalToUrl: {}
    }})
  }

  getMappings () {
    return AccountStorage.getEntry(`bookmarks[${this.accountId}].mappings`)
  }

  removeFromMappings (localId) {
    return AccountStorage.changeEntry(`bookmarks[${this.accountId}].mappings`, (mappings) => {
      delete mappings.ServerToLocal[mappings.LocalToServer[localId]]
      delete mappings.LocalToServer[localId]
      delete mappings.UrlToLocal[mappings.LocalToUrl[localId]]
      delete mappings.LocalToUrl[localId]
      return mappings
    })
  }

  addToMappings (bookmark) {
    return AccountStorage.changeEntry(`bookmarks[${this.accountId}].mappings`, (mappings) => {
      mappings.LocalToServer[bookmark.localId] = bookmark.id
      mappings.ServerToLocal[bookmark.id] = bookmark.localId
      mappings.UrlToLocal[bookmark.url] = bookmark.localId
      mappings.LocalToUrl[bookmark.localId] = bookmark.url
      return mappings
    })
  }
}
