import {
  Bookmark,
  Folder,
  TItem,
  ItemType,
  ItemLocation,
  TItemLocation,
  TOppositeLocation,
} from '../Tree'
import Logger from '../Logger'
import Diff, {
  Action,
  ActionType,
  CreateAction,
  MoveAction,
  PlanStage1, PlanStage2, PlanStage3,
  RemoveAction,
  ReorderAction,
  UpdateAction
} from '../Diff'
import Scanner, { ScanResult } from '../Scanner'
import * as Parallel from 'async-parallel'
import throttle, { CanceledError } from '@jcoreio/async-throttle'
import type { ThrottledFunction } from '@jcoreio/async-throttle'
import Mappings, { MappingSnapshot } from '../Mappings'
import TResource, { IHashSettings, OrderFolderResource, TLocalTree } from '../interfaces/Resource'
import { TAdapter } from '../interfaces/Adapter'
import {
  CancelledSyncError, ClientsideAdditionFailsafeError,
  ClientsideDeletionFailsafeError, ServersideAdditionFailsafeError,
  ServersideDeletionFailsafeError
} from '../../errors/Error'

import NextcloudBookmarksAdapter from '../adapters/NextcloudBookmarks'
import CachingAdapter from '../adapters/Caching'
import { yieldToEventLoop } from '../yieldToEventLoop'

export const ACTION_CONCURRENCY = 5

export default class SyncProcess {
  protected mappings: Mappings
  protected localTree: TLocalTree
  protected server: TAdapter
  protected cacheTreeRoot: Folder<typeof ItemLocation.LOCAL>|null
  protected canceled: boolean
  protected throttledProgressCb: ThrottledFunction<[progress: number, actionsDone: number | undefined], void>

  // Stage -1
  protected localTreeRoot: Folder<typeof ItemLocation.LOCAL> = null
  protected serverTreeRoot: Folder<typeof ItemLocation.SERVER> = null

  // Stage 0
  protected localScanResult: ScanResult<typeof ItemLocation.LOCAL, TItemLocation> = null
  protected serverScanResult: ScanResult<typeof ItemLocation.SERVER, TItemLocation> = null

  // Stage 1
  private localPlanStage1: PlanStage1<typeof ItemLocation.SERVER, TItemLocation> = null
  private serverPlanStage1: PlanStage1<typeof ItemLocation.LOCAL, TItemLocation> = null

  // Stage 2
  private localPlanStage2: PlanStage2<typeof ItemLocation.SERVER, TItemLocation, typeof ItemLocation.LOCAL> = null
  private serverPlanStage2: PlanStage2<typeof ItemLocation.LOCAL, TItemLocation, typeof ItemLocation.SERVER>

  // Stage 3
  private planStage3Local: PlanStage3<typeof ItemLocation.SERVER, TItemLocation, typeof ItemLocation.LOCAL> = null
  private planStage3Server: PlanStage3<typeof ItemLocation.LOCAL, TItemLocation, typeof ItemLocation.SERVER> = null
  private localDonePlan: PlanStage3<typeof ItemLocation.SERVER, TItemLocation, typeof ItemLocation.LOCAL> = null
  private serverDonePlan: PlanStage3<typeof ItemLocation.LOCAL, TItemLocation, typeof ItemLocation.SERVER> = null
  private prelimLocalReorders: Diff<typeof ItemLocation.SERVER, TItemLocation, ReorderAction<typeof ItemLocation.SERVER, TItemLocation>> = null
  private prelimServerReorders: Diff<typeof ItemLocation.LOCAL, TItemLocation, ReorderAction<typeof ItemLocation.LOCAL, TItemLocation>> = null

  // Stage 4
  private localReorders: Diff<typeof ItemLocation.LOCAL, TItemLocation, ReorderAction<typeof ItemLocation.LOCAL, TItemLocation>> = null
  private serverReorders: Diff<typeof ItemLocation.SERVER, TItemLocation, ReorderAction<typeof ItemLocation.SERVER, TItemLocation>> = null

  protected actionsDone = 0
  protected actionsPlanned = 0

  protected isFirefox: boolean

  protected staticContinuation: any = null

  // The location that has precedence in case of conflicts
  protected masterLocation: TItemLocation
  protected hashSettings: IHashSettings

  protected cancelPromise: Promise<void>
  protected cancelCb: (error: any) => void

  // We're counting the number of calls to addMappings so we can conditionally yieldToEventLoop every 1000th call
  protected mappingIterations = 0
  protected executeIterations = 0

  constructor(
    mappings:Mappings,
    localTree:TLocalTree,
    server:TAdapter,
    progressCb:(progress:number, actionsDone?:number)=>Promise<void>
  ) {
    this.mappings = mappings
    this.localTree = localTree
    this.server = server

    this.throttledProgressCb = throttle(progressCb, 1500)
    this.cancelPromise = new Promise<void>((resolve, reject) => {
      this.cancelCb = reject
    })
    this.canceled = false
    this.isFirefox = self.location.protocol === 'moz-extension:'
  }

  getMembersToPersist() {
    const members = []
    // Stage 0
    if (
      (!this.serverPlanStage1 || !this.localPlanStage1) &&
        (!this.serverPlanStage2 || !this.localPlanStage2) &&
        (!this.planStage3Local || !this.planStage3Server) &&
          this.actionsPlanned === 0
    ) {
      members.push('localScanResult')
      members.push('serverScanResult')
    }

    // Stage 1
    if (
      (!this.serverPlanStage2 || !this.localPlanStage2) &&
      (!this.planStage3Local || !this.planStage3Server) && this.actionsPlanned === 0
    ) {
      members.push('localPlanStage1')
      members.push('serverPlanStage1')
    }

    // Stage 2
    if ((!this.planStage3Local || !this.planStage3Server) && this.actionsPlanned === 0) {
      members.push('localPlanStage2')
      members.push('serverPlanStage2')
    }

    // Stage 3
    if (this.actionsDone < this.actionsPlanned) {
      members.push('planStage3Local')
      members.push('planStage3Server')
      members.push('localDonePlan')
      members.push('serverDonePlan')
      members.push('prelimLocalReorders')
      members.push('prelimServerReorders')
    }

    // Stage 4
    members.push('localReorders')
    members.push('serverReorders')

    return members
  }

  getMappingsInstance(): Mappings {
    return this.mappings
  }

  setCacheTree(cacheTree: Folder<typeof ItemLocation.LOCAL>) {
    this.cacheTreeRoot = cacheTree
  }

  getCacheTree(): Folder<typeof ItemLocation.LOCAL> {
    return this.cacheTreeRoot
  }

  public getTargetTree<L1 extends TItemLocation>(targetLocation: L1): Folder<L1> {
    return (targetLocation === ItemLocation.SERVER ? this.serverTreeRoot : this.localTreeRoot) as Folder<L1>
  }

  async cancel() :Promise<void> {
    this.canceled = true
    this.cancelCb(new CancelledSyncError())
    this.server.cancel()
    this.localTree.cancel()
    this.throttledProgressCb.cancel()
  }

  async updateProgress():Promise<void> {
    if (typeof this.actionsDone === 'undefined' || this.actionsDone === null) {
      this.actionsDone = 0
    }
    this.actionsDone++
    this.throttledProgressCb(
      Math.min(
        1,
        0.5 + (this.actionsDone / (this.actionsPlanned + 1)) * 0.5
      ),
      this.actionsDone
    ).catch((er) => {
      if (er instanceof CanceledError) {
        return
      }
      throw er
    })
    Logger.log(`Executed ${this.actionsDone} actions from ${this.actionsPlanned} actions`)
  }

  async setProgress(json: any) {
    if (json.serverTreeRoot) {
      this.serverTreeRoot = Folder.hydrate(json.serverTreeRoot)
      delete json.serverTreeRoot
    }
    if (json.localTreeRoot) {
      this.localTreeRoot = Folder.hydrate(json.localTreeRoot)
      delete json.localTreeRoot
    }
    if (json.cacheTreeRoot) {
      this.cacheTreeRoot = Folder.hydrate(json.cacheTreeRoot)
      delete json.cacheTreeRoot
    }
    for (const member of Object.keys(json)) {
      if (member.toLowerCase().includes('scanresult') || member.toLowerCase().includes('plan')) {
        this[member] = {
          CREATE: await Diff.fromJSONAsync(json[member].CREATE),
          UPDATE: await Diff.fromJSONAsync(json[member].UPDATE),
          MOVE: await Diff.fromJSONAsync(json[member].MOVE),
          REMOVE: await Diff.fromJSONAsync(json[member].REMOVE),
          REORDER: await Diff.fromJSONAsync(json[member].REORDER),
        }
      } else if (member.toLowerCase().includes('reorders')) {
        this[member] = await Diff.fromJSONAsync(json[member])
      } else {
        this[member] = json[member]
      }
    }
  }

