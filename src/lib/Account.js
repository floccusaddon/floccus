import AccountStorage from './AccountStorage'
import Adapter from './Adapter'
import Tree from './Tree'
import browser from './browser-api'

export default class Account {

  static async get(id) {
    let storage = new AccountStorage(id)
    let data = await storage.getAccountData()
    let localRoot = data.localRoot
    let tree = new Tree(localRoot, storage)
    return new Account(id, storage, Adapter.factory(data), tree)
  }
  
  static async create(data) {
    let id = Math.floor(Math.random()*10000000000)
    let storage = new AccountStorage(id)
    
    await storage.setAccountData(data)
    let account = new Account(id, storage, Adapter.factory(data))
    return account
  }
  
  constructor(id, storageAdapter, serverAdapter, treeAdapter) {
    this.server = serverAdapter
    this.id = id
    this.storage = storageAdapter
    this.tree = treeAdapter
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

  async tracksBookmark(localId) {
    if (!(await this.isInitialized())) return false
    let mappings = await this.storage.getMappings()
    return Object.keys(mappings.LocalToServer)
      .some(id => localId === id)
  }
  
  async containsBookmark(localId, ancestors) {
    if (!(await this.isInitialized())) return false
    if (await this.storage.isGlobalAccount()) return true
    ancestors = ancestors || await Tree.getIdPathFromLocalId(localId)
    return !!~ancestors.indexOf(this.getData().localRoot)
  }
  
  renderOptions(ctl, rootPath) {
    let originalData = this.getData()
    
    var modifiedCtl = {
      ...ctl,
      update: (data) => {
        if (JSON.stringify(data) === JSON.stringify(originalData)) return
        ctl.update(data)
      }
    }
    
    return this.server.renderOptions(modifiedCtl, rootPath) 
  }

  async init() {
    console.log('initializing account '+this.id)
    const accData = this.getData()
    try {
      await browser.bookmarks.getSubTree(accData.localRoot)
    } catch(e) {
      let parentNode = await browser.bookmarks.getTree()
      let bookmarksBar = parentNode[0].children[0]
      let bookmark = await browser.bookmarks.create({
        title: 'Nextcloud ('+this.getLabel()+')'
      , parentId: bookmarksBar.id
      })
      accData.localRoot = bookmark.id
      await this.setData(accData)
    }
    await this.storage.initMappings()
    await this.storage.initCache()
    this.tree = new Tree(accData.localRoot, this.storage)
  }

  async isInitialized() {
    try {
      let localRoot = this.getData().localRoot
      if (localRoot === "-1" && await this.storage.isGlobalAccount()) {
        return true
      }
      await browser.bookmarks.getSubTree(localRoot)
      return true
    }catch(e) {
      console.log('Apparently not initialized, because:', e)
      return false
    }
  }
  
  async sync() {
    try {
      await this.setData({...this.getData(), syncing: true})
      if (!(await this.isInitialized())) {
        await this.init()
      }

      // main sync steps:
     
      await this.sync_deleteFromServer()
      let received = await this.sync_update()
      await this.sync_deleteFromTree(received)
      await this.sync_createOnServer()

      await this.setData({...this.getData(), error: null, syncing: false})
    } catch(e) {
      console.error('Syncing failed with', e)
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
          await this.tree.getBookmarkByLocalId(localId)
        }catch(e) {
          console.log('SERVERDELETE', localId, mappings.LocalToServer[localId])
          await this.server.removeBookmark(mappings.LocalToServer[localId])
          await this.storage.removeFromMappings(localId)
          await this.storage.removeFromCache(localId)
        }
      })
    )
  }

  async sync_update() {
    var [serverMarks, cache] = await Promise.all([this.server.pullBookmarks(), this.storage.getCache()])
    var received = {}
    // Update known ones and create new ones
    for (var i=0; i < serverMarks.length; i++) {
      let serverMark = serverMarks[i]
      if (await this.tree.getLocalIdOf(serverMark)) {
        // known to mappings: (LOCAL|SERVER)UPDATE
        received[serverMark.localId] = serverMark // .localId is only avaiable after Tree#getLocalIdOf(...)

        let localMark = await this.tree.getBookmarkByLocalId(serverMark.localId)
        let treeHash = await localMark.hash()
        let serverHash = await serverMark.hash()
        let cacheHash = cache[serverMark.localId]
        
        if (treeHash === serverHash) {
          continue
        }
        
        if (treeHash === cacheHash) {
          // LOCALUPDATE
          await this.tree.updateNode(serverMark)
          await this.storage.addToCache(serverMark.localId, serverHash)
        }else {
          // SERVERUPDATE
          console.log('SERVERUPDATE', localMark, serverMark)
          await this.server.updateBookmark(serverMark.id, localMark)
          // await this.storage.addToCache(serverMark.localId, treeHash) // is already correct
        }
      }else{
        // Not yet known:
        // CREATE
        const node = await this.tree.createNode(serverMark)
        await this.storage.addToCache(node.id, await serverMark.hash())
        received[node.id] = serverMark
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
          await this.tree.removeNode(await this.tree.getBookmarkByLocalId(localId))
          await this.storage.removeFromCache(localId)
        }
      })
    )
  }

  async sync_createOnServer() {
    let mappings = await this.storage.getMappings()
    // In the tree yet not in the mappings: SERVERCREATE
    let nodes = await this.tree.getAllNodes()
    await Promise.all(
      nodes
      .filter(node => !mappings.LocalToServer[node.id])
      .map(async node => {
        console.log('SERVERCREATE', node.id, node.url)
        let serverMark = await this.server.createBookmark(await this.tree.getBookmarkByLocalId(node.id))
        await this.storage.addToMappings(node.id, serverMark.id)
        await this.storage.addToCache(node.id, await serverMark.hash())
      })
    )
  }

  static async getAllAccounts() {
    const d = await browser.storage.local.get('accounts')
    var accounts = d['accounts']
    
    accounts = await Promise.all(
      Object.keys(accounts)
      .map(accountId => Account.get(accountId))
    )

    return accounts
  }
  
  static async getAccountContainingLocalId(localId, ancestors, allAccounts) {
    ancestors = ancestors || await Tree.getIdPathFromLocalId(localId)
    allAccounts = allAccounts || await this.getAllAccounts() 
    var account = allAccounts
    .map((account) => ({account, index: ancestors.indexOf(account.getData().localRoot)}))
    .filter((acc) => acc.index !== -1)
    .reduce((acc1, acc2) => {
      if (acc1.index > acc2.index) return acc1
      else return acc2
    }, {account: null, index: -1}).account

    return account
  }
}
