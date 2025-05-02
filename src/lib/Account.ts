import AdapterFactory from './AdapterFactory'
import Logger from './Logger'
import { ItemLocation, TItemLocation } from './Tree'
import UnidirectionalSyncProcess from './strategies/Unidirectional'
import MergeSyncProcess from './strategies/Merge'
import DefaultSyncProcess from './strategies/Default'
import IAccountStorage, { IAccountData, TAccountStrategy } from './interfaces/AccountStorage'
import { TAdapter } from './interfaces/Adapter'
import { OrderFolderResource, TLocalTree } from './interfaces/Resource'
import { Capacitor } from '@capacitor/core'
import IAccount from './interfaces/Account'
import Mappings from './Mappings'
import { isTest } from './isTest'
import CachingAdapter from './adapters/Caching'
import * as Sentry from '@sentry/vue'
import AsyncLock from 'async-lock'
import CachingTreeWrapper from './CachingTreeWrapper'

declare const DEBUG: boolean

// register Adapters
AdapterFactory.register('linkwarden', async() => (await import('./adapters/Linkwarden')).default)
AdapterFactory.register('nextcloud-folders', async() => (await import('./adapters/NextcloudBookmarks')).default)
AdapterFactory.register('nextcloud-bookmarks', async() => (await import('./adapters/NextcloudBookmarks')).default)
AdapterFactory.register('webdav', async() => (await import('./adapters/WebDav')).default)
AdapterFactory.register('git', async() => (await import('./adapters/Git')).default)
AdapterFactory.register('google-drive', async() => (await import('./adapters/GoogleDrive')).default)
AdapterFactory.register('fake', async() => (await import('./adapters/Fake')).default)

// 2h
const LOCK_TIMEOUT = 1000 * 60 * 60 * 2

const dataLock = new AsyncLock()

export default class Account {
  static cache = {}
  static singleton : IAccount

  static async getAccountClass(): Promise<IAccount> {
    if (this.singleton) {
      return this.singleton
    }
    if (Capacitor.getPlatform() === 'web') {
      this.singleton = (await import('./browser/BrowserAccount')).default
    } else {
      this.singleton = (await import('./native/NativeAccount')).default
    }
    return this.singleton
  }

  static async get(id:string):Promise<Account> {
    if (this.cache[id]) {
      await this.cache[id].updateFromStorage()
      return this.cache[id]
    }
    const account = await (await this.getAccountClass()).get(id)
    this.cache[id] = account
    return account
  }

  static async create(data: IAccountData):Promise<Account> {
    return (await this.getAccountClass()).create(data)
  }