  setDirection(direction:TItemLocation):void {
    throw new Error('Unsupported method')
  }

  async sync(): Promise<void> {
    // onSyncStart is already executed at this point
    this.throttledProgressCb(0.15, 0).catch((er) => {
      if (er instanceof CanceledError) {
        return
      }
      throw er
    })

    this.masterLocation = ItemLocation.LOCAL
    await this.prepareSync()

    // trees are loaded at this point
    this.throttledProgressCb(0.35, 0).catch((er) => {
      if (er instanceof CanceledError) {
        return
      }
      throw er
    })

    if (this.canceled) {
      throw new CancelledSyncError()
    }

    Logger.log({localTreeRoot: this.localTreeRoot, serverTreeRoot: this.serverTreeRoot, cacheTreeRoot: this.cacheTreeRoot})

    if (!this.localScanResult && !this.serverScanResult && !this.localPlanStage1 && !this.serverPlanStage1 && !this.localPlanStage2 && !this.serverPlanStage2 && !this.planStage3Local && !this.planStage3Server) {
      const { localScanResult, serverScanResult } = await this.getDiffs()
      Logger.log({ localScanResult, serverScanResult })
      this.localScanResult = localScanResult
      this.serverScanResult = serverScanResult
      this.throttledProgressCb(0.45, 0).catch((er) => {
        if (er instanceof CanceledError) {
          return
        }
        throw er
      })
    }

    if (this.canceled) {
      throw new CancelledSyncError()
    }

    if (!this.serverPlanStage1 && !this.localPlanStage1 && !this.serverPlanStage2 && !this.localPlanStage2 && !this.planStage3Local && !this.planStage3Server) {
      this.serverPlanStage1 = await this.reconcileDiffs(this.localScanResult, this.serverScanResult, ItemLocation.SERVER)
      this.localPlanStage1 = await this.reconcileDiffs(this.serverScanResult, this.localScanResult, ItemLocation.LOCAL)
    }

    let mappingsSnapshot: MappingSnapshot

    if (!this.serverPlanStage2 && !this.localPlanStage2 && !this.planStage3Local && !this.planStage3Server) {
      // have to get snapshot after reconciliation, because of concurrent creation reconciliation
      mappingsSnapshot = this.mappings.getSnapshot()
      Logger.log('Mapping server plan')

      this.serverPlanStage2 = {
        CREATE: this.serverPlanStage1.CREATE.map(mappingsSnapshot, ItemLocation.SERVER),
        UPDATE: this.serverPlanStage1.UPDATE.map(mappingsSnapshot, ItemLocation.SERVER),
        MOVE: this.serverPlanStage1.MOVE,
        REMOVE: this.serverPlanStage1.REMOVE.map(mappingsSnapshot, ItemLocation.SERVER),
        REORDER: this.serverPlanStage1.REORDER,
      }

      Logger.log('Mapping local plan')

      this.localPlanStage2 = {
        CREATE: this.localPlanStage1.CREATE.map(mappingsSnapshot, ItemLocation.LOCAL),
        UPDATE: this.localPlanStage1.UPDATE.map(mappingsSnapshot, ItemLocation.LOCAL),
        MOVE: this.localPlanStage1.MOVE,
        REMOVE: this.localPlanStage1.REMOVE.map(mappingsSnapshot, ItemLocation.LOCAL),
        REORDER: this.localPlanStage1.REORDER,
      }
    }

    if (this.canceled) {
      throw new CancelledSyncError()
    }

    Logger.log({localPlan: this.localPlanStage2, serverPlan: this.serverPlanStage2})

    if (this.serverPlanStage2) {
      this.applyDeletionFailsafe(ItemLocation.SERVER, this.serverTreeRoot, this.serverPlanStage2.REMOVE)
      this.applyAdditionFailsafe(ItemLocation.SERVER, this.serverTreeRoot, this.serverPlanStage2.CREATE)
    }

    if (this.localPlanStage2) {
      this.applyDeletionFailsafe(ItemLocation.LOCAL, this.localTreeRoot, this.localPlanStage2.REMOVE)
      this.applyAdditionFailsafe(ItemLocation.LOCAL, this.localTreeRoot, this.localPlanStage2.CREATE)
    }

    if (!this.localDonePlan) {
      this.localDonePlan = {
        CREATE: new Diff(),
        UPDATE: new Diff(),
        MOVE: new Diff(),
        REMOVE: new Diff(),
        REORDER: new Diff(),
      }

      this.serverDonePlan = {
        CREATE: new Diff(),
        UPDATE: new Diff(),
        MOVE: new Diff(),
        REMOVE: new Diff(),
        REORDER: new Diff(),
      }
    }

    if (!this.prelimLocalReorders && this.localPlanStage2) {
      this.prelimLocalReorders = this.localPlanStage2.REORDER
      this.prelimServerReorders = this.serverPlanStage2.REORDER
    }

    if (!this.actionsPlanned) {
      this.actionsPlanned = Object.values(this.serverPlanStage2 || this.planStage3Server).reduce((acc, diff) => diff.getActions().length + acc, 0) +
        Object.values(this.localPlanStage2 || this.planStage3Local).reduce((acc, diff) => diff.getActions().length + acc, 0)
    }

    if (this.serverPlanStage2) {
      Logger.log('Executing server stage2 plan')
      await this.executeStage2(this.server, this.serverPlanStage2, ItemLocation.SERVER, this.serverDonePlan, this.prelimServerReorders)
    }

    if (!this.planStage3Server) {
      if (this.canceled) {
        throw new CancelledSyncError()
      }

      Logger.log('Mapping server MOVEs:')
      mappingsSnapshot = this.mappings.getSnapshot()
      this.planStage3Server = {
        CREATE: this.serverPlanStage2.CREATE,
        UPDATE: this.serverPlanStage2.UPDATE,
        MOVE: this.serverPlanStage2.MOVE.map(mappingsSnapshot, ItemLocation.SERVER),
        REMOVE: this.serverPlanStage2.REMOVE,
        REORDER: this.serverPlanStage2.REORDER,
      }

      if (this.canceled) {
        throw new CancelledSyncError()
      }
    }

    if (this.planStage3Server) {
      Logger.log('Executing server stage 3 plan')
      await this.executeStage3(this.server, this.planStage3Server, ItemLocation.SERVER, this.serverDonePlan)
    }

    if (this.canceled) {
      throw new CancelledSyncError()
    }

    if (this.localPlanStage2) {
      Logger.log('Executing local stage 2 plan')
      await this.executeStage2(this.localTree, this.localPlanStage2, ItemLocation.LOCAL, this.localDonePlan, this.prelimLocalReorders)
    }

    if (!this.planStage3Local) {
      if (this.canceled) {
        throw new CancelledSyncError()
      }

      Logger.log('Mapping local MOVEs:')
      mappingsSnapshot = this.mappings.getSnapshot()
      this.planStage3Local = {
        CREATE: this.localPlanStage2.CREATE,
        UPDATE: this.localPlanStage2.UPDATE,
        MOVE: this.localPlanStage2.MOVE.map(mappingsSnapshot, ItemLocation.LOCAL),
        REMOVE: this.localPlanStage2.REMOVE,
        REORDER: this.localPlanStage2.REORDER,
      }

      if (this.canceled) {
        throw new CancelledSyncError()
      }
    }

    if (this.planStage3Local) {
      Logger.log('Executing local stage 3 plan')
      await this.executeStage3(this.localTree, this.planStage3Local, ItemLocation.LOCAL, this.localDonePlan)
    }

    // Remove mappings only after both plans have been executed
    await Parallel.map(this.localDonePlan.REMOVE.getActions(), async(action) =>
      this.removeMapping(this.localTree, action.payload), 1)
    await Parallel.map(this.serverDonePlan.REMOVE.getActions(), async(action) =>
      this.removeMapping(this.server, action.payload), 1)

    if (this.canceled) {
      throw new CancelledSyncError()
    }

    if ('orderFolder' in this.server && !this.localReorders) {
      // mappings have been updated, reload
      mappingsSnapshot = this.mappings.getSnapshot()
      const localReorders1 = this.reconcileConcurrentReorderings(
        this.prelimLocalReorders,
        this.prelimServerReorders,
        ItemLocation.LOCAL,
        mappingsSnapshot
      )
      const serverReorders1 = this.reconcileConcurrentReorderings(
        this.prelimServerReorders,
        this.prelimLocalReorders,
        ItemLocation.SERVER,
        mappingsSnapshot
      )
      const localReorders2 = this.reconcileReorderings(
        localReorders1,
        this.localDonePlan,
        ItemLocation.LOCAL,
        mappingsSnapshot
      )
      const serverReorders2 = this.reconcileReorderings(
        serverReorders1,
        this.serverDonePlan,
        ItemLocation.SERVER,
        mappingsSnapshot
      )
      this.localReorders = localReorders2.map(
        mappingsSnapshot,
        ItemLocation.LOCAL
      )
      this.serverReorders = serverReorders2.map(
        mappingsSnapshot,
        ItemLocation.SERVER
      )
    }

    if (this.canceled) {
      throw new CancelledSyncError()
    }

    if ('orderFolder' in this.server) {
      Logger.log('Executing reorderings')
      await Promise.all([
        this.executeReorderings(this.server, this.serverReorders),
        this.executeReorderings(this.localTree, this.localReorders),
      ])
    }

    this.throttledProgressCb.cancel()
  }

