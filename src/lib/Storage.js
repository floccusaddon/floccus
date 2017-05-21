import default as browser from './browser-api'

export default class Storage {

  constructor(id) {
    this.accountId = id
  }
  
  changeEntry(entryName, fn) {
    return browser.storage.local.get(entryName))
    .then(d => {
      entry = d[entryName]
      entry = fn(entry)
      return browser.storage.local.set({[entryName]: entry})
    })
  }

  getEntry(entryName) {
    return browser.storage.local.get(entryName)
    .then(d => {
      return d[entryName]
    })
  }

  getLocalRoot() {
    return this.getEntry(`bookmarks[${this.accountId}].localRoot`)
  }
  
  setLocalRoot(localId) {
   return browser.storage.local.set({`bookmarks[${this.accountId}].localRoot`: localId}) 
  }

  initMappings() {
    return browser.storage.local.set({`bookmarks[${this.accountId}].mappings`: {
        ServerToLocal: {}
      , LocalToServer: {}
      }})
  }
  
  getMappings() {
    return this.getEntry(`bookmarks[${this.accountId}].mappings`)
  }

  removeFromMappings(localId) {
    return this.changeEntry(`bookmarks[${this.accountId}].mappings`), (mappings) => {
      delete mappings.ServerToLocal[mappings.LocalToServer[localId]]
      delete mappings.LocalToServer[localId]
      return mappings
    })
  }
  
  addToMappings(localId, remoteId) {
    return this.changeEntry(`bookmarks[${this.accountId}].mappings`), (mappings) => {
      mappings.LocalToServer[localId] = remoteId
      mappings.ServerToLocal[removeId] = localId
      return mappings
    })
  }
}
