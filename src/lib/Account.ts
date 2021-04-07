import BrowserAccount from './browser/BrowserAccount'
import AdapterFactory from './AdapterFactory'
import LocalTabs from './LocalTabs'
import browser from './browser-api'
import BrowserTree from './browser/BrowserTree'
import Logger from './Logger'
import { Folder, ItemLocation } from './Tree'
import UnidirectionalMergeSyncProcess from './strategies/UnidirectionalMerge'
import UnidirectionalSyncProcess from './strategies/Unidirectional'
import MergeSyncProcess from './strategies/Merge'
import DefaultSyncProcess from './strategies/Default'
import BrowserAccountStorage from './browser/BrowserAccountStorage'
import IAccountStorage, { IAccountData, TAccountStrategy } from './interfaces/AccountStorage'
import { TAdapter } from './interfaces/Adapter'
import NextcloudFoldersAdapter from './adapters/NextcloudFolders'
import WebDavAdapter from './adapters/WebDav'
import GoogleDriveAdapter from './adapters/GoogleDrive'
import FakeAdapter from './adapters/Fake'
import TResource from './interfaces/Resource'

// register Adapters
AdapterFactory.register('nextcloud-folders', NextcloudFoldersAdapter)
AdapterFactory.register('webdav', WebDavAdapter)
AdapterFactory.register('google-drive', GoogleDriveAdapter)
AdapterFactory.register('fake', FakeAdapter)

export default class Account {
  static cache = {}

  static async get(id:string):Promise<Account> {
    if (this.cache[id]) {
      await this.cache[id].updateFromStorage()
      return this.cache[id]
    }
    const account = await BrowserAccount.get(id)
    this.cache[id] = account
    return account
  }

  static async create(data: IAccountData):Promise<Account> {
    return BrowserAccount.create(data)
  }

  static async import(accounts:IAccountData[]):Promise<void> {
    for (const accountData of accounts) {
      await BrowserAccount.create({...accountData, enabled: false})
    }
  }

  static async export(accountIds:string[]):Promise<IAccountData[]> {
    return (await Promise.all(
      accountIds.map(id => Account.get(id))
    )).map(a => a.getData())
  }

  public id: string
  public syncing: boolean
  protected syncProcess: DefaultSyncProcess
  protected storage: IAccountStorage
  protected server: TAdapter
  protected localTree: TResource
  protected localTabs: TResource

  constructor(id:string, storageAdapter:IAccountStorage, serverAdapter: TAdapter, treeAdapter:TResource) {
    this.server = serverAdapter
    this.id = id
    this.storage = storageAdapter
    this.localTree = treeAdapter
    this.localTabs = new LocalTabs(this.storage)
  }

  async delete():Promise<void> {
    await this.storage.deleteAccountData()
  }

  getLabel():string {
    return this.server.getLabel()
  }

  getData():IAccountData {
    const defaults = {
      localRoot: null,
      strategy: 'default' as TAccountStrategy,
      syncInterval: 15,
      nestedSync: false,
      failsafe: true,
    }
    return {...defaults, ...this.server.getData()}
  }

  async setData(data:IAccountData):Promise<void> {
    const background = await browser.runtime.getBackgroundPage()
    await this.storage.setAccountData(data, background.controller.key)
    this.server.setData(data)
  }

  async updateFromStorage():Promise<void> {
    const background = await browser.runtime.getBackgroundPage()
    const data = await this.storage.getAccountData(background.controller.key)
    this.server.setData(data)
    this.localTree = new BrowserTree(this.storage, data.localRoot)
  }

  async tracksBookmark(localId:string):Promise<boolean> {
    if (!(await this.isInitialized())) return false
    const mappings = await this.storage.getMappings()
    return Object.keys(mappings.getSnapshot().LocalToServer.bookmark).some(
      (id) => localId === id
    )
  }

  async init():Promise<void> {
    throw new Error('Not implemented')
  }

  async isInitialized():Promise<boolean> {
    throw new Error('Not implemented')
  }

  async sync(strategy?:TAccountStrategy):Promise<void> {
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
        const status = await this.server.onSyncStart()
        if (status === false) {
          await this.init()
        }
      }

      // main sync steps:
      mappings = await this.storage.getMappings()
      const cacheTree = localResource instanceof BrowserTree ? await this.storage.getCache() : new Folder({title: '', id: 'tabs', location: ItemLocation.LOCAL})

      let strategyClass, direction
      switch (strategy || this.getData().strategy) {
        case 'slave':
          if (!cacheTree.children.length) {
            Logger.log('Using "merge slave" strategy (no cache available)')
            strategyClass = UnidirectionalMergeSyncProcess
          } else {
            Logger.log('Using slave strategy')
            strategyClass = UnidirectionalSyncProcess
          }
          direction = ItemLocation.LOCAL
          break
        case 'overwrite':
          if (!cacheTree.children.length) {
            Logger.log('Using "merge overwrite" strategy (no cache available)')
            strategyClass = UnidirectionalMergeSyncProcess
          } else {
            Logger.log('Using "overwrite" strategy')
            strategyClass = UnidirectionalSyncProcess
          }
          direction = ItemLocation.SERVER
          break
        default:
          if (!cacheTree.children.length) {
            Logger.log('Using "merge default" strategy (no cache available)')
            strategyClass = MergeSyncProcess
          } else {
            Logger.log('Using "default" strategy')
            strategyClass = DefaultSyncProcess
          }
          break
      }

      this.syncProcess = new strategyClass(
        mappings,
        localResource,
        cacheTree,
        this.server,
        (progress) => {
          this.setData({ ...this.getData(), syncing: progress })
        }
      )
      if (direction) {
        this.syncProcess.setDirection(direction)
      }
      await this.syncProcess.sync()

      // update cache
      if (localResource instanceof BrowserTree) {
        const cache = await localResource.getBookmarksTree()
        this.syncProcess.filterOutUnacceptedBookmarks(cache)
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
      const message = BrowserAccount.stringifyError(e)
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

  static stringifyError(er:any):string {
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

  async cancelSync():Promise<void> {
    if (!this.syncing) return
    return this.syncProcess.cancel()
  }

  static async getAllAccounts():Promise<Account[]> {
    return Promise.all(
      (await BrowserAccountStorage.getAllAccounts()).map((accountId) =>
        BrowserAccount.get(accountId)
      )
    )
  }

  static async getAccountsContainingLocalId(localId:string, ancestors:string[], allAccounts:Account[]):Promise<Account[]> {
    ancestors = ancestors || (await BrowserTree.getIdPathFromLocalId(localId))
    allAccounts = allAccounts || (await this.getAllAccounts())

    const accountsInvolved = allAccounts
      .filter(acc => ancestors.indexOf(acc.getData().localRoot) !== -1)
      .reverse()

    const lastNesterIdx = accountsInvolved.findIndex(acc => !acc.getData().nestedSync)
    return accountsInvolved.slice(0, lastNesterIdx)
  }
}