  protected async prepareSync() {
    if (!this.localTree) {
      throw new Error('localTree is not initialized. Cannot prepare sync.')
    }
    if (!this.server) {
      throw new Error('server is not initialized. Cannot prepare sync.')
    }

    // Negotiate capabilities
    const localCapabilities = await this.localTree.getCapabilities()
    const serverCapabilities = await this.server.getCapabilities()
    this.hashSettings = {
      preserveOrder: localCapabilities.preserveOrder && serverCapabilities.preserveOrder,
      // Find the first hFn that localTree supports as well, ie order matters
      hashFn: serverCapabilities.hashFn.find(hashFn => localCapabilities.hashFn.includes(hashFn)),
    }
    Logger.log(`using the following HashSettings: ${JSON.stringify(this.hashSettings)}`)
    this.localTree.setHashSettings(this.hashSettings)
    this.server.setHashSettings(this.hashSettings)

    if (!this.localTreeRoot || typeof this.localTreeRoot.children === 'undefined') {
      Logger.log('Retrieving local tree')
      const localTreeRoot = await this.localTree.getBookmarksTree()
      Logger.log('Filtering out unaccepted local bookmarks')
      this.filterOutUnacceptedBookmarks(localTreeRoot)
      if (this.server instanceof NextcloudBookmarksAdapter) {
        Logger.log('Filtering out duplicate bookmarks')
        await this.filterOutDuplicatesInTheSameFolder(localTreeRoot)
      }
      this.localTreeRoot = localTreeRoot
    }

    // Cache tree might not have been initialized and thus have no id
    this.cacheTreeRoot.id = this.localTreeRoot.id

    if (this.canceled) {
      throw new CancelledSyncError()
    }

    if (!this.serverTreeRoot) {
      Logger.log('Retrieving server tree')
      const serverTreeRoot = await this.server.getBookmarksTree()
      Logger.log('Filtering out invalid server bookmarks')
      this.filterOutInvalidBookmarks(serverTreeRoot)

      if (this.canceled) {
        throw new CancelledSyncError()
      }

      await this.mappings.addFolder({ localId: this.localTreeRoot.id, remoteId: serverTreeRoot.id })
      const mappingsSnapshot = this.mappings.getSnapshot()

      if ('loadFolderChildren' in this.server) {
        Logger.log('Loading sparse tree as necessary')
        // Load sparse tree
        await this.loadChildren(serverTreeRoot, mappingsSnapshot, true)
      }
      this.serverTreeRoot = serverTreeRoot
    }

    // generate hash tables to find items faster
    Logger.log('Generating indices for local tree')
    this.localTreeRoot.createIndex()
    Logger.log('Generating indices for cache tree')
    this.cacheTreeRoot.createIndex()
    Logger.log('Generating indices for server tree')
    this.serverTreeRoot.createIndex()
  }

  protected applyDeletionFailsafe(direction: TItemLocation, tree: Folder<TItemLocation>, removals: Diff<TItemLocation, TItemLocation, RemoveAction<TItemLocation, TItemLocation>>) {
    const countTotal = tree.count()
    const countDeleted = removals.getActions().reduce((count, action) => count + action.payload.count(), 0)

    Logger.log('Checking deletion failsafe: ' + countDeleted + '/' + countTotal + '=' + (countDeleted / countTotal))
    // Failsafe kicks in if more than 20% is deleted or more than 1k bookmarks
    if ((countTotal > 5 && countDeleted / countTotal > 0.2) || countDeleted > 1000) {
      const failsafe = this.server.getData().failsafe
      if (
        failsafe !== false ||
        typeof failsafe === 'undefined' ||
        failsafe === null
      ) {
        const percentage = Math.ceil((countDeleted / countTotal) * 100)
        if (direction === ItemLocation.LOCAL) {
          throw new ClientsideDeletionFailsafeError(percentage)
        } else {
          throw new ServersideDeletionFailsafeError(percentage)
        }
      }
    }
  }

  protected applyAdditionFailsafe(direction: TItemLocation, tree: Folder<TItemLocation>, creations: Diff<TItemLocation, TItemLocation, CreateAction<TItemLocation, TItemLocation>>) {
    const countTotal = tree.count()
    const countAdded = creations.getActions().reduce((count, action) => count + action.payload.count(), 0)

    Logger.log('Checking addition failsafe: ' + countAdded + '/' + countTotal + '=' + (countAdded / countTotal))
    // Failsafe kicks in if more than 20% is added or more than 1k bookmarks
    if (countTotal > 5 && ((countAdded >= 20 && countAdded / countTotal > 0.2) || countAdded > 1000)) {
      const failsafe = this.server.getData().failsafe
      if (failsafe !== false || typeof failsafe === 'undefined' || failsafe === null) {
        const percentage = Math.ceil((countAdded / countTotal) * 100)
        if (direction === ItemLocation.LOCAL) {
          throw new ClientsideAdditionFailsafeError(percentage)
        } else {
          throw new ServersideAdditionFailsafeError(percentage)
        }
      }
    }
  }

  filterOutUnacceptedBookmarks(tree: Folder<TItemLocation>): void {
    tree.children = tree.children.filter(child => {
      if (child instanceof Bookmark) {
        return this.server.acceptsBookmark(child)
      } else {
        this.filterOutUnacceptedBookmarks(child)
        return true
      }
    })
  }

  filterOutInvalidBookmarks(tree: Folder<TItemLocation>): void {
    const invalidBookmarks = []
    tree.children = tree.children.filter(child => {
      if (child instanceof Bookmark) {
        // Chrome URLs cannot be added in firefox
        if (this.isFirefox && child.url.startsWith('chrome')) {
          invalidBookmarks.push(child)
          return false
        }
        // Moz-extension URLs cannot be added in chrome
        if (!this.isFirefox && child.url.startsWith('moz-')) {
          invalidBookmarks.push(child)
          return false
        }
        // Linkwarden supports bookmarks that have no URL eg. for directly uploaded files
        if (child.url === null) {
          invalidBookmarks.push(child)
          return false
        }
      } else {
        this.filterOutInvalidBookmarks(child)
      }
      return true
    })
    invalidBookmarks.length &&
    Logger.log(
      'Filtered out the following invalid bookmarks before syncing',
      invalidBookmarks
    )
  }

  async filterOutDuplicatesInTheSameFolder(tree: Folder<TItemLocation>): Promise<void> {
    const seenUrl = {}
    const duplicates = []
    tree.children = tree.children.filter(child => {
      if (child.type === ItemType.BOOKMARK) {
        if (seenUrl[child.url]) {
          duplicates.push(child)
          return false
        }
        seenUrl[child.url] = child
      } else {
        this.filterOutDuplicatesInTheSameFolder(child)
      }
      return true
    })
    duplicates.length &&
      Logger.log(
        'Filtered out the following duplicates before syncing',
        duplicates
      )
  }

