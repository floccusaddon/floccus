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
import { throttle } from 'throttle-debounce'
import Mappings, { MappingSnapshot } from '../Mappings'
import TResource, { OrderFolderResource, TLocalTree } from '../interfaces/Resource'
import { TAdapter } from '../interfaces/Adapter'
import { CancelledSyncError, FailsafeError } from '../../errors/Error'

import NextcloudBookmarksAdapter from '../adapters/NextcloudBookmarks'
import CachingAdapter from '../adapters/Caching'

const ACTION_CONCURRENCY = 12

export default class SyncProcess {
  protected mappings: Mappings
  protected localTree: TLocalTree
  protected server: TAdapter
  protected cacheTreeRoot: Folder<typeof ItemLocation.LOCAL>|null
  protected canceled: boolean
  protected preserveOrder: boolean
  protected progressCb: (progress:number, actionsDone?:number)=>void

  // Stage -1
  protected localTreeRoot: Folder<typeof ItemLocation.LOCAL> = null
  protected serverTreeRoot: Folder<typeof ItemLocation.SERVER> = null

  // Stage 0
  protected localScanResult: ScanResult<typeof ItemLocation.LOCAL, TItemLocation> = null
  protected serverScanResult: ScanResult<typeof ItemLocation.SERVER, TItemLocation> = null

  // Stage 1
  private localPlanStage1: PlanStage1<typeof ItemLocation.SERVER, TItemLocation>
  private serverPlanStage1: PlanStage1<typeof ItemLocation.LOCAL, TItemLocation>

  // Stage 2
  private localPlanStage2: PlanStage2<typeof ItemLocation.SERVER, TItemLocation, typeof ItemLocation.LOCAL>
  private serverPlanStage2: PlanStage2<typeof ItemLocation.LOCAL, TItemLocation, typeof ItemLocation.SERVER>

  // Stage 3
  private localDonePlan: PlanStage3<typeof ItemLocation.SERVER, TItemLocation, typeof ItemLocation.LOCAL>
  private serverDonePlan: PlanStage3<typeof ItemLocation.LOCAL, TItemLocation, typeof ItemLocation.SERVER>
  private localReorders: Diff<typeof ItemLocation.SERVER, TItemLocation, ReorderAction<typeof ItemLocation.SERVER, TItemLocation>>
  private serverReorders: Diff<typeof ItemLocation.LOCAL, TItemLocation, ReorderAction<typeof ItemLocation.LOCAL, TItemLocation>>

  // Stage 4
  private localReordersFinal: Diff<typeof ItemLocation.LOCAL, TItemLocation, ReorderAction<typeof ItemLocation.LOCAL, TItemLocation>>
  private serverReorderFinal: Diff<typeof ItemLocation.SERVER, TItemLocation, ReorderAction<typeof ItemLocation.SERVER, TItemLocation>>

  protected actionsDone = 0
  protected actionsPlanned = 0

  protected isFirefox: boolean

  protected staticContinuation: any = null

  // The location that has precedence in case of conflicts
  protected masterLocation: TItemLocation

  constructor(
    mappings:Mappings,
    localTree:TLocalTree,
    server:TAdapter,
    progressCb:(progress:number, actionsDone?:number)=>void
  ) {
    this.mappings = mappings
    this.localTree = localTree
    this.server = server

    this.preserveOrder = 'orderFolder' in this.server

    this.progressCb = throttle(500, true, progressCb) as (progress:number, actionsDone?:number)=>void
    this.canceled = false
    this.isFirefox = self.location.protocol === 'moz-extension:'
  }

  getMembersToPersist() {
    return [
      // Stage 0
      'localScanResult',
      'serverScanResult',

      // Stage 1
      'localPlanStage1',
      'serverPlanStage1',

      // Stage 2
      'localPlanStage2',
      'serverPlanStage2',

      // Stage 3
      'localDonePlan',
      'serverDonePlan',
      'localReorders',
      'serverReorders',

      // Stage 4
      'localReorderPlan',
      'serverReorderPlan',
    ]
  }

  getMappingsInstance(): Mappings {
    return this.mappings
  }

