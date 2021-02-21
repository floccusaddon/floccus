import AccountStorage from './AccountStorage'
import NextcloudFoldersAdapter from './adapters/NextcloudFolders'
import WebDavAdapter from './adapters/WebDav'
import GoogleDriveAdapter from './adapters/GoogleDrive'
import FakeAdapter from './adapters/Fake'
import LocalTree from './LocalTree'
import DefaultSyncProcess from './strategies/Default'
import UnidirectionalSyncProcess from './strategies/Unidirectional'
import Logger from './Logger'
import browser from './browser-api'
import AdapterFactory from './AdapterFactory'
import MergeSyncProcess from './strategies/Merge'
import LocalTabs from './LocalTabs'
import { Folder, ItemLocation } from './Tree'
import UnidirectionalMergeSyncProcess from './strategies/UnidirectionalMerge'

// register Adapters
AdapterFactory.register('nextcloud-folders', NextcloudFoldersAdapter)
AdapterFactory.register('webdav', WebDavAdapter)
AdapterFactory.register('google-drive', GoogleDriveAdapter)
AdapterFactory.register('fake', FakeAdapter)

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
    let account = new Account(id, storage, AdapterFactory.factory(data), tree)
    this.cache[id] = account
    return account
  }

  static async create(data) {
    let id = '' + Date.now() + Math.random()
    let adapter = AdapterFactory.factory(data)
    let storage = new AccountStorage(id)

    let background = await browser.runtime.getBackgroundPage()
    await storage.setAccountData(data, background.controller.key)
    let account = new Account(id, storage, adapter)
    return account
  }

  static async import(accounts) {
    for (const accountData of accounts) {
      await Account.create({...accountData, enabled: false})
    }
  }

  static async export(accountIds) {
    return (await Promise.all(
      accountIds.map(id => Account.get(id))
    )).map(a => a.getData())
  }

  static getDefaultValues(type) {
    return {
      ...AdapterFactory.factory({ type }).constructor.getDefaultValues(),
      enabled: true,
    }
  }

  constructor(id, storageAdapter, serverAdapter, treeAdapter) {
    this.server = serverAdapter
    this.id = id
    this.storage = storageAdapter
    this.localTree = treeAdapter
    this.localTabs = new LocalTabs(this.storage)
  }

  async delete() {
    await this.storage.deleteAccountData()
  }

  getLabel() {
    return this.server.getLabel()
  }

  getData() {
    const defaults = {
      localRoot: null,
      strategy: 'default',
      syncInterval: 15,
      nestedSync: false,
      failsafe: true,
    }
    return {...defaults, ...this.server.getData()}
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
      (id) => localId === id
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
        title: 'Floccus (' + this.getLabel() + ')',
        parentId: bookmarksBar.id,
      })
      accData.localRoot = node.id
      accData.rootPath = await LocalTree.getPathFromLocalId(node.id)
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
    let mappings
    try {
      if (this.getData().syncing || this.syncing) return

      Logger.log('Starting sync process for account ' + this.getLabel())
      this.syncing = true
      await this.setData({ ...this.getData(), syncing: 0.05, error: null })

      if (this.getData().localRoot !== 'tabs' && !(await this.isInitialized())) {
        await this.init()
      }

      const localResource = this.getData().localRoot !== 'tabs' ? this.localTree : this.localTabs

      if (this.server.onSyncStart) {
        await this.server.onSyncStart()
      }

      // main sync steps:
      mappings = await this.storage.getMappings()
      const cacheTree = localResource instanceof LocalTree ? await this.storage.getCache() : new Folder({title: '', id: 'tabs'})

      let strategy, direction
      switch (this.getData().strategy) {
        case 'slave':
          if (!cacheTree.children.length) {
            Logger.log('Using "merge slave" strategy (no cache available)')
            strategy = UnidirectionalMergeSyncProcess
          } else {
            Logger.log('Using slave strategy')
            strategy = UnidirectionalSyncProcess
          }
          direction = ItemLocation.LOCAL
          break
        case 'overwrite':
          if (!cacheTree.children.length) {
            Logger.log('Using "merge overwrite" strategy (no cache available)')
            strategy = UnidirectionalMergeSyncProcess
          } else {
            Logger.log('Using "overwrite" strategy')
            strategy = UnidirectionalSyncProcess
          }
          direction = ItemLocation.SERVER
          break
        default:
          if (!cacheTree.children.length) {
            Logger.log('Using "merge default" strategy (no cache available)')
            strategy = MergeSyncProcess
          } else {
            Logger.log('Using "default" strategy')
            strategy = DefaultSyncProcess
          }
          break
      }

      this.syncing = new strategy(
        mappings,
        localResource,
        cacheTree,
        this.server,
        (progress) => {
          this.setData({ ...this.getData(), syncing: progress })
        }
      )
      if (direction) {
        this.syncing.setDirection(direction)
      }
      await this.syncing.sync()

      // update cache
      if (localResource instanceof LocalTree) {
        const cache = await localResource.getBookmarksTree()
        this.syncing.filterOutUnacceptedBookmarks(cache)
        await this.storage.setCache(cache)
      }

      if (this.server.onSyncComplete) {
        await this.server.onSyncComplete()
      }

      await this.setData({
        ...this.getData(),
        error: null,
        syncing: false,
        lastSync: Date.now(),
      })

      this.syncing = false

      Logger.log(
        'Successfully ended sync process for account ' + this.getLabel()
      )
      if (mappings) {
        await mappings.persist()
      }
    } catch (e) {
      console.log(e)
      const message = Account.stringifyError(e)
      console.error('Syncing failed with', message)
      Logger.log('Syncing failed with', message)

      await this.setData({
        ...this.getData(),
        error: message,
        syncing: false,
      })
      this.syncing = false
      if (this.server.onSyncFail) {
        await this.server.onSyncFail()
      }

      if (mappings) {
        await mappings.persist()
      }
    }
    await Logger.persist()
  }

  static stringifyError(er) {
    if (er.list) {
      return er.list
        .map((e) => {
          Logger.log(e)
          return this.stringifyError(e)
        })
        .join('\n')
    }
    return er.message
  }

  async cancelSync() {
    if (!this.syncing) return
    return this.syncing.cancel()
  }

  static async getAllAccounts() {
    return Promise.all(
      (await AccountStorage.getAllAccounts()).map((accountId) =>
        Account.get(accountId)
      )
    )
  }

  static async getAccountsContainingLocalId(localId, ancestors, allAccounts) {
    ancestors = ancestors || (await LocalTree.getIdPathFromLocalId(localId))
    allAccounts = allAccounts || (await this.getAllAccounts())

    const accountsInvolved = allAccounts
      .filter(acc => ancestors.indexOf(acc.getData().localRoot) !== -1)
      .reverse()

    const lastNesterIdx = accountsInvolved.findIndex(acc => !acc.getData().nestedSync)
    return accountsInvolved.slice(0, lastNesterIdx)
  }
}