  async getDiffs():Promise<{localScanResult:ScanResult<typeof ItemLocation.LOCAL, TItemLocation>, serverScanResult:ScanResult<typeof ItemLocation.SERVER, TItemLocation>}> {
    const mappingsSnapshot = this.mappings.getSnapshot()

    const isUsingTabs = await this.localTree.isUsingBrowserTabs?.()

    // Since we have the cache available, Diff cache and both trees..
    const localScanner = new Scanner(
      this.mappings,
      this.cacheTreeRoot,
      this.localTreeRoot,
      (oldItem, newItem) => {
        if (oldItem.type !== newItem.type) {
          return false
        }

        // If a bookmark's URL has changed we want to recreate it instead of updating it, because of Nextcloud Bookmarks' uniqueness constraints
        if (oldItem.type === 'bookmark' && newItem.type === 'bookmark' && oldItem.url !== newItem.url) {
          return false
        }

        // The two are mappable, no-brainer...
        if (Mappings.mappable(mappingsSnapshot, oldItem, newItem)) {
          return true
        }

        // We also allow canMergeWith for folders here, if we're dealing with tabs, because Window IDs are not stable
        if (isUsingTabs && oldItem.type === 'folder' && oldItem.canMergeWith(newItem)) {
          return true
        }
        return false
      },
      this.hashSettings,
      true,
      false,
    )
    const serverScanner = new Scanner(
      this.mappings,
      this.cacheTreeRoot,
      this.serverTreeRoot,
      (oldItem, newItem) => {
        if (oldItem.type !== newItem.type) {
          return false
        }
        // If a bookmark's URL has changed we want to recreate it instead of updating it, because of Nextcloud Bookmarks' uniqueness constraints
        if (oldItem.type === 'bookmark' && newItem.type === 'bookmark' && oldItem.url !== newItem.url) {
          return false
        }

        // The two are mappable, no-brainer...
        if (Mappings.mappable(mappingsSnapshot, oldItem, newItem)) {
          return true
        }

        //  We also allow canMergeWith here for bookmarks, because e.g. for NextcloudFolders the id of moved bookmarks changes (because their id is "<bookmarkID>;<folderId>")
        if (oldItem.type === 'bookmark' && newItem.type === 'bookmark' && oldItem.canMergeWith(newItem)) {
          return true
        }

        // We also allow canMergeWith here for folders, if we're dealing with tabs, because Window IDs are not stable
        if (isUsingTabs && oldItem.type === 'folder' && newItem.type === 'folder' && oldItem.canMergeWith(newItem)) {
          return true
        }

        return false
      },
      this.hashSettings,
      true,
      true,
    )
    Logger.log('Calculating diffs for local and server trees relative to cache tree')
    const localScanResult = await localScanner.run()
    const serverScanResult = await serverScanner.run()
    return {localScanResult, serverScanResult}
  }

