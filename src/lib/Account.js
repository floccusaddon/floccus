import AccountStorage from './AccountStorage'
import Adapter from './Adapter'
import Tree from './Tree'
import browser from './browser-api'
const Parallel = require('async-parallel')

const BATCH_SIZE = 10

export default class Account {
  static async get (id) {
    let storage = new AccountStorage(id)
    let background = await browser.runtime.getBackgroundPage()
    let data = await storage.getAccountData(background.controller.key)
    if (typeof data.serverRoot !== 'string') {
      data.serverRoot = ''
    }
    let tree = new Tree(storage, data.localRoot, data.serverRoot)
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
    let background = await browser.runtime.getBackgroundPage()
    await this.storage.setAccountData(data, background.controller.key)
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
        if (originalData.serverRoot !== data.serverRoot) {
          this.storage.initCache()
          this.storage.initMappings()
        }
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
    this.tree = new Tree(this.storage, accData.localRoot, accData.serverRoot)
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
      await this.tree.load(mappings)

      if (Object.keys(mappings.LocalToServer).length === 0 && this.tree.getAllBookmarks().length !== 0) {
        await this.setData({...this.getData(), syncing: 'initial'})
      }

      // Deletes things we've known but that are no longer there locally
      await this.sync_deleteFromServer(mappings)
      // Server handles existing URLs that we think are new, client handles new URLs that are bookmarked twice locally
      await this.sync_createOnServer(mappings)

      let serverRoot = this.getData().serverRoot
      let serverList = (await this.server.pullBookmarks())
        .filter(bm => serverRoot ? bm.path.indexOf(serverRoot) === 0 : true)

      mappings = await this.storage.getMappings()
      await this.tree.load(mappings)

      // deletes everything locally that is not new but doesn't exist on the server anymore
      await this.sync_deleteFromTree(serverList)
      // Goes through server's list and updates creates things locally as needed
      await this.sync_update(serverList)

      await this.tree.removeOrphanedFolders()

      await this.setData({...this.getData(), error: null, syncing: false, lastSync: Date.now()})
      console.log('Successfully ended sync process for account ' + this.getLabel())
    } catch (e) {
      if (e.list) {
        var combinedMessage = e.list.map(e => e.message, console.log(e)).join('\n')
        console.error('Syncing failed with', combinedMessage)
        await this.setData({...this.getData(), error: combinedMessage, syncing: false})
      } else {
        console.log(e)
        console.error('Syncing failed with', e)
        await this.setData({...this.getData(), error: e.message, syncing: false})
      }
    }
  }

  async sync_deleteFromServer (mappings) {
    // In the mappings but not in the tree: SERVERDELETE
    var shouldExist = Object.keys(mappings.LocalToServer)
    await Parallel.each(shouldExist,
      async localId => {
        if (!this.tree.getBookmarkByLocalId(localId)) {
          console.log('SERVERDELETE', localId, mappings.LocalToServer[localId])
          await this.server.removeBookmark(mappings.LocalToServer[localId])
          await this.storage.removeFromMappings(localId)
          await this.storage.removeFromCache(localId)
        }
      },
      BATCH_SIZE
    )
  }

  async sync_createOnServer (mappings) {
    // In the tree yet not in the mappings: SERVERCREATE
    await Parallel.each(
      this.tree.getAllBookmarks().filter(localId => typeof mappings.LocalToServer[localId] === 'undefined'),
      async localId => {
        const bookmark = this.tree.getBookmarkByLocalId(localId)
        if (mappings.UrlToLocal[bookmark.url]) {
          console.error('The same URL is bookmarked twice locally:', bookmark.url)
          throw new Error('The same URL is bookmarked twice locally: "' + bookmark.url + '". Delete one of the two.')
        }
        console.log('SERVERCREATE', bookmark)
        let serverMark = await this.server.createBookmark(bookmark)
        if (!serverMark) {
          // ignore this bookmark as it's not supported by the server
          return
        }
        bookmark.id = serverMark.id
        await this.storage.addToMappings(bookmark)
        await this.storage.addToCache(bookmark.localId, await bookmark.hash())
      },
      BATCH_SIZE
    )
  }

  async sync_deleteFromTree (serverList) {
    const received = {}
    serverList.forEach((bm) => (received[bm.id] = true))

    const mappings = await this.storage.getMappings()

    // removed on the server: DELETE
    await Parallel.each(Object.keys(mappings.ServerToLocal),
    // local bookmarks are only in the mappings if they have been added to the server successfully, so we never delete new ones!
      async id => {
        if (!received[id]) {
        // If a bookmark was deleted on the server, we delete it as well
          let localId = mappings.ServerToLocal[id]
          await this.tree.removeNode(this.tree.getBookmarkByLocalId(localId))
          await this.storage.removeFromCache(localId)
          await this.storage.removeFromMappings(localId)
        }
      },
      BATCH_SIZE
    )
  }

  async sync_update (serverMarks) {
    const mappings = await this.storage.getMappings() // For detecting duplicates
    // Update known ones and create new ones
    await Parallel.each(serverMarks,
      async serverMark => {
        serverMark.localId = mappings.ServerToLocal[serverMark.id]
        if (serverMark.localId) {
        // known to mappings: (LOCAL|SERVER)UPDATE
          let localMark = this.tree.getBookmarkByLocalId(serverMark.localId)

          let serverHash = await serverMark.hash()
          let treeHash = await localMark.hash()

          if (treeHash === serverHash) {
            return
          }

          if (!localMark.dirty) {
          // LOCALUPDATE
            await this.tree.updateNode(serverMark)
            await this.storage.addToCache(serverMark.localId, serverHash)
          } else {
          // SERVERUPDATE
            console.log('SERVERUPDATE', localMark, serverMark)
            let couldHandle = await this.server.updateBookmark(localMark.id, localMark)
            if (!couldHandle) {
              // if the protocol is not supported updateBookmark returns false
              // and we ignore it
              await this.server.removeBookmark(localMark.id)
              await this.storage.removeFromMappings(localMark.localId)
              await this.storage.removeFromCache(localMark.localId)
              return
            }
            await this.storage.addToCache(localMark.localId, treeHash)
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
      },
      BATCH_SIZE
    )
  }

  static async getAllAccounts () {
    const d = await browser.storage.local.get({'accounts': {}})
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