  setCacheTree(cacheTree: Folder<typeof ItemLocation.LOCAL>) {
    this.cacheTreeRoot = cacheTree
  }

  public getTargetTree<L1 extends TItemLocation>(targetLocation: L1): Folder<L1> {
    return (targetLocation === ItemLocation.SERVER ? this.serverTreeRoot : this.localTreeRoot) as Folder<L1>
  }

  async cancel() :Promise<void> {
    this.canceled = true
    this.server.cancel()
  }

  updateProgress():void {
    if (typeof this.actionsDone === 'undefined') {
      this.actionsDone = 0
    }
    this.actionsDone++
    this.progressCb(
      Math.min(
        1,
        0.5 + (this.actionsDone / (this.actionsPlanned + 1)) * 0.5
      ),
      this.actionsDone
    )
    Logger.log(`Executed ${this.actionsDone} actions from ${this.actionsPlanned} actions`)
  }

  setProgress({actionsDone, actionsPlanned}: {actionsDone: number, actionsPlanned: number}) {
    this.actionsDone = actionsDone
    this.actionsPlanned = actionsPlanned
    this.progressCb(
      Math.min(
        1,
        0.5 + (this.actionsDone / (this.actionsPlanned + 1)) * 0.5
      ),
      this.actionsDone
    )
  }

  setDirection(direction:TItemLocation):void {
    throw new Error('Unsupported method')
  }

