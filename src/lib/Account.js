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
    return await this.storage.getLocalRoot()
  }

  async hasBookmark(localId) {
    let mappings = await this.storage.getMappings()
    return Object.keys(mappings.LocalToServer)
      .some(id => localId === id)
  }
  
  renderOptions(ctl) {
    let originalData = this.getData()
     
    if (originalData.valid === null) {
      if (this.optionsDebounceTimer) clearTimeout(this.optionsDebounceTimer)
      this.optionsDebounceTimer = setTimeout(() => {
        this.server.pullBookmarks()
        .then((json) => {
          // If things were changed while we were checking, just abort
          if (JSON.stringify(this.getData()) !== JSON.stringify(originalData)) return
          ctl.update({...originalData, valid: true, error: false})
        })
        .catch(() => {
          // If things were changed while we were checking, just abort
          if (JSON.stringify(this.getData()) !== JSON.stringify(originalData)) return
          ctl.update({...originalData, valid: false})
        })
      }, 1000)
    }
    
    var debouncedCtl = {
      ...ctl,
      update: (data) => {
        if (JSON.stringify(data) === JSON.stringify(originalData)) return
        ctl.update({
            ...data
          , valid: null
        })
      }
    }
    
    return this.server.renderOptions(debouncedCtl) 
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
      let received = {}
      try {
        localRoot = await this.storage.getLocalRoot()
        await browser.bookmarks.getSubTree(localRoot)
      }catch(e) {
        await this.init()
        localRoot = await this.storage.getLocalRoot()
      }
      
      var mappings = await this.storage.getMappings()
      // In the mappings but not in the tree: SERVERDELETE
      await Promise.all(
        Object.keys(mappings.LocalToServer).map(async localId => {
          try {
            await browser.bookmarks.getSubTree(localId)
          }catch(e) {
            console.log('SERVERDELETE', localId, mappings.LocalToServer[localId])
            await this.server.removeBookmark(mappings.LocalToServer[localId])
            await this.storage.removeFromMappings(localId)
          }
        })
      )
      var json
      ;[json, mappings] = await Promise.all([this.server.pullBookmarks(), this.storage.getMappings()])
      // Update known ones and create new ones
      await Promise.all(
        json.map(async obj => {
          var localId = mappings.ServerToLocal[obj.id]
          if (localId) {
            received[localId] = true
            // known to mappings: UPDATE
            console.log('UPDATE', localId, obj)
            // XXX: Check lastmodified
            await browser.bookmarks.update(localId, {
              title: obj.title
            , url: obj.url
            })
          }else{
            // Not yet known: CREATE
            let bookmark = await browser.bookmarks.create({parentId: localRoot, title: obj.title, url: obj.url})
            console.log('CREATE', bookmark.id, obj)
            received[bookmark.id] = true
            await this.storage.addToMappings(bookmark.id, obj.id)
          }
        })
      )
      mappings = await this.storage.getMappings()
      // removed on the server: DELETE
      await Promise.all(
        Object.keys(mappings.LocalToServer).map(async localId => {
          if (!received[localId]) {
            // If a bookmark was deleted on the server, we delete it as well
            console.log('DELETE', localId, mappings.LocalToServer[localId])
            await browser.bookmarks.remove(localId)
            await this.storage.removeFromMappings(localId)
          }
        })
      )
      mappings = await this.storage.getMappings()
      // In the tree yet not in the mappings: SERVERCREATE
      let children = await browser.bookmarks.getChildren(localRoot)
      await Promise.all(
        children
        .filter(bookmark => !mappings.LocalToServer[bookmark.id])
        .filter(bookmark => !!bookmark.url)
        .map(async bookmark => {
          console.log('SERVERCREATE', bookmark.id, bookmark.url)
          let serverMark = await this.server.createBookmark(bookmark)
          await this.storage.addToMappings(bookmark.id, serverMark.id)
        })
      )
      await this.setData({...this.getData(), error: null, syncing: false})
    } catch(err) {
      return this.setData({...this.getData(), error: err.message, syncing: false}) 
    }
  }
}
