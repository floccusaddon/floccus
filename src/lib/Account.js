import Storage from './Storage'
import browser from './browser-api'

export default class Account {
  
  constructor(accountId, adapter) {
    this.adapter = adapter
    this.accountId = accountId
    this.storage = new Storage(this.accountId)
  }

  init() {
    return browser.bookmarks.getTree()
    .then(parentNode => browser.bookmarks.create({
      title: 'Nextcloud ('+this.accountId+')'
    , parentId: parentNode.id
    }))
    .then(bookmark => this.storage.setLocalRoot(bookmark.id))
    .then(() => this.storage.initMappings())
    .catch(err => console.warn)
  }
  
  sync() {
    var localRoot
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
            return this.adapter.removeBookmark(mappings.LocalToServer[localId])
            .then(() => this.removeFromMappings(localId)) 
          })
        })
      )
    })
    .then(() => Promise.all([bookmarks.adapter.pullBookmarks(), this.getMappings()]))
    .then(data => {
      var [json, mappings] = data
      // Update known ones and create new ones
      return Promise.all(
        json.map(obj => {
          var localId
          if (localId = mappings.ServerToLocal[obj.id]) {
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
              return this.storage.addToMappings(bookmark.id)
            })
          }
        })
      )
    })
    .then(() => this.getMappings())
    .then((mappings) => {
      // removed on the server: DELETE
      return Promise.all(
        Object.keys(mappings.LocalToServer).map(localId => {
          if (!received[localId]) {
            // If a bookmark was deleted on the server, we delete it as well
            console.log('DELETE', localId, mappings.LocalToServer[localId])
            return browser.bookmarks.remove(localId)
            .then(() => this.removeFromMappings(localId))
          }
        })
      )
    })
    .then(() => this.getMappings())
    .then((mappings) => {
      // In the tree yet not in the mappings: SERVERCREATE
      return browser.bookmarks.getChildren(localRoot)
      .then(children => {
        return Promise.all(
          children
          .filter(bookmark => !mappings.LocalToServer[bookmark.id])
          .map(bookmark => {
            console.log('SERVERCREATE', bookmark.id, bookmark.url)
            return bookmarks.adapter.createBookmark(bookmark)
            .then(() => this.storage.addToMappings(bookmark.id), (e) => console.warn(e))
          })
        )
      })
    })
  }
}