  async sync(): Promise<void> {
    // onSyncStart is already executed at this point
    this.progressCb(0.15)

    this.masterLocation = ItemLocation.LOCAL
    await this.prepareSync()

    // trees are loaded at this point
    this.progressCb(0.35)

    if (this.canceled) {
      throw new CancelledSyncError()
    }

    Logger.log({localTreeRoot: this.localTreeRoot, serverTreeRoot: this.serverTreeRoot, cacheTreeRoot: this.cacheTreeRoot})

    if (!this.localScanResult && !this.serverScanResult) {
      const { localScanResult, serverScanResult } = await this.getDiffs()
      Logger.log({ localScanResult, serverScanResult })
      this.localScanResult = localScanResult
      this.serverScanResult = serverScanResult
      this.progressCb(0.45)
    }

    if (this.canceled) {
      throw new CancelledSyncError()
    }

    if (!this.serverPlanStage1) {
      this.serverPlanStage1 = await this.reconcileDiffs(this.localScanResult, this.serverScanResult, ItemLocation.SERVER)
    }

    if (this.canceled) {
      throw new CancelledSyncError()
    }

    if (!this.localPlanStage1) {
      this.localPlanStage1 = await this.reconcileDiffs(this.serverScanResult, this.localScanResult, ItemLocation.LOCAL)
    }

    let mappingsSnapshot: MappingSnapshot

    if (!this.serverPlanStage2) {
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
    }

    if (this.canceled) {
      throw new CancelledSyncError()
    }

    if (!this.localPlanStage2) {
      // have to get snapshot after reconciliation, because of concurrent creation reconciliation
      if (!mappingsSnapshot) mappingsSnapshot = this.mappings.getSnapshot()
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

    this.applyFailsafe(this.localPlanStage2.REMOVE)

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

    if (!this.localReorders) {
      this.localReorders = this.localPlanStage2.REORDER
      this.serverReorders = this.serverPlanStage2.REORDER
    }

    if (!this.actionsPlanned) {
      this.actionsPlanned = Object.values(this.serverPlanStage2).reduce((acc, diff) => diff.getActions().length + acc, 0) +
        Object.values(this.localPlanStage2).reduce((acc, diff) => diff.getActions().length + acc, 0)
    }

    Logger.log('Executing server plan')
    await this.execute(this.server, this.serverPlanStage2, ItemLocation.SERVER, this.serverDonePlan, this.serverReorders)

    if (this.canceled) {
      throw new CancelledSyncError()
    }

    Logger.log('Executing local plan')
    await this.execute(this.localTree, this.localPlanStage2, ItemLocation.LOCAL, this.localDonePlan, this.localReorders)

    if (this.canceled) {
      throw new CancelledSyncError()
    }

    if ('orderFolder' in this.server && !this.localReordersFinal) {
      // mappings have been updated, reload
      mappingsSnapshot = this.mappings.getSnapshot()
      this.localReordersFinal = this.reconcileReorderings(this.localReorders, this.serverDonePlan, ItemLocation.LOCAL, mappingsSnapshot)
      this.serverReorderFinal = this.reconcileReorderings(this.serverReorders, this.localDonePlan, ItemLocation.SERVER, mappingsSnapshot)
    }

    if (this.canceled) {
      throw new CancelledSyncError()
    }

    if ('orderFolder' in this.server) {
      Logger.log('Executing reorderings')
      await Promise.all([
        this.executeReorderings(this.server, this.serverReorderFinal),
        this.executeReorderings(this.localTree, this.localReordersFinal),
      ])
    }
  }

  protected async prepareSync() {
    if (!this.localTreeRoot) {
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

  protected applyFailsafe(removals: Diff<TItemLocation, TItemLocation, RemoveAction<TItemLocation, TItemLocation>>) {
    const localCountTotal = this.localTreeRoot.count()
    const localCountDeleted = removals.getActions().reduce((count, action) => count + action.payload.count(), 0)

    Logger.log('Checking failsafe: ' + localCountDeleted + '/' + localCountTotal + '=' + (localCountDeleted / localCountTotal))
    if (localCountTotal > 5 && localCountDeleted / localCountTotal > 0.5) {
      const failsafe = this.server.getData().failsafe
      if (failsafe !== false || typeof failsafe === 'undefined') {
        throw new FailsafeError(Math.ceil((localCountDeleted / localCountTotal) * 100))
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
    tree.children = tree.children.filter(child => {
      if (child instanceof Bookmark) {
        // Chrome URLs cannot be added in firefox
        if (this.isFirefox && child.url.startsWith('chrome')) {
          return false
        }
        // Linkwarden supports bookmarks that have no URL eg. for directly uploaded files
        if (child.url === null) {
          return false
        }
      } else {
        this.filterOutInvalidBookmarks(child)
      }
      return true
    })
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

    const newMappings = []

    let localScanner, serverScanner
    if (this.localTree.constructor.name === 'LocalTabs') {
      // if we have the cache available, Diff cache and both trees
      localScanner = new Scanner(
        this.cacheTreeRoot,
        this.localTreeRoot,
        // We also allow canMergeWith for folders here, because Window IDs are not stable
        // If a bookmark's URL has changed we want to recreate it instead of updating it, because of Nextcloud Bookmarks' uniqueness constraints
        (oldItem, newItem) => {
          if (oldItem.type !== newItem.type) {
            return false
          }
          if (oldItem.type === 'bookmark' && newItem.type === 'bookmark' && oldItem.url !== newItem.url) {
            return false
          }
          if (Mappings.mappable(mappingsSnapshot, oldItem, newItem)) {
            return true
          }
          if (oldItem.type === 'folder' && oldItem.canMergeWith(newItem)) {
            return true
          }
          return false
        },
        this.preserveOrder,
      )
      serverScanner = new Scanner(
        this.cacheTreeRoot,
        this.serverTreeRoot,
        // We also allow canMergeWith here
        // (for bookmarks, because e.g. for NextcloudFolders the id of moved bookmarks changes (because their id is "<bookmarkID>;<folderId>")
        // (for folders because Window IDs are not stable)
        // If a bookmark's URL has changed we want to recreate it instead of updating it, because of Nextcloud Bookmarks' uniqueness constraints
        (oldItem, newItem) => {
          if (oldItem.type !== newItem.type) {
            return false
          }
          if (oldItem.type === 'bookmark' && newItem.type === 'bookmark' && oldItem.url !== newItem.url) {
            return false
          }
          if (Mappings.mappable(mappingsSnapshot, oldItem, newItem)) {
            newMappings.push([oldItem, newItem])
            return true
          }
          if (oldItem.canMergeWith(newItem)) {
            newMappings.push([oldItem, newItem])
            return true
          }
          return false
        },
        this.preserveOrder,
      )
    } else {
      // if we have the cache available, Diff cache and both trees
      localScanner = new Scanner(
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
          if (Mappings.mappable(mappingsSnapshot, oldItem, newItem)) {
            return true
          }
          return false
        },
        this.preserveOrder
      )
      serverScanner = new Scanner(
        this.cacheTreeRoot,
        this.serverTreeRoot,
        // We also allow canMergeWith here, because e.g. for NextcloudBookmarks the id of moved bookmarks changes (because their id is "<bookmarkID>;<folderId>")
        (oldItem, newItem) => {
          if (oldItem.type !== newItem.type) {
            return false
          }
          // If a bookmark's URL has changed we want to recreate it instead of updating it, because of Nextcloud Bookmarks' uniqueness constraints
          if (oldItem.type === 'bookmark' && newItem.type === 'bookmark' && oldItem.url !== newItem.url) {
            return false
          }
          if (Mappings.mappable(mappingsSnapshot, oldItem, newItem)) {
            newMappings.push([oldItem, newItem])
            return true
          }
          if (oldItem.type === 'bookmark' && newItem.type === 'bookmark') {
            if (oldItem.canMergeWith(newItem)) {
              newMappings.push([oldItem, newItem])
              return true
            }
          }
          return false
        },
        this.preserveOrder
      )
    }
    Logger.log('Calculating diffs for local and server trees relative to cache tree')
    const localScanResult = await localScanner.run()
    const serverScanResult = await serverScanner.run()
    await Parallel.map(newMappings, ([localItem, serverItem]) => this.addMapping(this.server, localItem, serverItem.id), 10)
    return {localScanResult, serverScanResult}
  }

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
    const targetReorders = targetScanResult.REORDER.getActions()

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

    await Parallel.each(sourceScanResult.REMOVE.getActions(), async(action) => {
      const concurrentRemoval = targetRemovals.find(targetRemoval =>
        (action.payload.type === targetRemoval.payload.type && Mappings.mappable(mappingsSnapshot, action.payload, targetRemoval.payload)) ||
        Diff.findChain(mappingsSnapshot, allCreateAndMoveActions, targetTree, action.payload, targetRemoval))
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

    await Parallel.each(sourceScanResult.CREATE.getActions(), async(action) => {
      const concurrentCreation = targetCreations.find(a => (
        action.payload.parentId === Mappings.mapParentId(mappingsSnapshot, a.payload, action.payload.location) &&
        action.payload.canMergeWith(a.payload)
      ))
      if (concurrentCreation) {
        // created on both the target and sourcely, try to reconcile
        const newMappings = []
        const subScanner = new Scanner(
          concurrentCreation.payload, // target tree
          action.payload, // source tree
          (oldItem, newItem) => {
            if (oldItem.type === newItem.type && oldItem.canMergeWith(newItem)) {
              // if two items can be merged, we'll add mappings here directly
              newMappings.push([oldItem, newItem.id])
              return true
            }
            return false
          },
          this.preserveOrder,
          false
        )
        await subScanner.run()
        newMappings.push([concurrentCreation.payload, action.payload.id])
        await Parallel.each(newMappings, async([oldItem, newId]) => {
          await this.addMapping(action.payload.location === ItemLocation.LOCAL ? this.localTree : this.server, oldItem, newId)
        },1)
        // TODO: subScanner may contain residual CREATE/REMOVE actions that need to be added to mappings
        return
      }
      const concurrentRemoval = targetScanResult.REMOVE.getActions().find(targetRemoval =>
        // target removal removed this creation's target (via some chain)
        Diff.findChain(mappingsSnapshot, allCreateAndMoveActions, sourceTree, action.payload, targetRemoval)
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
          // Moved both on target and sourcely, source has precedence: do nothing sourcely
          return
        }
      }
      // FInd out if there's a removal in the target diff which already deletes this item (via some chain of MOVE|CREATEs)
      const complexTargetTargetRemoval = targetRemovals.find(targetRemoval => {
        return Diff.findChain(mappingsSnapshot, allCreateAndMoveActions, sourceTree, action.payload, targetRemoval)
      })
      const concurrentTargetOriginRemoval = targetRemovals.find(targetRemoval =>
        (action.payload.type === targetRemoval.payload.type && Mappings.mappable(mappingsSnapshot, action.payload, targetRemoval.payload)) ||
        Diff.findChain(mappingsSnapshot, allCreateAndMoveActions, sourceTree, action.oldItem, targetRemoval)
      )
      const concurrentSourceOriginRemoval = sourceRemovals.find(sourceRemoval => {
        return Diff.findChain(mappingsSnapshot, allCreateAndMoveActions, targetTree, action.oldItem, sourceRemoval)
      })
      const concurrentSourceTargetRemoval = sourceRemovals.find(sourceRemoval =>
        // We pass an empty folder here, because we don't want direct deletions of the moved folder's parent to count, as it's moved away anyway
        Diff.findChain(mappingsSnapshot, allCreateAndMoveActions, new Folder({id: 0, location: targetLocation}), action.payload, sourceRemoval)
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
          const newPayload = action.payload.clone()
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
      // Find concurrent moves that form a hierarchy reversal together with this one
      const concurrentHierarchyReversals = targetMoves.filter(targetMove => {
        return Diff.findChain(mappingsSnapshot, allCreateAndMoveActions, sourceTree, action.payload, targetMove) &&
          Diff.findChain(mappingsSnapshot, allCreateAndMoveActions, targetTree, targetMove.payload, action)
      })
      if (concurrentHierarchyReversals.length) {
        if (targetLocation !== this.masterLocation) {
          targetPlan.MOVE.commit(action)

          concurrentHierarchyReversals.forEach(a => {
            // moved sourcely but moved in reverse hierarchical order on target
            const payload = a.oldItem.cloneWithLocation(false, action.payload.location)
            const oldItem = a.payload.cloneWithLocation(false, action.oldItem.location)
            oldItem.id = Mappings.mapId(mappingsSnapshot, a.payload, action.oldItem.location)
            oldItem.parentId = Mappings.mapParentId(mappingsSnapshot, a.payload, action.oldItem.location)

            if (
              // Don't create duplicates!
              targetPlan.MOVE.getActions().find(move => String(move.payload.id) === String(payload.id)) ||
              sourceMoves.find(move => String(move.payload.id) === String(payload.id)) ||
              // Don't move back into removed territory
              targetRemovals.find(remove => Diff.findChain(mappingsSnapshot, allCreateAndMoveActions, sourceTree, action.payload, remove)) ||
              sourceRemovals.find(remove => Diff.findChain(mappingsSnapshot, allCreateAndMoveActions, targetTree, action.payload, remove))
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
    })

    await Parallel.each(sourceScanResult.REORDER.getActions(), async(action) => {
      if (avoidTargetReorders[action.payload.id]) {
        return
      }

      if (targetLocation === this.masterLocation) {
        const concurrentReorder = targetReorders.find(a =>
          action.payload.type === a.payload.type && Mappings.mappable(mappingsSnapshot, action.payload, a.payload))
        if (concurrentReorder) {
          return
        }
      }

      const concurrentRemoval = targetRemovals.find(a =>
        a.payload.findItem('folder', action.payload.id))
      if (concurrentRemoval) {
        // Already deleted on target, do nothing.
        return
      }

      targetPlan.REORDER.commit(action)
    })

    return targetPlan
  }

  async execute<L1 extends TItemLocation>(
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
    }

    if (this.canceled) {
      throw new CancelledSyncError()
    }

    Logger.log(targetLocation + ': executing CREATEs')

    await Parallel.each(
      planStage2.UPDATE.getActions(),
      (action) => this.executeUpdate(resource, action, targetLocation, planStage2.UPDATE, donePlan),
      ACTION_CONCURRENCY
    )

    if (this.canceled) {
      throw new CancelledSyncError()
    }

    const mappingsSnapshot = this.mappings.getSnapshot()
    Logger.log(targetLocation + ': mapping MOVEs')

    const planStage3: PlanStage3<TOppositeLocation<L1>, TItemLocation, typeof targetLocation> = {
      CREATE: planStage2.CREATE,
      UPDATE: planStage2.UPDATE,
      MOVE: planStage2.MOVE.map(mappingsSnapshot, targetLocation),
      REMOVE: planStage2.REMOVE,
      REORDER: planStage2.REORDER,
    }

    if (this.canceled) {
      throw new CancelledSyncError()
    }

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
    await Promise.resolve()
    Logger.log('Executing action ', action)

    if (this.canceled) {
      throw new CancelledSyncError()
    }

    const done = () => {
      diff.retract(action)
      donePlan.CREATE.commit(action)
      this.updateProgress()
    }

    const id = await action.payload.visitCreate(resource)
    if (typeof id === 'undefined') {
      // undefined means we couldn't create the item. we're ignoring it
      done()
      return
    }

    action.payload.id = id

    if (action.oldItem) {
      await this.addMapping(resource, action.oldItem, id)
    }

    if (action.payload instanceof Folder && !(action.oldItem instanceof Folder)) {
      throw new Error('Assertion failed: action.oldItem should be set')
    }

    if (action.payload instanceof Folder && action.payload.children.length && action.oldItem instanceof Folder) {
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
            const imported = await resource.bulkImportFolder(id, action.oldItem.cloneWithLocation(false, action.payload.location)) as Folder<typeof targetLocation>
            const newMappings = []
            const subScanner = new Scanner(
              action.oldItem,
              imported,
              (oldItem, newItem) => {
                if (oldItem.type === newItem.type && oldItem.canMergeWith(newItem)) {
                  // if two items can be merged, we'll add mappings here directly
                  newMappings.push([oldItem, newItem.id])
                  return true
                }
                return false
              },
              this.preserveOrder,
              false,
            )
            await subScanner.run()
            await Parallel.each(newMappings, async([oldItem, newId]: [TItem<TItemLocation>, string|number]) => {
              await this.addMapping(resource, oldItem, newId)
            }, 10)

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

            done()
            return
          } catch (e) {
            Logger.log('Bulk import failed, continuing with normal creation', e)
          }
        } else {
          try {
            // Try bulk import without sub folders
            const tempItem = action.oldItem.cloneWithLocation(false, action.payload.location)
            const bookmarks = tempItem.children.filter(child => child instanceof Bookmark)
            while (bookmarks.length > 0) {
              Logger.log('Attempting chunked bulk import')
              tempItem.children = bookmarks.splice(0, 70)
              const imported = await resource.bulkImportFolder(action.payload.id, tempItem)
              const newMappings = []
              const subScanner = new Scanner(
                tempItem,
                imported,
                (oldItem, newItem) => {
                  if (oldItem.type === newItem.type && oldItem.canMergeWith(newItem)) {
                    // if two items can be merged, we'll add mappings here directly
                    newMappings.push([oldItem, newItem.id])
                    return true
                  }
                  return false
                },
                this.preserveOrder,
                false,
              )
              await subScanner.run()
              await Parallel.each(newMappings, async([oldItem, newId]: [TItem<TItemLocation>, string|number]) => {
                await this.addMapping(resource, oldItem, newId)
              }, 10)
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

            done()
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

    done()
  }

  async executeRemove<L1 extends TItemLocation>(
    resource: TResource<L1>,
    action: RemoveAction<L1, TItemLocation>,
    targetLocation: L1,
    diff: Diff<L1, TItemLocation, RemoveAction<L1, TItemLocation>>,
    donePlan: PlanStage3<TOppositeLocation<L1>, TItemLocation, L1>
  ): Promise<void> {
    // defer execution of actions to allow the this.canceled check below to work when cancelling in interrupt tests
    await Promise.resolve()
    Logger.log('Executing action ', action)

    if (this.canceled) {
      throw new CancelledSyncError()
    }

    await action.payload.visitRemove(resource)
    await this.removeMapping(resource, action.payload)
    diff.retract(action)
    donePlan.REMOVE.commit(action)
    this.updateProgress()
  }

  async executeUpdate<L1 extends TItemLocation>(
    resource: TResource<L1>,
    action: UpdateAction<L1, TItemLocation> | MoveAction<L1, TItemLocation>,
    targetLocation: L1,
    diff: Diff<L1, TItemLocation, UpdateAction<L1, TItemLocation> | MoveAction<L1, TItemLocation>>,
    donePlan: PlanStage3<TItemLocation, TItemLocation, L1>): Promise<void> {
    // defer execution of actions to allow the this.canceled check below to work when cancelling in interrupt tests
    await Promise.resolve()
    Logger.log('Executing action ', action)

    if (this.canceled) {
      throw new CancelledSyncError()
    }

    await action.payload.visitUpdate(resource)
    await this.addMapping(resource, action.oldItem, action.payload.id)
    diff.retract(action)
    if (action.type === ActionType.UPDATE) {
      donePlan.UPDATE.commit(action)
    } else {
      donePlan.MOVE.commit(action)
    }
    this.updateProgress()
  }

  reconcileReorderings<L1 extends TItemLocation, L2 extends TItemLocation>(
    targetReorders: Diff<L2, TItemLocation, ReorderAction<L2, TItemLocation>>,
    sourceDonePlan: PlanStage3<L1, TItemLocation, L2>,
    targetLocation: L1,
    mappingSnapshot: MappingSnapshot
  ) : Diff<L1, TItemLocation, ReorderAction<L1, TItemLocation>> {
    Logger.log('Reconciling reorders to create a plan')

    const sourceCreations = sourceDonePlan.CREATE.getActions()
    const sourceRemovals = sourceDonePlan.REMOVE.getActions()
    const sourceMoves = sourceDonePlan.MOVE.getActions()

    const newReorders = new Diff<L2, TItemLocation, ReorderAction<L2, TItemLocation>>

    targetReorders
      .getActions()
    // MOVEs have oldItem from cacheTree and payload now mapped to their corresponding target tree
    // REORDERs have payload in source tree
      .forEach(oldReorderAction => {
        // clone action
        const reorderAction = {...oldReorderAction, order: oldReorderAction.order.slice()}

        const removed = sourceRemovals
          .filter(removal => removal.payload.findItem(reorderAction.payload.type, removal.payload.id))
        if (removed.length) {
          return
        }

        // Find Away-moves
        const childAwayMoves = sourceMoves
          .filter(move =>
            (String(reorderAction.payload.id) !== String(move.payload.parentId) && // reorder IDs are from localTree (source of this plan), move.oldItem IDs are from server tree (source of other plan)
                reorderAction.order.find(item => String(item.id) === String(move.payload.id) && item.type === move.payload.type))// move.payload IDs are from localTree (target of the other plan
          )

        // Find removals
        const concurrentRemovals = sourceRemovals
          .filter(removal => reorderAction.order.find(item => String(item.id) === String(removal.payload.id) && item.type === removal.payload.type))

        // Remove away-moves and removals
        reorderAction.order = reorderAction.order.filter(item => {
          let action
          if (
            // eslint-disable-next-line no-cond-assign
            action = childAwayMoves.find(move =>
              String(item.id) === String(move.payload.id) && move.payload.type === item.type)) {
            Logger.log('ReconcileReorders: Removing moved item from order', {move: action, reorder: reorderAction})
            return false
          }

          if (
            // eslint-disable-next-line no-cond-assign
            action = concurrentRemovals.find(removal =>
              String(item.id) === String(removal.payload.id) && removal.payload.type === item.type)
          ) {
            Logger.log('ReconcileReorders: Removing removed item from order', {item, reorder: reorderAction, removal: action})
            return false
          }
          return true
        })

        // Find and insert creations
        const concurrentCreations = sourceCreations
          .filter(creation => String(reorderAction.payload.id) === String(creation.payload.parentId))
        concurrentCreations
          .forEach(a => {
            Logger.log('ReconcileReorders: Inserting created item into order', {creation: a, reorder: reorderAction})
            reorderAction.order.splice(a.index, 0, { type: a.payload.type, id: a.payload.id })
          })

        // Find and insert moves at move target
        const moves = sourceMoves
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

    return newReorders.map(mappingSnapshot, targetLocation)
  }

  async executeReorderings(resource:OrderFolderResource<TItemLocation>, reorderings:Diff<TItemLocation, TItemLocation, ReorderAction<TItemLocation, TItemLocation>>):Promise<void> {
    Logger.log('Executing reorderings')
    Logger.log({ reorderings })

    await Parallel.each(reorderings.getActions(), async(action) => {
      Logger.log('Executing reorder action', `${action.type} Payload: #${action.payload.id}[${action.payload.title}]${'url' in action.payload ? `(${action.payload.url})` : ''} parentId: ${action.payload.parentId}`)
      const item = action.payload

      if (this.canceled) {
        throw new CancelledSyncError()
      }

      if (action.order.length <= 1) {
        return
      }

      const items = {}
      try {
        await resource.orderFolder(item.id, action.order
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
        )
      } catch (e) {
        Logger.log('Failed to execute REORDER: ' + e.message + '\nMoving on.')
        Logger.log(e)
      }
      reorderings.retract(action)
      this.updateProgress()
    }, ACTION_CONCURRENCY)
  }

  async addMapping(resource:TResource<TItemLocation>, item:TItem<TItemLocation>, newId:string|number):Promise<void> {
    await Promise.resolve()
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
    if (item.type === 'folder') {
      await this.mappings.removeFolder({ localId, remoteId })
    } else {
      await this.mappings.removeBookmark({ localId, remoteId })
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
      ? await localItem.hash(this.preserveOrder)
      : null
    const cacheHash = cacheItem
      ? await cacheItem.hash(this.preserveOrder)
      : null
    const serverHash = serverItem
      ? await serverItem.hash(this.preserveOrder)
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
    const parentReorder = sourceReorders.getActions().find(action => Mappings.mapId(mappingsSnapshot, action.payload, oldItem.location) === oldItem.parentId)
    if (!parentReorder) {
      return
    }
    parentReorder.order = parentReorder.order.filter(item => !(item.type === oldItem.type && Mappings.mapId(mappingsSnapshot, oldItem, parentReorder.payload.location) === item.id))
  }

  toJSON(): ISerializedSyncProcess {
    if (!this.staticContinuation) {
      this.staticContinuation = {
        localTreeRoot: this.localTreeRoot && this.localTreeRoot.clone(false),
        cacheTreeRoot: this.cacheTreeRoot && this.cacheTreeRoot.clone(false),
        serverTreeRoot: this.serverTreeRoot && this.serverTreeRoot.clone(false),
      }
    }
    const membersToPersist = this.getMembersToPersist()
    return {
      strategy: 'default',
      ...this.staticContinuation,
      ...(Object.fromEntries(Object.entries(this)
        .filter(([key]) => membersToPersist.includes(key)))
      ),
    }
  }

  static async fromJSON(mappings:Mappings,
    localTree:TLocalTree,
    server:TAdapter,
    progressCb:(progress:number, actionsDone:number)=>void,
    json: any) {
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
    strategy.setProgress(json)
    if (json.serverTreeRoot) {
      strategy.serverTreeRoot = Folder.hydrate(json.serverTreeRoot)
    }
    if (json.localTreeRoot) {
      strategy.localTreeRoot = Folder.hydrate(json.localTreeRoot)
    }
    if (json.cacheTreeRoot) {
      strategy.cacheTreeRoot = Folder.hydrate(json.cacheTreeRoot)
    }
    strategy.getMembersToPersist().forEach((member) => {
      if (member in json) {
        if (member.toLowerCase().includes('scanresult') || member.toLowerCase().includes('plan')) {
          this[member] = {
            CREATE: Diff.fromJSON(json[member].CREATE),
            UPDATE: Diff.fromJSON(json[member].UPDATE),
            MOVE: Diff.fromJSON(json[member].MOVE),
            REMOVE: Diff.fromJSON(json[member].REMOVE),
            REORDER: Diff.fromJSON(json[member].REORDER),
          }
        } else if (member.toLowerCase().includes('reorders')) {
          this[member] = Diff.fromJSON(json[member])
        } else {
          this[member] = json[member]
        }
      }
    })

    return strategy
  }
}

export interface ISerializedSyncProcess {
  strategy: 'default' | 'merge' | 'unidirectional'
  [k: string]: any
}
