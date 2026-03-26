import AdapterFactory from './AdapterFactory'
import Logger from './Logger'
import { ItemLocation, TItemLocation } from './Tree'
import UnidirectionalSyncProcess from './strategies/Unidirectional'
import MergeSyncProcess from './strategies/Merge'
import DefaultSyncProcess from './strategies/Default'
import IAccountStorage, { IAccountData, TAccountStrategy } from './interfaces/AccountStorage'
import { TAdapter } from './interfaces/Adapter'
import { OrderFolderResource, TLocalTree } from './interfaces/Resource'
import IAccount from './interfaces/Account'
import Mappings from './Mappings'
import { isTest } from './isTest'
import { setUser, setContext, withScope, captureException } from '@sentry/browser'
import AsyncLock from 'async-lock'
import CachingTreeWrapper from './CachingTreeWrapper'
import {
  ClientsideAdditionFailsafeError, ClientsideDeletionFailsafeError,
  InterruptedSyncError,
  NetworkError,
  ServersideAdditionFailsafeError, ServersideDeletionFailsafeError, TransientError,
  UnexpectedFolderPathError
} from '../errors/Error'

declare const IS_BROWSER: boolean

// register Adapters
AdapterFactory.register('linkwarden', async() => (await import('./adapters/Linkwarden')).default)
AdapterFactory.register('karakeep', async() => (await import('./adapters/Karakeep')).default)
AdapterFactory.register('nextcloud-folders', async() => (await import('./adapters/NextcloudBookmarks')).default)
AdapterFactory.register('nextcloud-bookmarks', async() => (await import('./adapters/NextcloudBookmarks')).default)
AdapterFactory.register('webdav', async() => (await import('./adapters/WebDav')).default)
AdapterFactory.register('git', async() => (await import('./adapters/Git')).default)
AdapterFactory.register('google-drive', async() => (await import('./adapters/GoogleDrive')).default)
AdapterFactory.register('dropbox', async() => (await import('./adapters/Dropbox')).default)
AdapterFactory.register('fake', async() => (await import('./adapters/Fake')).default)

// 2h
const LOCK_TIMEOUT = 1000 * 60 * 60 * 2

const dataLock = new AsyncLock()
const accountLock = new AsyncLock()

export default class Account {
  static cache = {}
  static singleton : IAccount

  static async getAccountClass(): Promise<IAccount> {
    if (this.singleton) {
      return this.singleton
    }
    if (IS_BROWSER) {
      this.singleton = (await import('./browser/BrowserAccount')).default
    } else {
      this.singleton = (await import('./native/NativeAccount')).default
    }
    return this.singleton
  }

  static async get(id:string):Promise<Account> {
    return accountLock.acquire(id, async() => {
      if (this.cache[id]) {
        await this.cache[id].updateFromStorage()
        return this.cache[id]
      }
      const account = await (await this.getAccountClass()).get(id)
      this.cache[id] = account
      return account
    })
  }

  static async create(data: IAccountData):Promise<Account> {
    return (await this.getAccountClass()).create(data)
  }

