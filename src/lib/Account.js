import AccountStorage from './AccountStorage'
import Adapter from './Adapter'
import browser from './browser-api'

export default class Account {

  static async get(id) {
    let storage = new AccountStorage(id)
    let data = await storage.getAccountData()
    return new Account(id, storage, Adapter.factory(data))
  }
  
  static async create(data) {
    let id = Math.floor(Math.random()*10000000000)
    let storage = new AccountStorage(id)
    
    await storage.setAccountData(data)
    let account = new Account(id, storage, Adapter.factory(data))
    return account
  }
  
  constructor(id, storageAdapter, serverAdapter) {
    this.server = serverAdapter
    this.id = id
    this.storage = storageAdapter
  }

  async delete() {
    await this.storage.deleteAccountData()
  }

  getLabel() {
    return this.server.getLabel()
  }

  getData() {
    return this.server.getData() 
  }
  
  async setData(data) {
    this.server = Adapter.factory(data)
    await this.storage.setAccountData(data)
  }

  async getLocalRoot() {
    await this.storage.getLocalRoot()
  }

  async hasBookmark(localId) {
    let mappings = await this.storage.getMappings()
    return Object.keys(mappings.LocalToServer)
      .some(id => localId === id)
  }
  
  renderOptions(ctl) {
    let originalData = this.getData()
    var timer 
    if (originalData.valid === null) {
      // auto revalidate connection every second
      timer = setTimeout(() => {
        this.server.pullBookmarks()
        .then((json) => {
          ctl.update({...originalData, valid: true})
        })
        .catch(() => {
          ctl.update({...originalData, valid: false})
        })
      }, 1000)
    }
    return this.server.renderOptions({
      ...ctl,
      update: (data) => {
        clearTimeout(timer)
        if (JSON.stringify(data) != JSON.stringify(originalData)) {
          ctl.update({...data, valid: null})
        }
      }
    }) 
  }

  async init() {
    let parentNode = await browser.bookmarks.getTree()
    let bookmark = await browser.bookmarks.create({
      title: 'Nextcloud ('+this.getLabel()+')'
    , parentId: parentNode.id
    })
    await this.storage.setLocalRoot(bookmark.id)
    await this.storage.initMappings()
  }
  
  async sync() {
    try {
      var localRoot
      await this.setData({...this.getData(), syncing: true})
      try {
        localRoot = await this.storage.getLocalRoot()
        await browser.bookmarks.get(localRoot)
      }catch(e) {
        await this.init()
        localRoot = await this.storage.getLocalRoot()
      }

      // main sync steps:
     
      await this.sync_deleteFromServer()
      let received = await this.sync_update(localRoot)
      await this.sync_deleteFromTree(received)
      await this.sync_createOnServer(localRoot)

      await this.setData({...this.getData(), error: null, syncing: false})
    } catch(e) {
      await this.setData({...this.getData(), error: e.message, syncing: false}) 
    }
  }

  async sync_deleteFromServer() {
    let mappings = await this.storage.getMappings()
    // In the mappings but not in the tree: SERVERDELETE
    await Promise.all(
      Object.keys(mappings.LocalToServer)
      .map(async localId => {
        try {
          await await browser.bookmarks.get(localId)
        }catch(e) {
          console.log('SERVERDELETE', localId, mappings.LocalToServer[localId])
          await this.server.removeBookmark(mappings.LocalToServer[localId])
          await this.storage.removeFromMappings(localId)
        }
      })
    )
  }

  async sync_update(localRoot) {
    var [json, mappings] = await Promise.all([this.server.pullBookmarks(), this.storage.getMappings()])
    var received = {}
    // Update known ones and create new ones
    for (var i=0; i < json.length; i++) {
      let obj = json[i]
      let localId = mappings.ServerToLocal[obj.id]
      let path = Account.getBookmarkPath(obj)
      let parentId = await Account.mkdirpBookmarkPath(path, localRoot)
      if (localId) {
        received[localId] = true
        // known to mappings: UPDATE
        let bookmark = await browser.bookmarks.get(localId)
        if (bm.dateGroupModified < obj.lastmodified) {
          console.log('LOCALUPDATE', localId, obj)
          await browser.bookmarks.update(localId, {
            title: obj.title
          , url: obj.url
          })
          await browser.bookmarks.move(localId, {parentId})
        }else {
          // SERVERUPDATE
          let serverMark = await this.server.updateBookmark({
            ...bookmark
          , path: path
          , title: bookmark.title
          , url: bookmark.url
          })
        }
      }else{
        // Not yet known: CREATE
        let bookmark = await browser.bookmarks.create({parentId, title: obj.title, url: obj.url})
        console.log('CREATE', bookmark.id, obj)
        received[bookmark.id] = true
        await this.storage.addToMappings(bookmark.id, obj.id)
      }
    }
    return received
  }

  async sync_deleteFromTree(received) {
    let mappings = await this.storage.getMappings()
    // removed on the server: DELETE
    await Promise.all(
      // local bookmarks are only in the mappings if they have been added to the server successfully!
      Object.keys(mappings.LocalToServer).map(async localId => {
        if (!received[localId]) {
          // If a bookmark was deleted on the server, we delete it as well
          console.log('DELETE', localId, mappings.LocalToServer[localId])
          await browser.bookmarks.remove(localId)
          await this.storage.removeFromMappings(localId)
        }
      })
    )
  }

  async sync_createOnServer(localRoot) {
    let mappings = await this.storage.getMappings()
    // In the tree yet not in the mappings: SERVERCREATE
    let desc = await this.getAllDescendants(localRoot)
    await Promise.all(
      desc
      .filter(bookmark => !mappings.LocalToServer[bookmark.id])
      .map(async bookmark => {
        console.log('SERVERCREATE', bookmark.id, bookmark.url)
        let path = await Account.getPathFromLocalId(bookmark.id, localRoot)
        let serverMark = await this.server.createBookmark({
          ...bookmark
        , path: path
        , title: bookmark.title
        , url: bookmark.url
        })
        await this.storage.addToMappings(bookmark.id, serverMark.id)
      })
    )
  }

  static async getAllDescendants(localId) {
    var tree = await browser.bookmarks.get(localId)
    return recurse(tree)
    const recurse = (root) => {
      if (!root.children) return [root]
      return root.children
        .map(recurse)
        .reduce((desc1, desc2) => desc1.concat(desc2))
    }
  }
 
  static async getPathFromLocalId(localId, rootId) {
    if (localId === rootId) return '/'
    let bm = await browser.bookmarks.get(localId)
    return (await Account.getPathfromLocalId(bm.id, rootId)) + encodeURIComponent(bm.title)+'/'
  }

  static async mkdirpBookmarkPath(path, rootId) {
    let root = await browser.bookmarks.get(rootId)
    let pathSegment = path.split('/')[1]
    let nextPath = path.substr(('/'+pathSegment).length)
    let title = decodeURIComponent(pathSegment)

    if (!root.children) {
      if (path == '/') return root
      else throw new Error('given path root is not a folder')
    } else {
      let child
      child = root.children
        .filter(bm => bm.title == title)
        .filter(bm => !!bm.children)
        [0]
      if (!child) child = await browser.bookmarks.create({parentId: rootId, title})
      return await Account.mkdirpBookmarkPath(nextPath, child.id)
    }
  }
}
