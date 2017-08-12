import AccountStorage from './AccountStorage'
import Adapter from './Adapter'
import browser from './browser-api'

export default class Account {

  static get(id) {
    let storage = new AccountStorage(id)
    return storage.getAccountData()
    .then((data) => {
        return new Account(id, storage, Adapter.factory(data))
    })
  }
  
  static create(data) {
    let id = Math.floor(Math.random()*10000000000)
    let storage = new AccountStorage(id)
    
    return storage.setAccountData(data)
    .then(() => {
        return new Account(id, storage, Adapter.factory(data))
    })
    .then((account) => {
      return account.init()
    })
  }
  
  constructor(id, storageAdapter, serverAdapter) {
    this.server = serverAdapter
    this.id = id
    this.storage = storageAdapter
  }

  delete() {
    return this.storage.deleteAccountData()
  }

  getLabel() {
    return this.server.getLabel()
  }

  getData() {
    return this.server.getData() 
  }
  
  setData(data) {
     this.server = Adapter.factory(data)
     return Promise.resolve()
     .then(() => {
       return this.storage.setAccountData(data)
     })
  }
  
  renderOptions(ctl) {
    return this.server.renderOptions(ctl) 
  }

  init() {
    return browser.bookmarks.getTree()
    .then(parentNode => browser.bookmarks.create({
      title: 'Nextcloud ('+this.getLabel()+')'
    , parentId: parentNode.id
    }))
    .then(bookmark => this.storage.setLocalRoot(bookmark.id))
    .then(() => this.storage.initMappings())
    .catch(err => console.warn)
  }
  
  sync() {
    var localRoot
      , received = {}
    return Promise.resolve()
    .then(() => this.storage.getLocalRoot())
    .then(root => {
      localRoot = root
    })
    .then(() => browser.bookmarks.get(localRoot))
    .then(
      () => {}
    , (er) => this.init()
    )
    .then(() => this.storage.getMappings())
    .then((mappings) => {
      // In the mappings but not in the tree: SERVERDELETE
      return Promise.all(
        Object.keys(mappings.LocalToServer).map(localId => {
          return browser.bookmarks.get(localId)
          .then(node => node, er => {
            console.log('SERVERDELETE', localId, mappings.LocalToServer[localId])
            return this.server.removeBookmark(mappings.LocalToServer[localId])
            .then(() => this.storage.removeFromMappings(localId)) 
          })
        })
      )
    })
    .then(() => Promise.all([this.server.pullBookmarks(), this.storage.getMappings()]))
    .then(data => {
      var [json, mappings] = data
      // Update known ones and create new ones
      return Promise.all(
        json.map(obj => {
          var localId = mappings.ServerToLocal[obj.id]
          if (localId) {
            received[localId] = true
            // known to mappings: UPDATE
            console.log('UPDATE', localId, obj)
            // XXX: Check lastmodified
            return browser.bookmarks.update(localId, {
              title: obj.title
            , url: obj.url
            })
          }else{
            // Not yet known: CREATE
            return browser.bookmarks.create({parentId: localRoot, title: obj.title, url: obj.url})
            .then(bookmark => {
              console.log('CREATE', bookmark.id, obj)
              received[bookmark.id] = true
              return this.storage.addToMappings(bookmark.id, obj.id)
            })
          }
        })
      )
    })
    .then(() => this.storage.getMappings())
    .then((mappings) => {
      // removed on the server: DELETE
      return Promise.all(
        Object.keys(mappings.LocalToServer).map(localId => {
          if (!received[localId]) {
            // If a bookmark was deleted on the server, we delete it as well
            console.log('DELETE', localId, mappings.LocalToServer[localId])
            return browser.bookmarks.remove(localId)
            .then(() => this.storage.removeFromMappings(localId))
          }
        })
      )
    })
    .then(() => this.storage.getMappings())
    .then((mappings) => {
      // In the tree yet not in the mappings: SERVERCREATE
      return browser.bookmarks.getChildren(localRoot)
      .then(children => {
        return Promise.all(
          children
          .filter(bookmark => !mappings.LocalToServer[bookmark.id])
          .map(bookmark => {
            console.log('SERVERCREATE', bookmark.id, bookmark.url)
            return this.server.createBookmark(bookmark)
            .then((serverMark) => this.storage.addToMappings(bookmark.id, remoteMark.id), (e) => console.warn(e))
          })
        )
      })
    })
  }
}
