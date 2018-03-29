import AccountStorage from './AccountStorage'
import Adapter from './Adapter'
import Tree from './Tree'
import browser from './browser-api'
import ParallelArray from 'parallel-array'

const BATCH_SIZE = 5

export default class Account {
  static async get (id) {
    let storage = new AccountStorage(id)
    let data = await storage.getAccountData()
    let localRoot = data.localRoot
    let tree = new Tree(localRoot, storage)
    return new Account(id, storage, Adapter.factory(data), tree)
  }

  static async create (data) {
    let id = '' + Math.floor(Math.random() * 10000000000)
    let storage = new AccountStorage(id)

    await storage.setAccountData(data)
    let account = new Account(id, storage, Adapter.factory(data))
    return account
  }

  constructor (id, storageAdapter, serverAdapter, treeAdapter) {
    this.server = serverAdapter
    this.id = id
    this.storage = storageAdapter
    this.tree = treeAdapter
  }

  async delete () {
    await this.storage.deleteAccountData()
  }

  getLabel () {
    return this.server.getLabel()
  }

  getData () {
    return this.server.getData()
  }

  async setData (data) {
    this.server.setData(data)
    await this.storage.setAccountData(data)
  }

  async tracksBookmark (localId) {
    if (!(await this.isInitialized())) return false
    let mappings = await this.storage.getMappings()
    return Object.keys(mappings.LocalToServer)
      .some(id => localId === id)
  }

  renderOptions (ctl, rootPath) {
    let originalData = this.getData()

    var modifiedCtl = {
      ...ctl
      , update: (data) => {
        if (JSON.stringify(data) === JSON.stringify(originalData)) return
        ctl.update(data)
      }
    }

    return this.server.renderOptions(modifiedCtl, rootPath)
  }

  async init () {
    console.log('initializing account ' + this.id)
    const accData = this.getData()
    try {
      await browser.bookmarks.getSubTree(accData.localRoot)
    } catch (e) {
      let parentNode = await browser.bookmarks.getTree()
      let bookmarksBar = parentNode[0].children[0]
      let node = await browser.bookmarks.create({
        title: 'Nextcloud (' + this.getLabel() + ')'
        , parentId: bookmarksBar.id
      })
      accData.localRoot = node.id
      await this.setData(accData)
    }
    await this.storage.initMappings()
    await this.storage.initCache()
    this.tree = new Tree(accData.localRoot, this.storage)
  }

  async isInitialized () {
    try {
      let localRoot = this.getData().localRoot
      await browser.bookmarks.getSubTree(localRoot)
      return true
    } catch (e) {
      console.log('Apparently not initialized, because:', e)
      return false
    }
  }

  async sync () {
    try {
      console.log('Starting sync process for account ' + this.getLabel())
      await this.setData({...this.getData(), syncing: true})
      if (!(await this.isInitialized())) {
        await this.init()
      }

      // main sync steps:

      let mappings = await this.storage.getMappings()
      // Deletes things we've known but that are no longer there locally
      await this.sync_deleteFromServer(mappings)
      // Server handles existing URLs that we think are new, client handles new URLs that are bookmarked twice locally
      await this.sync_createOnServer(mappings)

      let serverList = await this.server.pullBookmarks()
      // deletes everything locally that is not new but doesn't exist on the server anymore
      await this.sync_deleteFromTree(serverList)
      // Goes through server's list and updates creates things locally as needed
      await this.sync_update(serverList)

      await this.setData({...this.getData(), error: null, syncing: false, lastSync: Date.now()})
      console.log('Successfully ended sync process for account ' + this.getLabel())
    } catch (e) {
      console.error('Syncing failed with', e)
      await this.setData({...this.getData(), error: e.message, syncing: false})
    }
  }

  async sync_deleteFromServer (mappings) {
    // In the mappings but not in the tree: SERVERDELETE
    await ParallelArray.from(Object.keys(mappings.LocalToServer))
      .asyncForEach(async localId => {
        try {
          await this.tree.getBookmarkByLocalId(localId)
        } catch (e) {
          console.log('SERVERDELETE', localId, mappings.LocalToServer[localId])
          await this.server.removeBookmark(mappings.LocalToServer[localId])
          await this.storage.removeFromMappings(localId)
          await this.storage.removeFromCache(localId)
        }
      }, BATCH_SIZE)
  }

