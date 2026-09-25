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
import AsyncLock from 'async-lock'
import CachingTreeWrapper from './CachingTreeWrapper'
import { filterUnacceptedBookmarks } from './CacheTree'
import { isOAuthAccount } from './AccountAuthorization'
import {
  ClientsideAdditionFailsafeError, ClientsideDeletionFailsafeError, FloccusError,
  InterruptedSyncError,
  LocalFolderNotFoundError,
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
AdapterFactory.register(
  'fake-nc-bookmarks',
  async() => (await import('./adapters/FakeNcBookmarks')).default
)

// 2h
const LOCK_TIMEOUT = 1000 * 60 * 60 * 2

const dataLock = new AsyncLock()
const continuationLock = new AsyncLock()
const accountLock = new AsyncLock()

/**
 * The bookkeeping of one running installation: where the last sync got to, and
 * how it went. None of it means anything in a different profile, and carrying it
 * over breaks the imported profile in ways that are hard to see -- a stale
 * `error` keeps the scheduler from ever picking the profile up, a `syncing` flag
 * left over from an export taken mid-sync makes sync() bail out every time, and
 * an old `lastSync` immediately flags the profile as out of date.
 */
const VOLATILE_ACCOUNT_DATA = ['syncing', 'scheduled', 'error', 'isTransientError', 'errorCount', 'lastSync', 'lastAttempt'] as const

function stripVolatileData(data: IAccountData): IAccountData {
  const cleanData = {...data}
  for (const key of VOLATILE_ACCOUNT_DATA) {
    delete cleanData[key]
  }
  return cleanData
}

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

  static async import(accounts:IAccountData[]):Promise<string[]> {
    const ids = []
    for (const accountData of accounts) {
      const account = await this.create({
        ...stripVolatileData(accountData),
        // OAuth refresh tokens are bound to the client_id that issued them, which
        // differs between the browser extension and the mobile app, so an imported
        // token would only ever yield E018. Make the user log in again instead.
        ...(isOAuthAccount(accountData) && {refreshToken: null}),
      })
      ids.push(account.id)
    }
    return ids
  }

  static async export(accountIds:string[]):Promise<IAccountData[]> {
    return (await Promise.all(
      accountIds.map(id => Account.get(id))
    )).map(a => stripVolatileData(a.getData()))
      // Don't write OAuth refresh tokens into a file that people hand around and
      // attach to bug reports: they are live credentials and importing them is a
      // no-op anyway, since they're only valid for the platform that issued them.
      .map(data => isOAuthAccount(data) ? {...data, refreshToken: null} : data)
  }

  public id: string
  public syncing: boolean
  // Test-only hook: invoked with each freshly created sync process so benchmark
  // tests can configure a deterministic, count-based interrupt.
  public onSyncProcessCreated: ((syncProcess: DefaultSyncProcess) => void) | null = null
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
      syncOnStartupEnabled: false,
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
    if (!IS_BROWSER) {
      data.syncIntervalEnabled = false
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

      this.localCachingResource = new CachingTreeWrapper(await this.getResource(), this.storage.getCacheStore())

      Logger.log('Starting sync process for account ' + this.getLabel())
      this.syncing = true
      await this.setData({ syncing: 0.05, scheduled: false, error: null, lastAttempt: Date.now() })

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
      // The bookmarks the server would refuse were never on it, so they must be
      // no part of the tree the scanner diffs against the local one -- which
      // prepareSync filters the same way. The cache used to be filtered as it
      // was written; it is rows now and holds the tree as it is, so this is
      // where it happens.
      filterUnacceptedBookmarks(cacheTree, (bm) => this.server.acceptsBookmark(bm))
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

      if (this.onSyncProcessCreated) {
        this.onSyncProcessCreated(this.syncProcess)
      }

      Logger.log('Starting sync process')
      await this.syncProcess.sync()
      Logger.log('Ended sync process')

      await this.setData({ scheduled: false, syncing: 1 })

      // update cache
      Logger.log('Storing cache')
      // Read before storing: a change landing during the write has to leave the
      // cache dirty
      const cacheRevision = this.localCachingResource.getCacheRevision()
      await this.localCachingResource.saveCache((bm) => this.server.acceptsBookmark(bm))
      this.localCachingResource.markCachePersisted(cacheRevision)

      // A copy of our own for Mappings#gc below, which indexes and walks it as
      // a tree. This runs once per sync, so the extra copy doesn't matter here.
      const cache = await this.localCachingResource.getCacheTree()
      this.syncProcess.filterOutUnacceptedBookmarks(cache)

      if (this.server.onSyncComplete) {
        Logger.log('Calling onSyncComplete')
        await this.server.onSyncComplete()
      }

      if (mappings) {
        // Remove superfluous items from mappings
        // as we don't remove items immediately for anymore (for Atomic adapters), due to possible interrupts
        Logger.log('Removing superfluous mappings')
        // For atomic adapters the in-memory cache is a complete, post-sync server tree, so we
        // can also drop mappings whose remote counterpart no longer exists. Non-atomic adapters
        // return a sparse tree from getBookmarksTree(); using it for GC would erroneously drop
        // mappings for unloaded items, so we skip the remote-side check there.
        let serverTree
        if (this.server.isAtomic()) {
          try {
            serverTree = await this.server.getBookmarksTree()
          } catch (e) {
            Logger.log('Could not fetch server tree for mapping GC, skipping remote-side cleanup', e)
          }
        }
        await mappings.gc(cache, serverTree)
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

      await this.clearContinuation()

      Logger.log(
        'Successfully ended sync process for account ' + this.getLabel()
      )
    } catch (e) {
      console.log(e)
      const message = await Account.stringifyError(e)

      // Catch MappingFailureError and gracefully resume with reset cache
      if (matchAllErrors(e, e => e.code === 48)) {
        Logger.log('Caught MappingFailureError: Gracefully resuming with reset cache and forceSync:true')
        // Clear the syncing flag first: init() can fail (e.g. when the local
        // folder went away mid-sync) and a profile that is stuck on syncing:true
        // never syncs again.
        this.syncProcess = null
        this.localCachingResource = null
        await this.setData({ syncing: false })
        this.syncing = false
        await this.init()
        await this.clearContinuation()
        return this.sync(strategy, true)
      }

      console.error('Syncing failed with', message)
      Logger.log('Syncing failed with', message)

      if (this.server.onSyncFail) {
        try {
          await this.server.onSyncFail()
        } catch (e) {
          console.log(e)
          Logger.log('onSyncFail failed with ', e)
        }
      }

      const keepsContinuation = !matchAllErrors(e, e => ![
        new InterruptedSyncError().code,
        new NetworkError().code,
        // Don't throw away cache and mappings over a folder that may well come
        // back -- and init() would only throw this same error again anyway.
        new LocalFolderNotFoundError().code,
        new ServersideAdditionFailsafeError(0).code,
        new ServersideDeletionFailsafeError(0).code,
        new ClientsideAdditionFailsafeError(0).code,
        new ClientsideDeletionFailsafeError(0).code,
      ].includes(e.code) && (!isTest || e.code !== 26))

      if (keepsContinuation) {
        await this.persistFinalProgress()
      }

      this.syncing = false

      const isTransient = matchAllErrors(
        e,
        (e) => e.list || !(e instanceof FloccusError) || e instanceof TransientError
      )

      await this.setData({
        error: message,
        isTransientError: isTransient,
        errorCount: this.getData().errorCount + 1,
        syncing: false,
        scheduled: false,
      })
      if (!keepsContinuation) {
        await this.clearContinuation()
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

  /**
   * Drop the stored continuation, under the same lock the persists in
   * progressCallback take.
   *
   * The throttled progress callback is fire-and-forget, and it checks `syncing`
   * before it writes rather than after, so one of its writes can still be in
   * flight by the time we get here. Were the clear to go unlocked, that write
   * could land after it and leave a finished sync's continuation behind, for
   * the next sync to resume and execute its actions a second time.
   */
  private async clearContinuation(): Promise<void> {
    await continuationLock.acquire(this.id, async() => {
      await this.storage.setCurrentContinuation(null)
    })
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
      await this.persistProgress()
    }
  }

  /**
   * Persist where a failed sync got to, for the next one to resume from.
   *
   * The ticks that persist the progress otherwise are throttled (up to 10s
   * apart, see progressInterval) and the last one is dropped with the failure,
   * yet the sync goes on executing actions in between -- and the executors
   * even wait for a mutation that was in flight when it failed (see
   * SyncProcess#raceWithCancellation). Unless the continuation catches up with
   * those, the resumed sync finds them still in its plan and executes them a
   * second time, which on a non-atomic server means duplicates.
   *
   * Only for non-atomic servers: an atomic one hasn't taken any of this run's
   * changes, so there is no continuation to resume, and the cache and mappings
   * the ticks keep for it are as far as they should go.
   */
  private async persistFinalProgress(): Promise<void> {
    if (!this.syncProcess || !this.server || this.server.isAtomic()) {
      return
    }
    if (!this.syncProcess.getActionsDone()) {
      // Nothing executed since the sync started (or resumed): the stored
      // continuation, if any, is still accurate
      return
    }
    try {
      Logger.log('Persisting the progress of the failed sync')
      await this.persistProgress()
    } catch (e) {
      // Don't let this mask the error the sync failed with
      Logger.log('Could not persist the progress of the failed sync', e)
    }
  }

  /** Persist cache, continuation and mappings as they are now */
  private async persistProgress(): Promise<void> {
    const mappings = this.syncProcess.getMappingsInstance()
    if (!this.localCachingResource) {
      return
    }
    // Persist the cache incrementally in *both* the atomic and non-atomic cases.
    // Previously the cache was only persisted here for atomic adapters; for non-atomic
    // adapters it was written only on successful sync completion (see sync()). During a long
    // run of interrupted (never-completed) syncs that left the stored cache stale, so the next
    // fresh sync re-saw already-synced items as new creations and re-created them on the
    // non-atomic server — accumulating duplicate folders whose mappings then collided
    // (MappingFailureError -> reset+forceSync -> divergence). Mappings are already persisted at
    // the interrupt point; the cache must be kept in step with them.
    // Nothing has touched the cache since we last wrote it, so there is
    // nothing to hand to the store. Plenty of a sync (loading, diffing,
    // reconciling, and every action that only concerns the server) changes no
    // local item at all.
    if (this.localCachingResource.isCacheDirty()) {
      Logger.log('persistProgress: Persisting cache')
      // Read before storing: a change landing while the write is in flight
      // has to leave the cache dirty for the next tick
      const revision = this.localCachingResource.getCacheRevision()
      // What this costs is what the sync has changed since the last tick --
      // the cache used to be serialized and written whole here, which for a
      // large account was megabytes of JSON several times a minute (see
      // ICacheStore).
      await this.localCachingResource.saveCache((bm) => this.server.acceptsBookmark(bm))
      this.localCachingResource.markCachePersisted(revision)
    } else {
      Logger.log('persistProgress: Cache unchanged since the last tick, not persisting')
    }
    if (!this.server.isAtomic()) {
      // An update only carries what has changed since the last persist, so
      // two of them must not be built and written in parallel -- the sync
      // interrupt persists un-throttled while a throttled persist may still
      // be in flight, and an older update landing last would put the actions
      // executed in between back into their plan, to be executed twice by the
      // sync that resumes from it.
      await continuationLock.acquire(this.id, async() => {
        Logger.log('persistProgress: Serializing continuation')
        // Only what has changed since the last persist -- during execution that
        // is the handful of actions that have moved from their plan to the done
        // plan, rather than the whole sync plan, which is most of this account's
        // bookmarks and used to be serialized here on every single tick.
        const incremental = await this.storage.canPersistContinuationIncrementally()
        const update = await this.syncProcess.toContinuationUpdateAsync({ full: !incremental })
        if (!this.syncing) {
          return
        }
        if (!this.syncProcess) {
          return
        }
        Logger.log('persistProgress: Persisting continuation')
        try {
          await this.storage.updateCurrentContinuation(update)
          // Only now that the write has gone through: anything that isn't
          // acknowledged here is simply written again with the next update
          this.syncProcess.markContinuationPersisted(update)
        } catch (e) {
          // Letting this through takes the rest of the tick with it -- the
          // mappings below included, which would then fall out of step with
          // the cache that was just persisted, the very divergence that
          // persisting the cache here exists to prevent. The update isn't
          // acknowledged, so the next tick offers it again -- by which time
          // the storage has had its chance to fall back to one that works.
          Logger.log('persistProgress: Could not persist continuation', e)
        }
      })
    }
    Logger.log('persistProgress: Persisting mappings')
    await mappings.persist()
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