  // Note: Parts of this are duplicated to MergeSyncProcess!
  async reconcileDiffs<L1 extends TItemLocation, L2 extends TItemLocation, L3 extends TItemLocation>(
    sourceScanResult:ScanResult<L1, L2>,
    targetScanResult:ScanResult<TOppositeLocation<L1>, L3>,
    targetLocation: TOppositeLocation<L1>
  ): Promise<PlanStage1<L1, L2>> {
    Logger.log('Reconciling diffs to prepare a plan for ' + targetLocation)
    const mappingsSnapshot = this.mappings.getSnapshot()

    const targetCreations = targetScanResult.CREATE.getActions()
    const targetRemovals = targetScanResult.REMOVE.getActions()
    const targetMoves = targetScanResult.MOVE.getActions()
    const targetUpdates = targetScanResult.UPDATE.getActions()

    const sourceCreations = sourceScanResult.CREATE.getActions()
    const sourceRemovals = sourceScanResult.REMOVE.getActions()
    const sourceMoves = sourceScanResult.MOVE.getActions()

    const targetTree : Folder<TOppositeLocation<L1>> = (targetLocation === ItemLocation.LOCAL ? this.localTreeRoot : this.serverTreeRoot) as Folder<TOppositeLocation<L1>>
    const sourceTree : Folder<L1> = (targetLocation === ItemLocation.LOCAL ? this.serverTreeRoot : this.localTreeRoot) as Folder<L1>

    const allCreateAndMoveActions = (sourceScanResult.CREATE.getActions() as Array<CreateAction<L1, L2> | MoveAction<L1, L2> | CreateAction<TOppositeLocation<L1>, L3> | MoveAction<TOppositeLocation<L1>, L3>>)
      .concat(sourceScanResult.MOVE.getActions())
      .concat(targetScanResult.CREATE.getActions())
      .concat(targetScanResult.MOVE.getActions())

    const avoidTargetReorders = {}

    // Prepare target plan
    const targetPlan: PlanStage1<L1, L2> = {
      CREATE: new Diff(),
      UPDATE: new Diff(),
      MOVE: new Diff(),
      REMOVE: new Diff(),
      REORDER: new Diff(),
    }

    const findChainCacheForRemovals = {}
    await Parallel.each(sourceScanResult.REMOVE.getActions(), async(action) => {
      const concurrentRemoval = targetRemovals.find(targetRemoval =>
        (action.payload.type === targetRemoval.payload.type && Mappings.mappable(mappingsSnapshot, action.payload, targetRemoval.payload)) ||
        Diff.findChain(mappingsSnapshot, allCreateAndMoveActions, targetTree, action.payload, targetRemoval, findChainCacheForRemovals))
      if (concurrentRemoval) {
        // Already deleted on target, do nothing.
        return
      }

      const concurrentMove = targetMoves.find(targetMove =>
        action.payload.type === targetMove.payload.type && Mappings.mappable(mappingsSnapshot, action.payload, targetMove.payload)
      )
      if (concurrentMove && targetLocation === this.masterLocation) {
        // moved on the target, moves from master take precedence, do nothing (i.e. leave target version intact)
        return
      }

      targetPlan.REMOVE.commit(action)
    }, ACTION_CONCURRENCY)

    const findChainCacheForCreations = {}
    await Parallel.each(sourceScanResult.CREATE.getActions(), async(action) => {
      const concurrentCreation = targetCreations.find(a => (
        action.payload.parentId === Mappings.mapParentId(mappingsSnapshot, a.payload, action.payload.location) &&
        action.payload.canMergeWith(a.payload)
      ))
      if (concurrentCreation) {
        // created on both the target and sourcely, try to reconcile
        const subScanner = new Scanner(
          this.mappings,
          concurrentCreation.payload, // target tree
          action.payload, // source tree
          (oldItem, newItem) => {
            if (
              oldItem.type === newItem.type &&
              oldItem.canMergeWith(newItem)
            ) {
              return true
            }
            return false
          },
          this.hashSettings,
          false,
          true,
          true,
        )
        const scanResult = await subScanner.run()
        await this.addMapping(
          action.payload.location === ItemLocation.LOCAL
            ? this.localTree
            : this.server,
          concurrentCreation.payload,
          action.payload.id
        )

        // SubScanner may reveal residual CREATE/REMOVE actions that we add to the plan here
        // We do not act on REMOVEs, only on CREATEs as we merge the two sides
        scanResult.CREATE.getActions().forEach(action =>
          targetPlan.CREATE.commit({type: action.type, payload: action.payload})
        )
        return
      }

      const concurrentRemoval = targetScanResult.REMOVE.getActions().find(targetRemoval =>
        // target removal removed this creation's target (via some chain)
        Diff.findChain(mappingsSnapshot, allCreateAndMoveActions, sourceTree, action.payload, targetRemoval, findChainCacheForCreations)
      )
      if (concurrentRemoval) {
        avoidTargetReorders[action.payload.parentId] = true
        // Already deleted on target, do nothing.
        return
      }

      targetPlan.CREATE.commit(action)
    }, ACTION_CONCURRENCY)

    await Parallel.each(sourceScanResult.MOVE.getActions(), async(action) => {
      if (targetLocation === this.masterLocation) {
        const concurrentMove = targetMoves.find(a =>
          action.payload.type === a.payload.type && Mappings.mappable(mappingsSnapshot, action.payload, a.payload))
        if (concurrentMove) {
          // Moved both on target and sourcely, master has precedence: do nothing on master
          return
        }
      }
      let findChainCache = {}
      // FInd out if there's a removal in the target diff which already deletes this item (via some chain of MOVE|CREATEs)
      const complexTargetTargetRemoval = targetRemovals.find(targetRemoval => {
        return Diff.findChain(mappingsSnapshot, allCreateAndMoveActions, sourceTree, action.payload, targetRemoval, findChainCache)
      })
      findChainCache = {}
      const concurrentTargetOriginRemoval = targetRemovals.find(targetRemoval =>
        (action.payload.type === targetRemoval.payload.type && Mappings.mappable(mappingsSnapshot, action.payload, targetRemoval.payload)) ||
        Diff.findChain(mappingsSnapshot, allCreateAndMoveActions, sourceTree, action.oldItem, targetRemoval, findChainCache)
      )
      findChainCache = {}
      const concurrentSourceOriginRemoval = sourceRemovals.find(sourceRemoval => {
        return Diff.findChain(mappingsSnapshot, allCreateAndMoveActions, targetTree, action.oldItem, sourceRemoval, findChainCache)
      })
      findChainCache = {}
      const concurrentSourceTargetRemoval = sourceRemovals.find(sourceRemoval =>
        // We pass an empty folder here, because we don't want direct deletions of the moved folder's parent to count, as it's moved away anyway
        Diff.findChain(mappingsSnapshot, allCreateAndMoveActions, new Folder({id: 0, location: targetLocation}), action.payload, sourceRemoval, findChainCache)
      )
      if (complexTargetTargetRemoval) {
        // target already deleted by a target|source REMOVE (connected via source MOVE|CREATEs)
        if (!concurrentTargetOriginRemoval && !concurrentSourceOriginRemoval) {
          // make sure this item is not already being removed, when it's no longer moved
          // if (targetLocation === this.masterLocation) {
          targetPlan.REMOVE.commit({ type: ActionType.REMOVE, payload: action.oldItem, oldItem: null })
          SyncProcess.removeItemFromReorders(mappingsSnapshot, sourceScanResult.REORDER, action.oldItem)
          avoidTargetReorders[action.payload.id] = true
          // }
        }
        return
      }
      if (concurrentSourceTargetRemoval) {
        // target already deleted by a source REMOVE (connected via source MOVE|CREATEs)
        if (targetLocation !== this.masterLocation) {
          targetPlan.REMOVE.commit({ type: ActionType.REMOVE, payload: action.oldItem, oldItem: null })
        }
        SyncProcess.removeItemFromReorders(mappingsSnapshot, sourceScanResult.REORDER, action.oldItem)
        avoidTargetReorders[action.payload.id] = true
        return
      }
      if (concurrentTargetOriginRemoval) {
        // moved sourcely but removed on the target, recreate it on the target
        if (targetLocation !== this.masterLocation) {
          // only when coming from master do we recreate
          const originalCreation = sourceCreations.find(creation => creation.payload.findItem(ItemType.FOLDER, action.payload.parentId))

          // Remove subitems that have been (re)moved already by other actions
          const newPayload = action.payload.copy()
          if (newPayload.type === ItemType.FOLDER) {
            newPayload.traverse((item, folder) => {
              const removed = sourceRemovals.find(a => Mappings.mappable(mappingsSnapshot, item, a.payload))
              const movedAway = sourceMoves.find(a => Mappings.mappable(mappingsSnapshot, item, a.payload))
              if (removed || (movedAway && Mappings.mapParentId(mappingsSnapshot, movedAway.payload, item.location) !== item.parentId)) {
                folder.children.splice(folder.children.indexOf(item), 1)
              }
            })
          }

          if (originalCreation && originalCreation.payload.type === ItemType.FOLDER) {
            // in case the new parent is already a newly created item, merge it into that creation
            const folder = originalCreation.payload.findFolder(action.payload.parentId)
            folder.children.splice(action.index, 0, newPayload)
          } else {
            targetPlan.CREATE.commit({ type: ActionType.CREATE, oldItem: null, payload: newPayload })
          }
        }
        return
      }
      let findChainCache1 = {}, findChainCache2 = {}
      // Find concurrent moves that form a hierarchy reversal together with this one
      const concurrentHierarchyReversals = targetMoves.filter(targetMove => {
        return Diff.findChain(mappingsSnapshot, allCreateAndMoveActions, sourceTree, action.payload, targetMove, findChainCache1) &&
          Diff.findChain(mappingsSnapshot, allCreateAndMoveActions, targetTree, targetMove.payload, action, findChainCache2)
      })
      if (concurrentHierarchyReversals.length) {
        if (targetLocation !== this.masterLocation) {
          targetPlan.MOVE.commit(action)

          findChainCache1 = {}
          findChainCache2 = {}
          concurrentHierarchyReversals.forEach(a => {
            // moved sourcely but moved in reverse hierarchical order on target
            const payload = a.oldItem.copyWithLocation(false, action.payload.location)
            const oldItem = a.payload.copyWithLocation(false, action.oldItem.location)
            oldItem.id = Mappings.mapId(mappingsSnapshot, a.payload, action.oldItem.location)
            oldItem.parentId = Mappings.mapParentId(mappingsSnapshot, a.payload, action.oldItem.location)

            if (
              // Don't create duplicates!
              targetPlan.MOVE.getActions().find(move => String(move.payload.id) === String(payload.id)) ||
              sourceMoves.find(move => String(move.payload.id) === String(payload.id)) ||
              // Don't move back into removed territory
              targetRemovals.find(remove => Diff.findChain(mappingsSnapshot, allCreateAndMoveActions, sourceTree, action.payload, remove, findChainCache1)) ||
              sourceRemovals.find(remove => Diff.findChain(mappingsSnapshot, allCreateAndMoveActions, targetTree, action.payload, remove, findChainCache2))
            ) {
              return
            }

            // revert target move
            targetPlan.MOVE.commit({ ...a, payload, oldItem })
            SyncProcess.removeItemFromReorders(mappingsSnapshot, sourceScanResult.REORDER, payload)
            SyncProcess.removeItemFromReorders(mappingsSnapshot, sourceScanResult.REORDER, oldItem)
          })
        } else {
          SyncProcess.removeItemFromReorders(mappingsSnapshot, sourceScanResult.REORDER, action.oldItem)
          SyncProcess.removeItemFromReorders(mappingsSnapshot, sourceScanResult.REORDER, action.payload)
        }
        return
      }

      targetPlan.MOVE.commit(action)
    }, 1)

    await Parallel.each(sourceScanResult.UPDATE.getActions(), async(action) => {
      const concurrentUpdate = targetUpdates.find(a =>
        action.payload.type === a.payload.type && Mappings.mappable(mappingsSnapshot, action.payload, a.payload))
      if (concurrentUpdate && targetLocation === this.masterLocation) {
        // Updated both on target and sourcely, source has precedence: do nothing sourcely
        return
      }
      const concurrentRemoval = targetRemovals.find(a =>
        a.payload.findItem(action.payload.type, Mappings.mapId(mappingsSnapshot, action.payload, a.payload.location)) ||
        a.payload.findItem(ItemType.FOLDER, Mappings.mapParentId(mappingsSnapshot, action.payload, a.payload.location)))
      if (concurrentRemoval) {
        // Already deleted on target, do nothing.
        return
      }

      targetPlan.UPDATE.commit(action)
    }, ACTION_CONCURRENCY)

    await Parallel.each(sourceScanResult.REORDER.getActions(), async(action) => {
      if (avoidTargetReorders[action.payload.id]) {
        return
      }

      const findChainCache = {}
      const concurrentRemoval = targetRemovals.find(targetRemoval =>
        Diff.findChain(mappingsSnapshot, allCreateAndMoveActions, sourceTree, action.payload, targetRemoval, findChainCache)
      )
      if (concurrentRemoval) {
        // Already deleted on target, do nothing.
        return
      }

      targetPlan.REORDER.commit(action)
    }, ACTION_CONCURRENCY)

    return targetPlan
  }

  async executeStage2<L1 extends TItemLocation>(
    resource:TResource<L1>,
    planStage2:PlanStage2<TOppositeLocation<L1>, TItemLocation, L1>,
    targetLocation:L1,
    donePlan: PlanStage3<TOppositeLocation<L1>, TItemLocation, L1>,
    reorders: Diff<TOppositeLocation<L1>, TItemLocation, ReorderAction<TOppositeLocation<L1>, TItemLocation>>): Promise<void> {
    Logger.log('Executing ' + targetLocation + ' plan for ')

    let createActions = planStage2.CREATE.getActions()
    while (createActions.length > 0) {
      Logger.log(targetLocation + ': executing CREATEs')
      await Parallel.each(
        createActions,
        (action) => this.executeCreate(resource, action, targetLocation, planStage2.CREATE, reorders, donePlan),
        ACTION_CONCURRENCY
      )
      createActions = planStage2.CREATE.getActions()

      if (this.canceled) {
        throw new CancelledSyncError()
      }
    }

    Logger.log(targetLocation + ': executing UPDATEs')

    await Parallel.each(
      planStage2.UPDATE.getActions(),
      (action) => this.executeUpdate(resource, action, targetLocation, planStage2.UPDATE, donePlan),
      ACTION_CONCURRENCY
    )
  }