  static async import(accounts:IAccountData[]):Promise<void> {
    for (const accountData of accounts) {
      await this.create({...accountData, enabled: false, syncIntervalEnabled: false})
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

  private localCachingResource: CachingTreeWrapper

  constructor(id:string, storageAdapter:IAccountStorage, serverAdapter: TAdapter, treeAdapter:TLocalTree) {
    this.server = serverAdapter
    this.id = id
    this.storage = storageAdapter
    this.localTree = treeAdapter
    this.lockTimeout = LOCK_TIMEOUT
    this.localCachingResource = null
  }

  async delete():Promise<void> {
    await this.storage.deleteAccountData()
  }

  getLabel():string {
    return this.server.getLabel()
  }

  getData():IAccountData {
    const data = {
      enabled: false,
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
    if (!('syncIntervalEnabled' in data) && 'enabled' in data) {
      data.syncIntervalEnabled = data.enabled
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

      if (!(await this.server.isAvailable()) || !(await (await this.getResource()).isAvailable())) return

      this.localCachingResource = new CachingTreeWrapper(await this.getResource())

      Logger.log('Starting sync process for account ' + this.getLabel())
      setUser({ id: this.id })
      this.syncing = true
      await this.setData({ syncing: 0.05, scheduled: false, error: null })

      if (!(await this.isInitialized())) {
        await this.init()
      }

      if (IS_BROWSER) {
        const newPath = await (await import('./browser/BrowserTree')).default.getPathFromLocalId(this.getData().localRoot)
        const oldPath = this.getData().rootPath
        if (oldPath && newPath !== oldPath) {
          throw new UnexpectedFolderPathError(oldPath, newPath)
        }
      }

      if (this.server.onSyncStart) {
        const needLock = (strategy || this.getData().strategy) !== 'slave'
        let status
        try {
          Logger.log('Calling onSyncStart')
          status = await this.server.onSyncStart(needLock, forceSync)
        } catch (e) {
          // Resource locked
          if (e.code === 37) {
            // We got a resource locked error
            if (this.getData().lastSync < Date.now() - this.lockTimeout || forceSync) {
              // but if we've been waiting for the lock for more than 2h
              // start again without locking the resource
              Logger.log('Calling onSyncStart, forcing sync')
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
              await Logger.persist()
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

      Logger.log('Fetching mappings')
      mappings = await this.storage.getMappings()
      Logger.log('Fetched mappings')

      Logger.log('Fetching cache')
      const cacheTree = await this.storage.getCache()
      Logger.log('Fetched cache')

      Logger.log('Fetching pending continuation')
      let continuation = await this.storage.getCurrentContinuation()
      Logger.log('Fetched pending continuation')

      if (typeof continuation !== 'undefined' && continuation !== null) {
        try {
          Logger.log('Attempting to load pending continuation')

          if (!this.localCachingResource) {
            throw new Error('localCachingResource not initialized')
          }
          if (!this.server) {
            throw new Error('server not initialized')
          }

          this.syncProcess = await DefaultSyncProcess.fromJSON(
            mappings,
            this.localCachingResource,
            this.server,
            async(progress, actionDone) => {
              await this.progressCallback(progress, actionDone)
            },
            continuation
          )
          Logger.log('Loaded pending continuation')
        } catch (e) {
          continuation = null
          if (e.message) Logger.log(e.message)
          Logger.log('Failed to load pending continuation. Continuing with normal sync')
        }
      }

      if (typeof continuation === 'undefined' || continuation === null || (typeof strategy !== 'undefined' && continuation.strategy !== strategy) || Date.now() - continuation.createdAt > 1000 * 60 * 30) {
        // If there is no pending continuation, we just sync normally
        // Same if the pending continuation was overridden by a different strategy
        // same if the continuation is older than half an hour. We don't want old zombie continuations

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
            if (!cacheTree.children?.length) {
              Logger.log('Using "merge default" strategy (no cache available)')
              strategyClass = MergeSyncProcess
            } else {
              Logger.log('Using "default" strategy')
              strategyClass = DefaultSyncProcess
            }
            break
        }

        Logger.log('Creating new sync process')
        this.syncProcess = new strategyClass(
          mappings,
          this.localCachingResource,
          this.server,
          async(progress, actionsDone?) => {
            await this.progressCallback(progress, actionsDone)
          }
        )
        this.syncProcess.setCacheTree(cacheTree)
        if (direction) {
          this.syncProcess.setDirection(direction)
        }
      } else {
        // if there is a pending continuation, we resume it (see construction above)
        Logger.log('Found existing persisted pending continuation. Resuming last sync')
        // When resuming a continuation, the CachingTreeWrapper is usually not initialized yet, because the localTree is
        // set from the persisted continuation
        Logger.log('Fetching local bookmarks tree')
        this.syncProcess.setCacheTree(cacheTree)
        // Allow Caching of the local tree
        await this.localCachingResource.getBookmarksTree()
      }

      Logger.log('Starting sync process')
      await this.syncProcess.sync()
      Logger.log('Ended sync process')

      await this.setData({ scheduled: false, syncing: 1 })

      // update cache
      Logger.log('Storing cache')
      const cache = (await this.localCachingResource.getCacheTree()).clone(false)
      this.syncProcess.filterOutUnacceptedBookmarks(cache)
      await this.storage.setCache(await cache.toJSONAsync())

      if (this.server.onSyncComplete) {
        Logger.log('Calling onSyncComplete')
        await this.server.onSyncComplete()
      }

      if (mappings) {
        // Remove superfluous items from mappings
        // as we don't remove items immediately for anymore (for Atomic adapters), due to possible interrupts
        Logger.log('Removing superfluous mappings')
        await mappings.gc(cache)
        // store mappings
        Logger.log('Storing mappings')
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

      await this.storage.setCurrentContinuation(null)

      Logger.log(
        'Successfully ended sync process for account ' + this.getLabel()
      )
    } catch (e) {
      console.log(e)
      const message = await Account.stringifyError(e)

      // Catch MappingFailureError and gracefully resume with reset cache
      if (matchAllErrors(e, e => e.code === 48)) {
        Logger.log('Caught MappingFailureError: Gracefully resuming with reset cache')
        await this.init()
        await this.storage.setCurrentContinuation(null)
        this.syncProcess = null
        this.localCachingResource = null
        await this.setData({ syncing: false })
        this.syncing = false
        return this.sync(strategy, forceSync)
      }

      console.error('Syncing failed with', message)
      Logger.log('Syncing failed with', message)
      setContext('accountData', {
        ...this.getData(),
        username: 'SENSITIVEVALUEHIDDEN',
        password: 'SENSITIVEVALUVALUEHIDDEN',
        passphrase: 'SENSITIVEVALUVALUEHIDDEN'
      })
      withScope((scope) => {
        scope.setTag('adapter', this.getData().type)
        if (e.list) {
          captureException(message)
        } else {
          captureException(e)
        }
      })

      if (this.server.onSyncFail) {
        await this.server.onSyncFail()
      }

      this.syncing = false

      const isTransient = matchAllErrors(e, e => e instanceof TransientError)

      await this.setData({
        error: message,
        isTransientError: isTransient,
        errorCount: this.getData().errorCount + 1,
        syncing: false,
        scheduled: false,
      })
      if (matchAllErrors(e, e => ![
        new InterruptedSyncError().code,
        new NetworkError().code,
        new ServersideAdditionFailsafeError(0).code,
        new ServersideDeletionFailsafeError(0).code,
        new ClientsideAdditionFailsafeError(0).code,
        new ClientsideDeletionFailsafeError(0).code,
      ].includes(e.code) && (!isTest || e.code !== 26))) {
        await this.storage.setCurrentContinuation(null)
        await this.init()
      }
    }

    this.syncProcess = null
    this.localCachingResource = null
    await Logger.persist()
  }

  static async stringifyError(er:any):Promise<string> {
    return (await this.getAccountClass()).stringifyError(er)
  }

  async cancelSync():Promise<void> {
    if (!this.syncing) return
    if (self.constructor.name !== 'ServiceWorkerGlobalScope' && window.location.toString().includes('background.html')) {
      // If we're running in a static background page
      // reload
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      window.location = window.location.toString()
    }
    this.server.cancel()
    this.getResource().then(resource => resource.cancel())
    if (this.syncProcess) {
      await this.syncProcess.cancel()
    }
  }

  private async progressCallback(progress: number, actionsDone: number) {
    if (!this.syncing) {
      return
    }
    await this.setData({ syncing: progress })
    if (!this.syncProcess) {
      return
    }
    if (actionsDone) {
      const mappings = this.syncProcess.getMappingsInstance()
      if (this.server.isAtomic()) {
        Logger.log('progressCallback: Persisting cache')
        if (!this.localCachingResource) {
          return
        }
        const cache = (await this.localCachingResource.getCacheTree()).clone(
          false
        )
        this.syncProcess.filterOutUnacceptedBookmarks(cache)
        await this.storage.setCache(cache)
        Logger.log('progressCallback: Persisting mappings')
        await mappings.persist()
      } else {
        Logger.log('progressCallback: Serializing continuation')
        const cont = await this.syncProcess.toJSONAsync()
        if (!this.syncing) {
          return
        }
        if (!this.syncProcess) {
          return
        }
        Logger.log('progressCallback: Persisting continuation')
        await this.storage.setCurrentContinuation(cont)
        Logger.log('progressCallback: Persisting mappings')
        await mappings.persist()
      }
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
  return fn(e) && (e.list ? e.list.every(e => matchAllErrors(e, fn)) : true)
}
