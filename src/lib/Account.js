import AccountStorage from './AccountStorage'
import Adapter from './Adapter'
import NextcloudFoldersAdapter from './adapters/NextcloudFolders'
import NextcloudAdapter from './adapters/Nextcloud'
import WebDavAdapter from './adapters/WebDav'
import FakeAdapter from './adapters/Fake'
import Tree from './Tree'
import LocalTree from './LocalTree'
import SyncProcess from './SyncProcess'
import Logger from './Logger'
import browser from './browser-api'

// register Adapters
Adapter.register('nextcloud', NextcloudAdapter)
Adapter.register('nextcloud-folders', NextcloudFoldersAdapter)
Adapter.register('webdav', WebDavAdapter)
Adapter.register('fake', FakeAdapter)

export default class Account {
  static async get(id) {
    if (!this.cache) {
      this.cache = {}
    }
    if (this.cache[id]) {
      await this.cache[id].updateFromStorage()
      return this.cache[id]
    }
    let storage = new AccountStorage(id)
    let background = await browser.runtime.getBackgroundPage()
    let data = await storage.getAccountData(background.controller.key)
    let tree = new LocalTree(storage, data.localRoot)
    let account = new Account(id, storage, Adapter.factory(data), tree)
    this.cache[id] = account
    return account
  }

  static async create(data) {
    let id = '' + Date.now()
    let storage = new AccountStorage(id)

    let background = await browser.runtime.getBackgroundPage()
    await storage.setAccountData(data, background.controller.key)
    let account = new Account(id, storage, Adapter.factory(data))
    return account
  }

  static getDefaultValues(type) {
    return Adapter.factory({ type }).constructor.getDefaultValues()
  }

  constructor(id, storageAdapter, serverAdapter, treeAdapter) {
    this.server = serverAdapter
    this.id = id
    this.storage = storageAdapter
    this.localTree = treeAdapter
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
    let background = await browser.runtime.getBackgroundPage()
    await this.storage.setAccountData(data, background.controller.key)
    this.server.setData(data)
  }

  async updateFromStorage() {
    let background = await browser.runtime.getBackgroundPage()
    let data = await this.storage.getAccountData(background.controller.key)
    this.server.setData(data)
    this.localTree = new LocalTree(this.storage, data.localRoot)
  }

  async tracksBookmark(localId) {
    if (!(await this.isInitialized())) return false
    let mappings = await this.storage.getMappings()
    return Object.keys(mappings.bookmarks.LocalToServer).some(
      id => localId === id
    )
  }

  renderOptions(state, actions) {
    return this.server.renderOptions(state, actions)
  }

  async init() {
    console.log('initializing account ' + this.id)
    const accData = this.getData()
    try {
      await browser.bookmarks.getSubTree(accData.localRoot)
    } catch (e) {
      let parentNode = await browser.bookmarks.getTree()
      let bookmarksBar = parentNode[0].children[0]
      let node = await browser.bookmarks.create({
        title: 'Nextcloud (' + this.getLabel() + ')',
        parentId: bookmarksBar.id
      })
      accData.localRoot = node.id
      await this.setData(accData)
    }
    await this.storage.initMappings()
    await this.storage.initCache()
    this.localTree = new LocalTree(this.storage, accData.localRoot)
  }

  async isInitialized() {
    try {
      let localRoot = this.getData().localRoot
      await browser.bookmarks.getSubTree(localRoot)
      return true
    } catch (e) {
      console.log('Apparently not initialized, because:', e)
      return false
    }
  }

  async sync() {
    try {
      if (this.getData().syncing || this.syncing) return

      Logger.log('Starting sync process for account ' + this.getLabel())
      this.syncing = true
      await this.setData({ ...this.getData(), syncing: true, error: null })

      if (!(await this.isInitialized())) {
        await this.init()
      }
      if (this.server.onSyncStart) {
        await this.server.onSyncStart()
      }

      // main sync steps:

      let mappings = await this.storage.getMappings()

      const sync = new SyncProcess(
        mappings,
        this.localTree,
        await this.storage.getCache(),
        this.server
      )
      await sync.sync()

      // update cache
      await this.storage.setCache(await this.localTree.getBookmarksTree())

      await this.setData({
        ...this.getData(),
        error: null,
        syncing: false,
        lastSync: Date.now()
      })
      this.syncing = false

      if (this.server.onSyncComplete) {
        await this.server.onSyncComplete()
      }

      Logger.log(
        'Successfully ended sync process for account ' + this.getLabel()
      )
    } catch (e) {
      console.log(e)
      var message = Account.stringifyError(e)
      console.error('Syncing failed with', message)
      await this.setData({
        ...this.getData(),
        error: message,
        syncing: false
      })
      this.syncing = false
      if (this.server.onSyncFail) {
        await this.server.onSyncFail()
      }
    }
    await Logger.persist()
  }

  static stringifyError(er) {
    if (er.list) {
      return er.list
        .map(e => {
          console.log(e)
          return this.stringifyError(e)
        })
        .join('\n')
    }
    return er.message
  }

  static async getAllAccounts() {
    const d = await browser.storage.local.get({ accounts: {} })
    var accounts = d['accounts']

    accounts = await Promise.all(
      Object.keys(accounts).map(accountId => Account.get(accountId))
    )

    return accounts
  }

  static async getAccountContainingLocalId(localId, ancestors, allAccounts) {
    ancestors = ancestors || (await Tree.getIdPathFromLocalId(localId))
    allAccounts = allAccounts || (await this.getAllAccounts())
    var account = allAccounts
      .map(account => ({
        account,
        index: ancestors.indexOf(account.getData().localRoot)
      }))
      .filter(acc => acc.index !== -1)
      .reduce(
        (acc1, acc2) => {
          if (acc1.index > acc2.index) return acc1
          else return acc2
        },
        { account: null, index: -1 }
      ).account

    return account
  }
}