  async executeStage3<L1 extends TItemLocation>(
    resource:TResource<L1>,
    planStage3: PlanStage3<TOppositeLocation<L1>, TItemLocation, L1>,
    targetLocation: L1,
    donePlan: PlanStage3<TOppositeLocation<L1>, TItemLocation, L1>) {
    const batches = Diff.sortMoves(planStage3.MOVE.getActions(), this.getTargetTree(targetLocation))

    if (this.canceled) {
      throw new CancelledSyncError()
    }

    Logger.log(targetLocation + ': executing MOVEs')
    await Parallel.each(batches, batch => Parallel.each(batch, (action) => {
      return this.executeUpdate(resource, action, targetLocation, planStage3.MOVE, donePlan)
    }, ACTION_CONCURRENCY), 1)

    if (this.canceled) {
      throw new CancelledSyncError()
    }

    Logger.log(targetLocation + ': executing REMOVEs')
    await Parallel.each(planStage3.REMOVE.getActions(), (action) => {
      return this.executeRemove(resource, action, targetLocation, planStage3.REMOVE, donePlan)
    }, ACTION_CONCURRENCY)
  }

  async executeCreate<L1 extends TItemLocation>(
    resource: TResource<L1>,
    action: CreateAction<L1, TOppositeLocation<L1>>,
    targetLocation: L1,
    diff: Diff<L1, TOppositeLocation<L1>, CreateAction<L1, TOppositeLocation<L1>>>,
    reorders: Diff<TOppositeLocation<L1>, TItemLocation, ReorderAction<TOppositeLocation<L1>, TItemLocation>>,
    donePlan: PlanStage3<TOppositeLocation<L1>, TItemLocation, L1>
  ): Promise<void> {
    // defer execution of actions to allow the this.canceled check below to work when cancelling in interrupt tests
    if (++this.executeIterations % 1000 === 0) {
      await yieldToEventLoop()
    }
    Logger.log('Executing action ', action)

    if (this.canceled) {
      throw new CancelledSyncError()
    }

    const done = async() => {
      diff.retract(action)
      donePlan.CREATE.commit(action)
      await this.updateProgress()
    }

    const id = await Promise.race([
      action.payload.visitCreate(resource),
      this.cancelPromise
    ])
    if (typeof id === 'undefined' || id === null) {
      // undefined means we couldn't create the item. we're ignoring it
      await done()
      return
    }

    action.payload = action.payload.copy()
    action.payload.id = id

    if (action.oldItem) {
      await this.addMapping(resource, action.oldItem, id)
    }

    if (action.payload instanceof Bookmark || action.oldItem instanceof Bookmark) {
      await done()
      return
    }

    if (action.payload.children.length === 0) {
      await done()
      return
    }

    // Now, Insert folder children

    // Fix for Unidirectional reverted REMOVEs, for all other strategies this should be a noop
    action.payload.children.forEach((item) => {
      item.parentId = id
    })
    // We *know* that oldItem exists here, because actions are mapped before being executed
    if ('bulkImportFolder' in resource) {
      if (action.payload.count() < 75 || this.server instanceof CachingAdapter) {
        Logger.log('Attempting full bulk import')
        try {
          // Try bulk import with sub folders
          const imported = await resource.bulkImportFolder(id, action.oldItem.copyWithLocation(false, action.payload.location)) as Folder<typeof targetLocation>
          await done()
          const subScanner = new Scanner(
            this.mappings,
            action.oldItem,
            imported,
            (oldItem, newItem) => {
              if (
                oldItem.type === newItem.type &&
                oldItem.canMergeWith(newItem)
              ) {
                return true
              }
              return false
            },
            this.hashSettings,
            false,
            true,
            true,
          )
          await subScanner.run()

          if ('orderFolder' in resource) {
            const mappingsSnapshot = this.mappings.getSnapshot()
            this.actionsPlanned++
            reorders.commit({
              type: ActionType.REORDER,
              oldItem: imported,
              payload: action.oldItem,
              // payload children's IDs are not mapped
              order: action.oldItem.children.map(i => ({ type: i.type, id: i.id }))
            })
            await action.oldItem.traverse((oldChildItem) => {
              if (oldChildItem instanceof Folder && oldChildItem.children.length > 1) {
                // Correct the order after bulk import. Usually we expect bulk import to do the order correctly
                // on its own, but Nextcloud Bookmarks pre v14.2.0 does not
                const payload = imported.findFolder(Mappings.mapId(mappingsSnapshot, oldChildItem, targetLocation))
                // Order created items after the fact, as they've been created concurrently
                this.actionsPlanned++
                reorders.commit({
                  type: ActionType.REORDER,
                  oldItem: payload,
                  payload: oldChildItem,
                  order: oldChildItem.children.map(i => ({ type: i.type, id: i.id }))
                })
              }
            })
          }
          return
        } catch (e) {
          Logger.log('Bulk import failed, continuing with normal creation', e)
        }
      } else {
        try {
          // Try bulk import without sub folders
          const tempItem = action.oldItem.copyWithLocation(false, action.payload.location)
          const bookmarks = tempItem.children.filter(child => child instanceof Bookmark)
          while (bookmarks.length > 0) {
            Logger.log('Attempting chunked bulk import')
            tempItem.children = bookmarks.splice(0, 70)
            const imported = await resource.bulkImportFolder(action.payload.id, tempItem)
            const subScanner = new Scanner(
              this.mappings,
              tempItem,
              imported,
              (oldItem, newItem) => {
                if (
                  oldItem.type === newItem.type &&
                  oldItem.canMergeWith(newItem)
                ) {
                  // if two items can be merged, we'll add mappings here directly
                  return true
                }
                return false
              },
              this.hashSettings,
              false,
              true,
              true,
            )
            await subScanner.run()
          }

          // create sub plan for the folders

          const mappingsSnapshot = this.mappings.getSnapshot()

          const folders = action.payload.children
            .filter(item => item instanceof Folder)
            .filter(item => item as Folder<L1>)

          folders
            .forEach((child) => {
              // Necessary for Unidirectional reverted REMOVEs
              const payload = child
              payload.parentId = Mappings.mapParentId(mappingsSnapshot, child, targetLocation)
              const oldItem = action.oldItem.findItem(child.type, child.id)
              const newAction = { type: ActionType.CREATE, payload, oldItem }
              this.actionsPlanned++
              diff.commit(newAction)
            })

          await done()

          if ('orderFolder' in resource) {
            // Order created items after the fact, as they've been created concurrently
            this.actionsPlanned++
            reorders.commit({
              type: ActionType.REORDER,
              oldItem: action.payload,
              payload: action.oldItem,
              // payload children's IDs are not mapped
              order: action.payload.children.map(i => ({ type: i.type, id: i.id }))
            })
          }
          return
        } catch (e) {
          Logger.log('Bulk import failed, continuing with normal creation', e)
        }
      }
    }

    // Create a sub plan and create each child individually (worst performance)
    const mappingsSnapshot = this.mappings.getSnapshot()
    action.payload.children
      .forEach((child) => {
        // Necessary for Unidirectional reverted REMOVEs
        child.parentId = Mappings.mapParentId(mappingsSnapshot, child, targetLocation)
        const oldItem = action.oldItem.findItem(child.type, child.id)
        const newAction = { type: ActionType.CREATE, payload: child, oldItem }
        this.actionsPlanned++
        diff.commit(newAction)
      })

    await done()

    if ('orderFolder' in resource) {
      // Order created items after the fact, as they've been created concurrently
      this.actionsPlanned++
      reorders.commit({
        type: ActionType.REORDER,
        oldItem: action.payload,
        payload: action.oldItem,
        order: action.oldItem.children.map(i => ({ type: i.type, id: i.id }))
      })
    }
  }

  async executeRemove<L1 extends TItemLocation>(
    resource: TResource<L1>,
    action: RemoveAction<L1, TItemLocation>,
    targetLocation: L1,
    diff: Diff<L1, TItemLocation, RemoveAction<L1, TItemLocation>>,
    donePlan: PlanStage3<TOppositeLocation<L1>, TItemLocation, L1>
  ): Promise<void> {
    // defer execution of actions to allow the this.canceled check below to work when cancelling in interrupt tests
    if (++this.executeIterations % 1000 === 0) {
      await yieldToEventLoop()
    }
    Logger.log('Executing action ', action)

    if (this.canceled) {
      throw new CancelledSyncError()
    }

    await Promise.race([
      action.payload.visitRemove(resource),
      this.cancelPromise,
    ])
    diff.retract(action)
    donePlan.REMOVE.commit(action)
    await this.updateProgress()
  }

