import browser from './browser-api'

export default class AccountStorage {

  constructor(id) {
    this.accountId = id
  }
  
  static changeEntry(entryName, fn) {
    return browser.storage.local.get(entryName)
    .then(d => {
      var entry = d[entryName]
      entry = fn(entry)
      return browser.storage.local.set({[entryName]: entry})
    })
  }

  static getEntry(entryName) {
    return browser.storage.local.get(entryName)
    .then(d => {
      return d[entryName]
    })
  }

  getAccountData() {
    return AccountStorage.getEntry(`accounts`).then((accounts) => {
      return accounts[this.accountId]
    })
  }
  
  setAccountData(data) {
    return AccountStorage.changeEntry(`accounts`, (accounts) => {
      accounts = accounts || {}
      accounts[this.accountId] = data
      return accounts
    })
  }
  
  deleteAccountData() {
    return AccountStorage.changeEntry(`accounts`, (accounts) => {
      delete accounts[this.accountId]
      return accounts
    })
  }
  
  initCache() {
    return browser.storage.local.set({[`bookmarks[${this.accountId}].cache`]: {} })
  }

  getCache() {
    return AccountStorage.getEntry(`bookmarks[${this.accountId}].cache`)
  }
  
  removeFromCache(localId) {
    return AccountStorage.changeEntry(`bookmarks[${this.accountId}].cache`, (cache) => {
      delete cache[localId]
      return cache
    })
  }
  
  addToCache(localId, hash) {
    return AccountStorage.changeEntry(`bookmarks[${this.accountId}].cache`, (cache) => {
      cache[localId] = hash
      return cache
    })
  }

  initMappings() {
    return browser.storage.local.set({[`bookmarks[${this.accountId}].mappings`]: {
        ServerToLocal: {}
      , LocalToServer: {}
      }})
  }
  
  getMappings() {
    return AccountStorage.getEntry(`bookmarks[${this.accountId}].mappings`)
  }

  removeFromMappings(localId) {
    return AccountStorage.changeEntry(`bookmarks[${this.accountId}].mappings`, (mappings) => {
      delete mappings.ServerToLocal[mappings.LocalToServer[localId]]
      delete mappings.LocalToServer[localId]
      return mappings
    })
  }
  
  addToMappings(localId, remoteId) {
    return AccountStorage.changeEntry(`bookmarks[${this.accountId}].mappings`, (mappings) => {
      mappings.LocalToServer[localId] = remoteId
      mappings.ServerToLocal[remoteId] = localId
      return mappings
    })
  }

}