  static async import(accounts:IAccountData[]):Promise<void> {
    for (const accountData of accounts) {
      await this.create({...accountData, enabled: false})
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
  protected localTree: TLocalTree
  protected localTabs: TLocalTree
  protected lockTimeout: number

  constructor(id:string, storageAdapter:IAccountStorage, serverAdapter: TAdapter, treeAdapter:TLocalTree) {
    this.server = serverAdapter
    this.id = id
    this.storage = storageAdapter
    this.localTree = treeAdapter
    this.lockTimeout = LOCK_TIMEOUT
  }

  async delete():Promise<void> {
    await this.storage.deleteAccountData()
  }

  getLabel():string {
    return this.server.getLabel()
  }

  getData():IAccountData {
    const data = {
      localRoot: null,
      strategy: 'default' as TAccountStrategy,
      syncInterval: 15,
      nestedSync: false,
      failsafe: true,
      allowNetwork: false,
      label: '',
      errorCount: 0,
      clickCountEnabled: false,
      ...this.server.getData()
    }
    if ('type' in data && data.type === 'nextcloud-folders') {
      data.type = 'nextcloud-bookmarks'
    }
    return data
  }

  async getResource():Promise<OrderFolderResource<typeof ItemLocation.LOCAL>> {
    return this.localTree
  }

  async getServer():Promise<TAdapter> {
    return this.server
  }

  async setData(data:Partial<IAccountData>):Promise<void> {
    await dataLock.acquire(this.id, async() => {
      const d = {...this.server.getData(), ...data}
      await this.storage.setAccountData(d, null)
      this.server.setData(d)
    })
  }

  async updateFromStorage():Promise<void> {
    throw new Error('Not implemented')
  }

  async tracksBookmark(localId:string):Promise<boolean> {
    if (!(await this.isInitialized())) return false
    const mappings = await this.storage.getMappings()
    const snapshot = mappings.getSnapshot()
    const foundBookmark = Object.keys(snapshot.LocalToServer.bookmark).some(
      (id) => String(localId) === String(id)
    )
    const foundFolder = Object.keys(snapshot.LocalToServer.folder).some(
      (id) => String(localId) === String(id)
    )
    return foundBookmark || foundFolder
  }

  async init():Promise<void> {
    throw new Error('Not implemented')
  }

  async isInitialized():Promise<boolean> {
    throw new Error('Not implemented')
  }

  async sync(strategy?:TAccountStrategy, forceSync = false):Promise<void> {
    let mappings: Mappings
    try {
      if (this.getData().syncing || this.syncing) return

      const localResource = new CachingTreeWrapper(await this.getResource())
      if (!(await this.server.isAvailable()) || !(await localResource.isAvailable())) return

      Logger.log('Starting sync process for account ' + this.getLabel())
      Sentry.setUser({ id: this.id })
      this.syncing = true
      await this.setData({ syncing: 0.05, scheduled: false, error: null })

      if (!(await this.isInitialized())) {
        await this.init()
      }

      if (this.server.onSyncStart) {
        const needLock = (strategy || this.getData().strategy) !== 'slave'
        let status
        try {
          status = await this.server.onSyncStart(needLock, forceSync)
        } catch (e) {
          // Resource locked
          if (e.code === 37) {
            // We got a resource locked error
            if (this.getData().lastSync < Date.now() - this.lockTimeout || forceSync) {
              // but if we've been waiting for the lock for more than 2h
              // start again without locking the resource
              status = await this.server.onSyncStart(false, true)
            } else {
              await this.setData({
                error: null,
                syncing: false,
                scheduled: strategy || this.getData().strategy
              })
              this.syncing = false
              Logger.log(
                'Resource is locked, trying again soon'
              )
              return
            }
          } else {
            throw e
          }
        }
        if (status === false) {
          await this.init()
        }
      }

      // main sync steps:
      mappings = await this.storage.getMappings()
      const cacheTree = await this.storage.getCache()

      let strategyClass: typeof DefaultSyncProcess|typeof MergeSyncProcess|typeof UnidirectionalSyncProcess, direction: TItemLocation
      switch (strategy || this.getData().strategy) {
        case 'slave':
          Logger.log('Using "merge slave" strategy (no cache available)')
          strategyClass = UnidirectionalSyncProcess
          direction = ItemLocation.LOCAL
          break
        case 'overwrite':
          Logger.log('Using "merge overwrite" strategy (no cache available)')
          strategyClass = UnidirectionalSyncProcess
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
        this.server,
        async(progress, actionsDone?) => {
          await this.progressCallback(progress, actionsDone)
        }
      )
      this.syncProcess.setCacheTree(cacheTree)
      if (direction) {
        this.syncProcess.setDirection(direction)
      }
      await this.syncProcess.sync()

      await this.setData({ scheduled: false, syncing: 1 })

      // update cache
      const cache = (await localResource.getCacheTree()).clone(false)
      this.syncProcess.filterOutUnacceptedBookmarks(cache)
      await this.storage.setCache(cache)

      if (this.server.onSyncComplete) {
        await this.server.onSyncComplete()
      }

      if (mappings) {
        await mappings.persist()
      }

      this.syncing = false

      await this.setData({
        error: null,
        errorCount: 0,
        syncing: false,
        scheduled: false,
        lastSync: Date.now(),
      })

      Logger.log(
        'Successfully ended sync process for account ' + this.getLabel()
      )
    } catch (e) {
      console.log(e)
      const message = await Account.stringifyError(e)
      console.error('Syncing failed with', message)
      Logger.log('Syncing failed with', message)
      Sentry.setContext('accountData', {
        ...this.getData(),
        username: 'SENSITIVEVALUEHIDDEN',
        password: 'SENSITIVEVALUVALUEHIDDEN',
        passphrase: 'SENSITIVEVALUVALUEHIDDEN'
      })
      if (e.list) {
        Sentry.captureException(message)
      } else {
        Sentry.captureException(e)
      }

      await this.setData({
        error: message,
        errorCount: this.getData().errorCount + 1,
        syncing: false,
        scheduled: false,
      })

      if (this.server.onSyncFail) {
        try {
          await this.server.onSyncFail()
        } catch (e) {
          console.log(e)
          Logger.log(e)
          Logger.log('Error during onSyncFail hooK: ' + e.message)
        }
      }
      this.syncing = false

      // reset cache and mappings after error
      // (but not after NetworkError)
      if (matchAllErrors(e, (e) => e.code !== 17)) {
        await this.init()
      }
    }
  }

  static async stringifyError(er:any):Promise<string> {
    return (await this.getAccountClass()).stringifyError(er)
  }

  async cancelSync():Promise<void> {
    if (this.syncing) {
      this.server.cancel()
    }
    if (this.syncProcess) {
      await this.syncProcess.cancel()
    }
  }

  private async progressCallback(progress: number, actionsDone: number) {
    if (this.syncing) {
      await this.setData({ syncing: progress })
    }
  }

  static async getAllAccounts():Promise<Account[]> {
    return (await this.getAccountClass()).getAllAccounts()
  }

  static async getAccountsContainingLocalId(localId:string, ancestors:string[], allAccounts:Account[]):Promise<Account[]> {
    return (await this.getAccountClass()).getAccountsContainingLocalId(localId, ancestors, allAccounts)
  }
}

function matchAllErrors(e, fn:(e)=>boolean) {
  return fn(e) && (!e.list || e.list.every(e => matchAllErrors(e, fn)))
}