  async executeUpdate<L1 extends TItemLocation>(
    resource: TResource<L1>,
    action: UpdateAction<L1, TItemLocation> | MoveAction<L1, TItemLocation>,
    targetLocation: L1,
    diff: Diff<L1, TItemLocation, UpdateAction<L1, TItemLocation> | MoveAction<L1, TItemLocation>>,
    donePlan: PlanStage3<TItemLocation, TItemLocation, L1>): Promise<void> {
    // defer execution of actions to allow the this.canceled check below to work when cancelling in interrupt tests
    if (++this.executeIterations % 1000 === 0) {
      await yieldToEventLoop()
    }
    Logger.log('Executing action ', action)

    if (this.canceled) {
      throw new CancelledSyncError()
    }

    await Promise.race([
      action.payload.visitUpdate(resource),
      this.cancelPromise,
    ])

    await this.addMapping(resource, action.oldItem, action.payload.id)
    diff.retract(action)
    if (action.type === ActionType.UPDATE) {
      donePlan.UPDATE.commit(action)
    } else {
      donePlan.MOVE.commit(action)
    }
    await this.updateProgress()
  }

  reconcileReorderings<L1 extends TItemLocation, L2 extends TItemLocation>(
    targetReorders: Diff<L2, TItemLocation, ReorderAction<L2, TItemLocation>>,
    targetOrSourceDonePlan: PlanStage3<TItemLocation, TItemLocation, TItemLocation>,
    targetLocation: L1,
    mappingSnapshot: MappingSnapshot
  ) : Diff<L2, TItemLocation, ReorderAction<L2, TItemLocation>> {
    Logger.log('Reconciling reorders to create a plan')

    const targetCreations = targetOrSourceDonePlan.CREATE.getActions()
    const targetRemovals = targetOrSourceDonePlan.REMOVE.getActions()
    const targetMoves = targetOrSourceDonePlan.MOVE.getActions()
    const targetCreationsAndMoves : Action<TItemLocation, TItemLocation>[] = (targetCreations as Action<TItemLocation, TItemLocation>[]).concat(targetMoves)
    const targetTree = targetLocation === ItemLocation.LOCAL ? this.localTreeRoot : this.serverTreeRoot

    const newReorders = new Diff<L2, TItemLocation, ReorderAction<L2, TItemLocation>>

    const findChainCache = {}

    targetReorders
      .getActions()
    // MOVEs have oldItem from cacheTree and payload now mapped to their corresponding target tree
    // REORDERs have payload in source tree
      .forEach(oldReorderAction => {
        // clone action
        const reorderAction = {...oldReorderAction, order: oldReorderAction.order.slice()}

        // Find removals of the main payload
        const removed = targetRemovals
          .filter(removal =>
            removal.payload.findItem(reorderAction.payload.type, reorderAction.payload.id) ||
            Diff.findChain(mappingSnapshot, targetCreationsAndMoves, targetTree, reorderAction.payload, removal, findChainCache))
        if (removed.length) {
          return
        }

        // Find Away-moves
        const childAwayMoves = targetMoves
          .filter(move =>
            String(Mappings.mapId(mappingSnapshot, reorderAction.payload, move.payload.location)) !== String(move.payload.parentId) &&
                reorderAction.order.find(item =>
                  String(Mappings.mapRawId(mappingSnapshot, item.id, item.type, reorderAction.payload.location, move.payload.location)) === String(move.payload.id) && item.type === move.payload.type)
          )

        // Find removals of sub items that are being reordered, we need to remove those from the order
        const concurrentRemovals = targetRemovals
          .filter(removal =>
            reorderAction.order.find(item =>
              String(Mappings.mapRawId(mappingSnapshot, item.id, item.type, reorderAction.payload.location, removal.payload.location)) === String(removal.payload.id) && item.type === removal.payload.type))

        // Remove away-moves and removals
        reorderAction.order = reorderAction.order.filter(item => {
          let action
          if (
            // eslint-disable-next-line no-cond-assign
            action = childAwayMoves.find(move =>
              String(Mappings.mapRawId(mappingSnapshot, item.id, item.type, reorderAction.payload.location, move.payload.location)) === String(move.payload.id) && move.payload.type === item.type)) {
            Logger.log('ReconcileReorders: Removing moved item from order', {move: action, reorder: reorderAction})
            return false
          }

          if (
            // eslint-disable-next-line no-cond-assign
            action = concurrentRemovals.find(removal =>
              String(Mappings.mapRawId(mappingSnapshot, item.id, item.type, reorderAction.payload.location, removal.payload.location)) === String(removal.payload.id) && removal.payload.type === item.type)
          ) {
            Logger.log('ReconcileReorders: Removing removed item from order', {item, reorder: reorderAction, removal: action})
            return false
          }
          return true
        })

        // Find and insert creations
        const concurrentCreations = targetCreations.filter(
          (creation) =>
            String(reorderAction.payload.id) ===
              String(creation.payload.parentId) &&
            !reorderAction.order.find(
              ({ type, id }) =>
                type === creation.payload.type &&
                String(id) === String(creation.payload.id)
            )
        )
        concurrentCreations
          .forEach(a => {
            Logger.log('ReconcileReorders: Inserting created item into order', {creation: a, reorder: reorderAction})
            reorderAction.order.splice(a.index, 0, { type: a.payload.type, id: a.payload.id })
          })

        // Find and insert moves at move target
        const moves = targetMoves
          .filter(move =>
            String(reorderAction.payload.id) === String(move.payload.parentId) &&
                  !reorderAction.order.find(item => String(item.id) === String(move.payload.id) && item.type === move.payload.type)
          )
        moves.forEach(a => {
          Logger.log('ReconcileReorders: Inserting moved item into order', {move: a, reorder: reorderAction})
          reorderAction.order.splice(a.index, 0, { type: a.payload.type, id: a.payload.id })
        })

        newReorders.commit(reorderAction)
      })

    return newReorders
  }

  reconcileConcurrentReorderings<L1 extends TItemLocation, L2 extends TItemLocation>(
    targetReorders: Diff<L2, TItemLocation, ReorderAction<L2, TItemLocation>>,
    sourceReorders: Diff<L1, TItemLocation, ReorderAction<L1, TItemLocation>>,
    targetLocation: L1,
    mappingSnapshot: MappingSnapshot
  ) : Diff<L2, TItemLocation, ReorderAction<L2, TItemLocation>> {
    Logger.log('Reconciling concurrent reorders from both reorder plans')
    const sourceReorderActions = sourceReorders.getActions()

    const newReorders = new Diff<L2, TItemLocation, ReorderAction<L2, TItemLocation>>

    targetReorders
      .getActions()
      // MOVEs have oldItem from cacheTree and payload now mapped to their corresponding target tree
      // REORDERs have payload in source tree
      .forEach(oldReorderAction => {
        // clone action
        const reorderAction = {...oldReorderAction, order: oldReorderAction.order.slice()}

        const concurrentSourceReorder = sourceReorderActions
          .find(a => Mappings.mappable(mappingSnapshot, a.payload, reorderAction.payload))
        if (concurrentSourceReorder) {
          // Both source and target have a reorder for this item
          if (targetLocation === this.masterLocation) {
            newReorders.commit(reorderAction)
          } else {
            newReorders.commit({
              ...reorderAction,
              order: concurrentSourceReorder.order.map(({ type, id }) => ({
                type,
                id: Mappings.mapRawId(
                  mappingSnapshot,
                  id,
                  type,
                  concurrentSourceReorder.payload.location,
                  reorderAction.payload.location
                ),
              })),
            })
          }
          return
        }

        newReorders.commit(reorderAction)
      })

    return newReorders
  }