  async sync_createOnServer (mappings) {
    // In the tree yet not in the mappings: SERVERCREATE
    let nodes = await this.tree.getAllNodes()
    await ParallelArray.from(
      nodes
        .filter(node => typeof mappings.LocalToServer[node.id] === 'undefined')
    )
      .asyncForEach(async node => {
        if (mappings.UrlToLocal[node.url]) {
          console.error('The same URL is bookmarked twice locally:', node.url)
          throw new Error('The same URL is bookmarked twice locally: "' + node.url + '". Delete one of the two.')
        }
        console.log('SERVERCREATE', node.id, node.url)
        let serverMark = await this.server.createBookmark(await this.tree.getBookmarkByLocalId(node.id))
        if (!serverMark) {
          // ignore this bookmark as it's not supported by the server
          return
        }
        serverMark.localId = node.id
        await this.storage.addToMappings(serverMark)
        await this.storage.addToCache(node.id, await serverMark.hash())
      }, BATCH_SIZE)
  }

  async sync_deleteFromTree (serverList) {
    const received = {}
    serverList.forEach((bm) => (received[bm.id] = true))

    const mappings = await this.storage.getMappings()

    // removed on the server: DELETE
    await ParallelArray.from(Object.keys(mappings.ServerToLocal))
    // local bookmarks are only in the mappings if they have been added to the server successfully, so we never delete new ones!
      .asyncForEach(async id => {
        if (!received[id]) {
        // If a bookmark was deleted on the server, we delete it as well
          let localId = mappings.ServerToLocal[id]
          await this.tree.removeNode(await this.tree.getBookmarkByLocalId(localId))
          await this.storage.removeFromCache(localId)
          await this.storage.removeFromMappings(localId)
        }
      }, /* parallel batch size: */1)
  }

  async sync_update (serverMarks) {
    var [
      cache
      , mappings
    ] = await Promise.all([
      this.storage.getCache()
      , this.storage.getMappings() // For detecting duplicates
    ])
    // Update known ones and create new ones
    await ParallelArray.from(serverMarks)
      .asyncForEach(async serverMark => {
        serverMark.localId = mappings.ServerToLocal[serverMark.id]
        if (serverMark.localId) {
        // known to mappings: (LOCAL|SERVER)UPDATE
          let localMark = await this.tree.getBookmarkByLocalId(serverMark.localId)
          let [treeHash, serverHash] = await Promise.all([localMark.hash(), serverMark.hash()])
          let cacheHash = cache[serverMark.localId]

          if (treeHash === serverHash) {
            return
          }

          if (treeHash === cacheHash) {
          // LOCALUPDATE
            await this.tree.updateNode(serverMark)
            await this.storage.addToCache(serverMark.localId, serverHash)
          } else {
          // SERVERUPDATE
            console.log('SERVERUPDATE', localMark, serverMark)
            let couldHandle = await this.server.updateBookmark(serverMark.id, localMark)
            if (!couldHandle) {
              // if the protocol is not supported updateBookmark returns false
              // and we ignore it
              await this.server.removeBookmark(localMark.id)
              await this.storage.removeFromMappings(localMark.localId)
              await this.storage.removeFromCache(localMark.localId)
              return
            }
            await this.storage.addToCache(serverMark.localId, treeHash)
          }
        } else {
        // Not yet known:
        // CREATE
          if (mappings.UrlToLocal[serverMark.url]) {
            console.error('Trying to create a URL that is already bookmarked. This shouldn\'t happen! Please tell the developer about this! url=' + serverMark.url)
            throw new Error('Trying to create a URL that is already bookmarked. This shouldn\'t happen! Please tell the developer about this! url=' + serverMark.url)
          }
          const node = await this.tree.createNode(serverMark)
          await this.storage.addToCache(node.id, await serverMark.hash())
        }
      }, /* parallel batch size: */1)
  }

  static async getAllAccounts () {
    const d = await browser.storage.local.get('accounts')
    var accounts = d['accounts']

    accounts = await Promise.all(
      Object.keys(accounts)
        .map(accountId => Account.get(accountId))
    )

    return accounts
  }

  static async getAccountContainingLocalId (localId, ancestors, allAccounts) {
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