  async executeReorderings(resource:OrderFolderResource<TItemLocation>, reorderings:Diff<TItemLocation, TItemLocation, ReorderAction<TItemLocation, TItemLocation>>):Promise<void> {
    Logger.log('Executing reorderings')
    Logger.log({ reorderings })

    const isUsingTabs = await this.localTree.isUsingBrowserTabs?.()

    let iterations = 0
    await Parallel.each(reorderings.getActions(), async(action) => {
      if (++iterations % 1000 === 0) {
        await yieldToEventLoop()
      }
      Logger.log('Executing reorder action', `${action.type} Payload: #${action.payload.id}[${action.payload.title}]${'url' in action.payload ? `(${action.payload.url})` : ''} parentId: ${action.payload.parentId}`)
      const item = action.payload

      if (this.canceled) {
        throw new CancelledSyncError()
      }

      if (action.order.length <= 1) {
        reorderings.retract(action)
        return
      }

      const items = {}
      try {
        await Promise.race([
          resource.orderFolder(item.id, action.order
            // in rare situations the diff generates a REMOVE for an item that is still in the tree,
            // make sure to sort out those failed mapings (value: undefined)
            // also make sure that items are unique
            .filter(item => {
              if (items[item.type + '' + item.id]) {
                return false
              }
              items[item.type + '' + item.id] = true
              return item.id
            })
          ),
          this.cancelPromise,
        ])
      } catch (e) {
        Logger.log('Failed to execute REORDER: ' + e.message + '\nMoving on.')
        Logger.log(e)
      }
      reorderings.retract(action)
      await this.updateProgress()
    }, isUsingTabs ? 1 : ACTION_CONCURRENCY)
  }

  async addMapping(resource:TResource<TItemLocation>, item:TItem<TItemLocation>, newId:string|number):Promise<void> {
    if (++this.mappingIterations % 1000 === 0) {
      await yieldToEventLoop()
    }
    let localId, remoteId
    if (resource === this.server) {
      localId = item.id
      remoteId = newId
    } else {
      localId = newId
      remoteId = item.id
    }
    if (item.type === 'folder') {
      await this.mappings.addFolder({ localId, remoteId })
    } else {
      await this.mappings.addBookmark({ localId, remoteId })
    }
  }

  async removeMapping(resource:TResource<TItemLocation>, item:TItem<TItemLocation>):Promise<void> {
    let localId, remoteId
    if (resource === this.server) {
      remoteId = item.id
    } else {
      localId = item.id
    }
    if (!this.server.isAtomic()) {
      if (item.type === 'folder') {
        await this.mappings.removeFolder({ localId, remoteId })
      } else {
        await this.mappings.removeBookmark({ localId, remoteId })
      }
    } else {
      // We don't remove from mappings immediately anymore, but wait for GC
    }
  }

  async loadChildren(
    serverItem:TItem<typeof ItemLocation.SERVER>,
    mappingsSnapshot:MappingSnapshot,
    isRoot = false
  ):Promise<void> {
    if (this.canceled) {
      throw new CancelledSyncError()
    }
    if (!(serverItem instanceof Folder)) return
    if (!('loadFolderChildren' in this.server)) return
    let localItem, cacheItem
    if (isRoot) {
      localItem = this.localTreeRoot
      cacheItem = this.cacheTreeRoot
    } else {
      const localId = mappingsSnapshot.ServerToLocal.folder[serverItem.id]
      localItem = this.localTreeRoot.findFolder(localId)
      cacheItem = this.cacheTreeRoot.findFolder(localId)
    }
    if (
      localItem &&
      !(await this.folderHasChanged(localItem, cacheItem, serverItem))
    ) {
      return
    }
    Logger.log('LOADCHILDREN', serverItem)
    // If we don't know this folder, yet, load the whole subtree (!localItem)
    const children = await this.server.loadFolderChildren(serverItem.id, !localItem)
    if (!children) {
      return
    }
    serverItem.children = children
    serverItem.loaded = true

    // recurse
    await Parallel.each(
      serverItem.children,
      child => this.loadChildren(child, mappingsSnapshot),
      10
    )
  }

  async folderHasChanged(localItem: TItem<typeof ItemLocation.LOCAL>, cacheItem: TItem<typeof ItemLocation.LOCAL>, serverItem: TItem<typeof ItemLocation.SERVER>):Promise<boolean> {
    const mappingsSnapshot = this.mappings.getSnapshot()
    const localHash = localItem
      ? await localItem.hash(this.hashSettings)
      : null
    const cacheHash = cacheItem
      ? await cacheItem.hash(this.hashSettings)
      : null
    const serverHash = serverItem
      ? await serverItem.hash(this.hashSettings)
      : null
    const reconciled = !cacheItem
    const changedLocally =
      (localHash !== cacheHash) ||
      (cacheItem && String(localItem.parentId) !== String(cacheItem.parentId))
    const changedUpstream =
      (cacheHash !== serverHash) ||
      (cacheItem &&
        String(cacheItem.parentId) !==
        String(mappingsSnapshot.ServerToLocal.folder[serverItem.parentId]))
    return changedLocally || changedUpstream || reconciled
  }

  filterOutUnmappedItems(tree: Folder<TItemLocation>, mapping: MappingSnapshot) {
    tree.children = tree.children.filter(child => {
      if (child instanceof Bookmark) {
        return child.id in mapping.LocalToServer.bookmark
      } else {
        if (child.id in mapping.LocalToServer.folder) {
          this.filterOutUnmappedItems(child, mapping)
          return true
        } else {
          return false
        }
      }
    })
  }

  static removeItemFromReorders(
    mappingsSnapshot: MappingSnapshot,
    sourceReorders:Diff<TItemLocation, TItemLocation, ReorderAction<TItemLocation, TItemLocation>>,
    oldItem: TItem<TItemLocation>) {
    const parentReorder = sourceReorders.getActions().find(action => String(Mappings.mapId(mappingsSnapshot, action.payload, oldItem.location)) === String(oldItem.parentId))
    if (!parentReorder) {
      return
    }
    parentReorder.order = parentReorder.order.filter(item => !(item.type === oldItem.type && String(Mappings.mapId(mappingsSnapshot, oldItem, parentReorder.payload.location)) === String(item.id)))
  }

  async toJSONAsync(): Promise<ISerializedSyncProcess> {
    if (!this.staticContinuation) {
      this.staticContinuation = {
        // Do not store these as the continuation size can get huge otherwise
        localTreeRoot: null,
        cacheTreeRoot: null,
        serverTreeRoot: null,
      }
    }
    const membersToPersist = this.getMembersToPersist()
    let iterations = 0
    return {
      strategy: 'default',
      ...this.staticContinuation,
      ...(Object.fromEntries(
        await Parallel.map(
          membersToPersist,
          async(key) => {
            const value = this[key]
            if (
              value &&
                value.CREATE &&
                value.REMOVE &&
                value.UPDATE &&
                value.MOVE &&
                value.REORDER
            ) {
              // property holds a Plan
              return [
                key,
                Object.fromEntries(
                  await Parallel.map(
                    Object.entries(value),
                    async([key, diff]: [
                        string,
                        Diff<
                          TItemLocation,
                          TItemLocation,
                          Action<TItemLocation, TItemLocation>
                        >
                      ]) => {
                      if (diff && diff.toJSONAsync) {
                        return [key, await diff.toJSONAsync()]
                      }
                      if (diff && diff.toJSON) {
                        if (++iterations % 1000 === 0) {
                          await yieldToEventLoop()
                        }
                        return [key, diff.toJSON()]
                      }
                      return [key, diff]
                    }
                  )
                ),
              ]
            }
            if (value && value.toJSONAsync) {
              return [key, await value.toJSONAsync()]
            }
            if (value && value.toJSON) {
              if (++iterations % 1000 === 0) {
                await yieldToEventLoop()
              }
              return [key, value.toJSON()]
            }
            return [key, value]
          },
          1
        )
      )
      ),
    }
  }

  static async fromJSON(mappings:Mappings,
    localTree:TLocalTree,
    server:TAdapter,
    progressCb:(progress:number, actionsDone:number)=>Promise<void>,
    json: any) {
    if (!localTree) {
      throw new Error('localTree cannot be null when restoring sync process')
    }
    if (!server) {
      throw new Error('server cannot be null when restoring sync process')
    }
    if (!mappings) {
      throw new Error('mappings cannot be null when restoring sync process')
    }

    let strategy: SyncProcess
    switch (json.strategy) {
      case 'default':
        strategy = new SyncProcess(mappings, localTree, server, progressCb)
        break
      case 'merge':
        // eslint-disable-next-line no-case-declarations
        const MergeSyncProcess = (await import('./Merge')).default
        strategy = new MergeSyncProcess(mappings, localTree, server, progressCb)
        break
      case 'unidirectional':
        // eslint-disable-next-line no-case-declarations
        const UnidirectionalSyncProcess = (await import('./Unidirectional')).default
        strategy = new UnidirectionalSyncProcess(mappings, localTree, server, progressCb)
        break
      default:
        throw new Error('Unknown strategy: ' + json.strategy)
    }
    await strategy.setProgress(json)
    return strategy
  }
}

export interface ISerializedSyncProcess {
  strategy: 'default' | 'merge' | 'unidirectional'
  [k: string]: any
}
