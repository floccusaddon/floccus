import { Bookmark, Folder, TItem, ItemType, ItemLocation, TItemLocation } from '../Tree'
import Logger from '../Logger'
import Diff, { Action, ActionType, CreateAction, MoveAction, RemoveAction, ReorderAction, UpdateAction } from '../Diff'
import Scanner from '../Scanner'
import * as Parallel from 'async-parallel'
import { throttle } from 'throttle-debounce'
import Mappings, { MappingSnapshot } from '../Mappings'
import TResource, { OrderFolderResource, TLocalTree } from '../interfaces/Resource'
import { TAdapter } from '../interfaces/Adapter'
import { CancelledSyncError, FailsafeError } from '../../errors/Error'

import NextcloudBookmarksAdapter from '../adapters/NextcloudBookmarks'
import { setImmediate } from 'timers'

export default class SyncProcess {
  protected mappings: Mappings
  protected localTree: TLocalTree
  protected server: TAdapter
  protected cacheTreeRoot: Folder|null
  protected canceled: boolean
  protected preserveOrder: boolean
  protected progressCb: (progress:number, actionsDone?:number)=>void
  protected localTreeRoot: Folder
  protected serverTreeRoot: Folder
  protected actionsDone = 0
  protected actionsPlanned = 0
  protected isFirefox: boolean
  protected localPlan: Diff
  protected serverPlan: Diff
  protected doneLocalPlan: Diff
  protected doneServerPlan: Diff
  protected localReorderPlan: Diff
  protected serverReorderPlan: Diff
  protected flagLocalPostMoveMapping = false
  protected flagLocalPostReorderReconciliation = false
  protected flagServerPostMoveMapping = false
  protected flagPostReorderReconciliation = false

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

    this.progressCb = throttle(250, true, progressCb) as (progress:number, actionsDone?:number)=>void
    this.actionsDone = 0
    this.actionsPlanned = 0
    this.canceled = false
    this.isFirefox = self.location.protocol === 'moz-extension:'
  }

  setCacheTree(cacheTree: Folder) {
    this.cacheTreeRoot = cacheTree
  }

  setState({localTreeRoot, cacheTreeRoot, serverTreeRoot, localPlan, doneLocalPlan, serverPlan, doneServerPlan, serverReorderPlan, localReorderPlan, flagLocalPostMoveMapping, flagServerPostMoveMapping, flagPostReorderReconciliation}: any) {
    if (typeof localTreeRoot !== 'undefined') {
      this.localTreeRoot = Folder.hydrate(localTreeRoot)
    } else {
      throw new Error('No localTreeRoot found in continuation')
    }
    if (typeof cacheTreeRoot !== 'undefined') {
      this.cacheTreeRoot = Folder.hydrate(cacheTreeRoot)
    } else {
      throw new Error('No cacheTreeRoot found in continuation')
    }
    if (typeof serverTreeRoot !== 'undefined') {
      this.serverTreeRoot = Folder.hydrate(serverTreeRoot)
    } else {
      throw new Error('No serverTreeRoot found in continuation')
    }
    if (typeof localPlan !== 'undefined') {
      this.localPlan = Diff.fromJSON(localPlan)
    }
    if (typeof serverPlan !== 'undefined') {
      this.serverPlan = Diff.fromJSON(serverPlan)
    }
    if (typeof doneLocalPlan !== 'undefined') {
      this.doneLocalPlan = Diff.fromJSON(doneLocalPlan)
    }
    if (typeof doneServerPlan !== 'undefined') {
      this.doneServerPlan = Diff.fromJSON(doneServerPlan)
    }
    if (typeof localReorderPlan !== 'undefined') {
      this.localReorderPlan = Diff.fromJSON(localReorderPlan)
    }
    if (typeof serverReorderPlan !== 'undefined') {
      this.serverReorderPlan = Diff.fromJSON(serverReorderPlan)
    }
    this.flagLocalPostMoveMapping = flagLocalPostMoveMapping
    this.flagServerPostMoveMapping = flagServerPostMoveMapping
    this.flagPostReorderReconciliation = flagPostReorderReconciliation
  }

  async cancel() :Promise<void> {
    this.canceled = true
    this.server.cancel()
  }

  updateProgress():void {
    if (this.serverPlan && this.localPlan) {
      this.actionsPlanned = this.serverPlan.getActions().length + this.localPlan.getActions().length
    } else if ('revertPlan' in this) {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      this.actionsPlanned = this.revertPlan.getActions().length
    }
    Logger.log(`Executed ${this.actionsDone} actions from ${this.actionsPlanned} actions`)
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

    const {localDiff, serverDiff} = await this.getDiffs()
    Logger.log({localDiff, serverDiff})
    this.progressCb(0.5)

    if (this.canceled) {
      throw new CancelledSyncError()
    }

    const unmappedServerPlan = await this.reconcileDiffs(localDiff, serverDiff, ItemLocation.SERVER)

    // have to get snapshot after reconciliation, because of concurrent creation reconciliation
    let mappingsSnapshot = this.mappings.getSnapshot()
    Logger.log('Mapping server plan')
    this.serverPlan = unmappedServerPlan.map(mappingsSnapshot, ItemLocation.SERVER, (action) => action.type !== ActionType.REORDER && action.type !== ActionType.MOVE)

    if (this.canceled) {
      throw new CancelledSyncError()
    }

    const unmappedLocalPlan = await this.reconcileDiffs(serverDiff, localDiff, ItemLocation.LOCAL)
    // have to get snapshot after reconciliation, because of concurrent creation reconciliation
    mappingsSnapshot = this.mappings.getSnapshot()
    Logger.log('Mapping local plan')
    this.localPlan = unmappedLocalPlan.map(mappingsSnapshot, ItemLocation.LOCAL, (action) => action.type !== ActionType.REORDER && action.type !== ActionType.MOVE)

    if (this.canceled) {
      throw new CancelledSyncError()
    }

    this.doneServerPlan = new Diff
    this.doneLocalPlan = new Diff

    Logger.log({localPlan: this.localPlan, serverPlan: this.serverPlan})

    this.actionsPlanned = this.serverPlan.getActions().length + this.localPlan.getActions().length

    this.applyFailsafe(this.localPlan)

    Logger.log('Executing server plan')
    await this.execute(this.server, this.serverPlan, ItemLocation.SERVER, this.doneServerPlan)
    Logger.log('Executing local plan')
    await this.execute(this.localTree, this.localPlan, ItemLocation.LOCAL, this.doneLocalPlan)

    // mappings have been updated, reload
    mappingsSnapshot = this.mappings.getSnapshot()

    if ('orderFolder' in this.server) {
      this.localReorderPlan = this.reconcileReorderings(this.localPlan, this.doneServerPlan, mappingsSnapshot)
        .map(mappingsSnapshot, ItemLocation.LOCAL)

      this.serverReorderPlan = this.reconcileReorderings(this.serverPlan, this.doneLocalPlan, mappingsSnapshot)
        .map(mappingsSnapshot, ItemLocation.SERVER)

      this.flagPostReorderReconciliation = true

      Logger.log('Executing reorderings')
      await Promise.all([
        this.executeReorderings(this.server, this.serverReorderPlan),
        this.executeReorderings(this.localTree, this.localReorderPlan),
      ])
    }
  }

  async resumeSync(): Promise<void> {
    if (typeof this.localPlan === 'undefined' || typeof this.serverPlan === 'undefined') {
      Logger.log('Continuation loaded from storage is incomplete. Falling back to a complete new sync iteration')
      return this.sync()
    }
    Logger.log('Resuming sync with the following plans:')
    Logger.log({localPlan: this.localPlan, serverPlan: this.serverPlan})

    Logger.log('Executing server plan')
    await this.execute(this.server, this.serverPlan, ItemLocation.SERVER, this.doneServerPlan)
    Logger.log('Executing local plan')
    await this.execute(this.localTree, this.localPlan, ItemLocation.LOCAL, this.doneLocalPlan)

    // mappings have been updated, reload
    const mappingsSnapshot = this.mappings.getSnapshot()

    if ('orderFolder' in this.server) {
      if (!this.flagPostReorderReconciliation) {
        this.localReorderPlan = this.reconcileReorderings(this.localPlan, this.doneServerPlan, mappingsSnapshot)
          .map(mappingsSnapshot, ItemLocation.LOCAL)

        this.serverReorderPlan = this.reconcileReorderings(this.serverPlan, this.doneLocalPlan, mappingsSnapshot)
          .map(mappingsSnapshot, ItemLocation.SERVER)
      }

      this.flagPostReorderReconciliation = true

      Logger.log('Executing reorderings')
      await Promise.all([
        this.executeReorderings(this.server, this.serverReorderPlan),
        this.executeReorderings(this.localTree, this.localReorderPlan),
      ])
    }
  }

  protected async prepareSync() {
    Logger.log('Retrieving local tree')
    this.localTreeRoot = await this.localTree.getBookmarksTree()
    Logger.log('Retrieving server tree')
    this.serverTreeRoot = await this.server.getBookmarksTree()
    Logger.log('Filtering out unaccepted local bookmarks')
    this.filterOutUnacceptedBookmarks(this.localTreeRoot)
    Logger.log('Filtering out invalid server bookmarks')
    this.filterOutInvalidBookmarks(this.serverTreeRoot)
    if (this.server instanceof NextcloudBookmarksAdapter) {
      Logger.log('Filtering out duplicate bookmarks')
      await this.filterOutDuplicatesInTheSameFolder(this.localTreeRoot)
    }

    await this.mappings.addFolder({ localId: this.localTreeRoot.id, remoteId: this.serverTreeRoot.id })
    const mappingsSnapshot = this.mappings.getSnapshot()

    if ('loadFolderChildren' in this.server) {
      Logger.log('Loading sparse tree as necessary')
      // Load sparse tree
      await this.loadChildren(this.serverTreeRoot, mappingsSnapshot)
    }

    // Cache tree might not have been initialized and thus have no id
    this.cacheTreeRoot.id = this.localTreeRoot.id

    // generate hash tables to find items faster
    Logger.log('Generating indices for local tree')
    this.localTreeRoot.createIndex()
    Logger.log('Generating indices for cache tree')
    this.cacheTreeRoot.createIndex()
    Logger.log('Generating indices for server tree')
    this.serverTreeRoot.createIndex()
  }

  protected applyFailsafe(localPlan: Diff) {
    const localCountTotal = this.localTreeRoot.count()
    const localCountDeleted = localPlan.getActions(ActionType.REMOVE).reduce((count, action) => count + action.payload.count(), 0)

    Logger.log('Checking failsafe: ' + localCountDeleted + '/' + localCountTotal + '=' + (localCountDeleted / localCountTotal))
    if (localCountTotal > 5 && localCountDeleted / localCountTotal > 0.5) {
      const failsafe = this.server.getData().failsafe
      if (failsafe !== false || typeof failsafe === 'undefined') {
        throw new FailsafeError(Math.ceil((localCountDeleted / localCountTotal) * 100))
      }
    }
  }

  filterOutUnacceptedBookmarks(tree: Folder): void {
    tree.children = tree.children.filter(child => {
      if (child instanceof Bookmark) {
        return this.server.acceptsBookmark(child)
      } else {
        this.filterOutUnacceptedBookmarks(child)
        return true
      }
    })
  }

  filterOutInvalidBookmarks(tree: Folder): void {
    if (this.isFirefox) {
      tree.children = tree.children.filter(child => {
        if (child instanceof Bookmark) {
          return !child.url.startsWith('chrome')
        } else {
          this.filterOutInvalidBookmarks(child)
          return true
        }
      })
    }
  }

  async filterOutDuplicatesInTheSameFolder(tree: Folder): Promise<void> {
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

  async getDiffs():Promise<{localDiff:Diff, serverDiff:Diff}> {
    const mappingsSnapshot = this.mappings.getSnapshot()

    const newMappings = []

    // if we have the cache available, Diff cache and both trees
    const localScanner = new Scanner(
      this.cacheTreeRoot,
      this.localTreeRoot,
      (oldItem, newItem) =>
        (oldItem.type === newItem.type && String(oldItem.id) === String(newItem.id)),
      this.preserveOrder
    )
    const serverScanner = new Scanner(
      this.cacheTreeRoot,
      this.serverTreeRoot,
      // We also allow canMergeWith here, because e.g. for NextcloudFolders the id of moved bookmarks changes (because their id is "<bookmarkID>;<folderId>")
      (oldItem, newItem) => {
        if ((oldItem.type === newItem.type && String(mappingsSnapshot.LocalToServer[oldItem.type][oldItem.id]) === String(newItem.id)) || (oldItem.type === 'bookmark' && oldItem.canMergeWith(newItem))) {
          newMappings.push([oldItem, newItem])
          return true
        }
        return false
      },
      this.preserveOrder
    )
    Logger.log('Calculating diffs for local and server trees relative to cache tree')
    const [localDiff, serverDiff] = await Promise.all([localScanner.run(), serverScanner.run()])
    await Promise.all(newMappings.map(([localItem, serverItem]) => this.addMapping(this.server, localItem, serverItem.id)))
    return {localDiff, serverDiff}
  }

  removeItemFromReorders(mappingsSnapshot: MappingSnapshot, sourceReorders:ReorderAction[], oldItem: TItem) {
    const parentReorder = sourceReorders.find(action => Mappings.mapParentId(mappingsSnapshot, action.payload, oldItem.location) === oldItem.parentId)
    if (!parentReorder) {
      return
    }
    parentReorder.order = parentReorder.order.filter(item => !(item.type === oldItem.type && Mappings.mapId(mappingsSnapshot, oldItem, parentReorder.payload.location) === item.id))
  }

  async reconcileDiffs(sourceDiff:Diff, targetDiff:Diff, targetLocation: TItemLocation):Promise<Diff> {
    Logger.log('Reconciling diffs to prepare a plan for ' + targetLocation)
    const mappingsSnapshot = this.mappings.getSnapshot()

    const targetCreations = targetDiff.getActions(ActionType.CREATE).map(a => a as CreateAction)
    const targetRemovals = targetDiff.getActions(ActionType.REMOVE).map(a => a as RemoveAction)
    const targetMoves = targetDiff.getActions(ActionType.MOVE).map(a => a as MoveAction)
    const targetUpdates = targetDiff.getActions(ActionType.UPDATE).map(a => a as UpdateAction)
    const targetReorders = targetDiff.getActions(ActionType.REORDER).map(a => a as ReorderAction)

    const sourceCreations = sourceDiff.getActions(ActionType.CREATE).map(a => a as CreateAction)
    const sourceRemovals = sourceDiff.getActions(ActionType.REMOVE).map(a => a as RemoveAction)
    const sourceMoves = sourceDiff.getActions(ActionType.MOVE).map(a => a as MoveAction)
    const sourceReorders = sourceDiff.getActions(ActionType.REORDER).map(a => a as ReorderAction)

    const targetTree = targetLocation === ItemLocation.LOCAL ? this.localTreeRoot : this.serverTreeRoot
    const sourceTree = targetLocation === ItemLocation.LOCAL ? this.serverTreeRoot : this.localTreeRoot

    const allCreateAndMoveActions = targetDiff.getActions()
      .filter(a => a.type === ActionType.CREATE || a.type === ActionType.MOVE)
      .map(a => a as CreateAction|MoveAction)
      .concat(
        sourceDiff.getActions()
          .filter(a => a.type === ActionType.CREATE || a.type === ActionType.MOVE)
          .map(a => a as CreateAction|MoveAction)
      )

    const avoidTargetReorders = {}

    // Prepare target plan
    const targetPlan = new Diff() // to be mapped
    await Parallel.each(sourceDiff.getActions(), async(action:Action) => {
      if (action.type === ActionType.REMOVE) {
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
      }
      if (action.type === ActionType.CREATE) {
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
        const concurrentRemoval = targetRemovals.find(targetRemoval =>
          // target removal removed this creation's target (via some chain)
          Diff.findChain(mappingsSnapshot, allCreateAndMoveActions, sourceTree, action.payload, targetRemoval)
        )
        if (concurrentRemoval) {
          avoidTargetReorders[action.payload.parentId] = true
          // Already deleted on target, do nothing.
          return
        }
      }
      if (action.type === ActionType.MOVE) {
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
            targetPlan.commit({ ...action, type: ActionType.REMOVE, payload: action.oldItem, oldItem: null })
            this.removeItemFromReorders(mappingsSnapshot, sourceReorders, action.oldItem)
            avoidTargetReorders[action.payload.id] = true
            // }
          }
          return
        }
        if (concurrentSourceTargetRemoval) {
          // target already deleted by a source REMOVE (connected via source MOVE|CREATEs)
          if (targetLocation !== this.masterLocation) {
            targetPlan.commit({ ...action, type: ActionType.REMOVE, payload: action.oldItem, oldItem: null })
          }
          this.removeItemFromReorders(mappingsSnapshot, sourceReorders, action.oldItem)
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
              targetPlan.commit({ ...action, type: ActionType.CREATE, oldItem: null, payload: newPayload })
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
            targetPlan.commit(action)

            concurrentHierarchyReversals.forEach(a => {
              // moved sourcely but moved in reverse hierarchical order on target
              const payload = a.oldItem.clone(false, targetLocation === ItemLocation.LOCAL ? ItemLocation.SERVER : ItemLocation.LOCAL) // we don't map here as we want this to look like a source action
              const oldItem = a.payload.clone(false, action.payload.location)
              oldItem.id = Mappings.mapId(mappingsSnapshot, a.payload, action.payload.location)
              oldItem.parentId = Mappings.mapParentId(mappingsSnapshot, a.payload, action.payload.location)

              if (
                // Don't create duplicates!
                targetPlan.getActions(ActionType.MOVE).find(move => String(move.payload.id) === String(payload.id)) ||
                sourceDiff.getActions(ActionType.MOVE).find(move => String(move.payload.id) === String(payload.id)) ||
                // Don't move back into removed territory
                targetRemovals.find(remove => Diff.findChain(mappingsSnapshot, allCreateAndMoveActions, sourceTree, action.payload, remove)) ||
                sourceRemovals.find(remove => Diff.findChain(mappingsSnapshot, allCreateAndMoveActions, targetTree, action.payload, remove))
              ) {
                return
              }

              // revert target move
              targetPlan.commit({ ...a, payload, oldItem })
              this.removeItemFromReorders(mappingsSnapshot, sourceReorders, payload)
              this.removeItemFromReorders(mappingsSnapshot, sourceReorders, oldItem)
            })
          } else {
            this.removeItemFromReorders(mappingsSnapshot, sourceReorders, action.oldItem)
            this.removeItemFromReorders(mappingsSnapshot, sourceReorders, action.payload)
          }
          return
        }
      }

      if (action.type === ActionType.UPDATE) {
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
      }

      if (action.type === ActionType.REORDER) {
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
      }

      targetPlan.commit(action)
    })

    return targetPlan
  }

  async execute(resource:TResource, plan:Diff, targetLocation:TItemLocation, donePlan: Diff = null, isSubPlan = false):Promise<Diff> {
    Logger.log('Executing plan for ' + targetLocation)
    const run = (action) => this.executeAction(resource, action, targetLocation, plan, donePlan)
    let mappedPlan

    if (isSubPlan || ((targetLocation === ItemLocation.LOCAL && !this.flagLocalPostMoveMapping) || (targetLocation === ItemLocation.SERVER && !this.flagServerPostMoveMapping))) {
      Logger.log(targetLocation + ': executing CREATEs and UPDATEs')
      await Parallel.each(plan.getActions().filter(action => action.type === ActionType.CREATE || action.type === ActionType.UPDATE), run)

      if (this.canceled) {
        throw new CancelledSyncError()
      }

      const mappingsSnapshot = this.mappings.getSnapshot()
      Logger.log(targetLocation + ': mapping MOVEs')
      mappedPlan = plan.map(mappingsSnapshot, targetLocation, (action) => action.type === ActionType.MOVE)

      if (!isSubPlan) {
        if (targetLocation === ItemLocation.LOCAL) {
          this.localPlan = mappedPlan
          this.flagLocalPostMoveMapping = true
        } else {
          this.serverPlan = mappedPlan
          this.flagServerPostMoveMapping = true
        }
      }
    } else {
      mappedPlan = plan
    }

    if (this.canceled) {
      throw new CancelledSyncError()
    }

    const batches = Diff.sortMoves(mappedPlan.getActions(ActionType.MOVE), targetLocation === ItemLocation.SERVER ? this.serverTreeRoot : this.localTreeRoot)

    Logger.log(targetLocation + ': executing MOVEs')
    await Parallel.each(batches, batch => Parallel.each(batch, run), 1)

    if (this.canceled) {
      throw new CancelledSyncError()
    }

    Logger.log(targetLocation + ': executing REMOVEs')
    await Parallel.each(plan.getActions(ActionType.REMOVE), run)

    return mappedPlan
  }

  async executeAction(resource:TResource, action:Action, targetLocation:TItemLocation, plan: Diff, donePlan: Diff = null):Promise<void> {
    // defer execution of actions to allow the this.canceled check below to work when cancelling in interrupt tests
    await new Promise((resolve) => setTimeout(resolve, 0))
    Logger.log('Executing action ', action)
    const item = action.payload
    const done = () => {
      plan.retract(action)
      // TODO: This is kind of a hack :/
      if (targetLocation === ItemLocation.LOCAL) {
        this.localPlan && this.localPlan.retract(action)
      } else {
        this.localPlan && this.serverPlan.retract(action)
      }
      if ('revertPlan' in this) {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        this.revertPlan.retract(action)
      }
      if (donePlan) {
        donePlan.commit(action)
      }
      this.updateProgress()
    }

    if (this.canceled) {
      throw new CancelledSyncError()
    }

    if (action.type === ActionType.REMOVE) {
      await action.payload.visitRemove(resource)
      await this.removeMapping(resource, item)
      done()
      return
    }

    if (action.type === ActionType.CREATE) {
      const id = await action.payload.visitCreate(resource)
      if (typeof id === 'undefined') {
        // undefined means we couldn't create the item. we're ignoring it
        done()
        return
      }
      item.id = id
      if (action.oldItem) {
        await this.addMapping(resource, action.oldItem, id)
      }

      if (item instanceof Folder && ((action.payload instanceof Folder && action.payload.children.length) || (action.oldItem instanceof Folder && action.oldItem.children.length))) {
        if ('bulkImportFolder' in resource) {
          try {
            // Try bulk import
            const imported = await resource.bulkImportFolder(item.id, (action.oldItem || action.payload) as Folder)
            const newMappings = []
            const subScanner = new Scanner(
              action.oldItem || action.payload,
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
            await Parallel.each(newMappings, async([oldItem, newId]) => {
              await this.addMapping(resource, oldItem, newId)
            })

            done()
            return
          } catch (e) {
            Logger.log('Bulk import failed, continuing with normal creation', e)
          }
        }

        // Create a sub plan
        if (action.oldItem && action.oldItem instanceof Folder) {
          const subPlan = new Diff
          action.oldItem.children.forEach((child) => {
            const newAction : Action = { type: ActionType.CREATE, payload: child }
            subPlan.commit(newAction)
            plan.commit(newAction)
          })
          const mappingsSnapshot = this.mappings.getSnapshot()
          const mappedSubPlan = subPlan.map(mappingsSnapshot, targetLocation)
          Logger.log('executing sub plan')
          await this.execute(resource, mappedSubPlan, targetLocation, null, true)

          if ('orderFolder' in resource && item.children.length > 1) {
            // Order created items after the fact, as they've been created concurrently
            plan.commit({
              type: ActionType.REORDER,
              oldItem: action.payload,
              payload: action.oldItem,
              order: action.oldItem.children.map(i => ({ type: i.type, id: i.id }))
            })
          }
        }
      }

      done()

      return
    }

    if (action.type === ActionType.UPDATE || action.type === ActionType.MOVE) {
      await action.payload.visitUpdate(resource)
      await this.addMapping(resource, action.oldItem, item.id)
      done()
    }
  }

  reconcileReorderings(targetTreePlan: Diff, sourceTreePlan: Diff, mappingSnapshot: MappingSnapshot) : Diff {
    Logger.log('Reconciling reorders to create a plan')
    const newPlan = new Diff
    targetTreePlan
      .getActions(ActionType.REORDER)
      .map(a => a as ReorderAction)
    // MOVEs have oldItem from cacheTree and payload now mapped to their corresponding target tree
    // REORDERs have payload in source tree
      .forEach(oldReorderAction => {
        // clone action
        const reorderAction = {...oldReorderAction, order: oldReorderAction.order.slice()}

        const removed = sourceTreePlan.getActions(ActionType.REMOVE)
          .filter(removal => removal.payload.findItem(reorderAction.payload.type, removal.payload.id))
        if (removed.length) {
          return
        }

        // Find Away-moves
        const childAwayMoves = sourceTreePlan.getActions(ActionType.MOVE)
          .filter(move =>
            (String(reorderAction.payload.id) !== String(move.payload.parentId) && // reorder IDs are from localTree (source of this plan), move.oldItem IDs are from server tree (source of other plan)
                reorderAction.order.find(item => String(item.id) === String(move.payload.id) && item.type === move.payload.type))// move.payload IDs are from localTree (target of the other plan
          )

        // Find removals
        const concurrentRemovals = sourceTreePlan.getActions(ActionType.REMOVE)
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
        const concurrentCreations = sourceTreePlan.getActions(ActionType.CREATE)
          .map(a => a as CreateAction)
          .filter(creation => String(reorderAction.payload.id) === String(creation.payload.parentId))
        concurrentCreations
          .forEach(a => {
            Logger.log('ReconcileReorders: Inserting created item into order', {creation: a, reorder: reorderAction})
            reorderAction.order.splice(a.index, 0, { type: a.payload.type, id: a.payload.id })
          })

        // Find and insert moves at move target
        const moves = sourceTreePlan.getActions(ActionType.MOVE)
          .map(a => a as MoveAction)
          .filter(move =>
            String(reorderAction.payload.id) === String(move.payload.parentId) &&
                  !reorderAction.order.find(item => String(item.id) === String(move.payload.id) && item.type === move.payload.type)
          )
        moves.forEach(a => {
          Logger.log('ReconcileReorders: Inserting moved item into order', {move: a, reorder: reorderAction})
          reorderAction.order.splice(a.index, 0, { type: a.payload.type, id: a.payload.id })
        })

        newPlan.commit(reorderAction)
      })
    return newPlan
  }

  async executeReorderings(resource:OrderFolderResource, reorderings:Diff):Promise<void> {
    Logger.log('Executing reorderings')
    Logger.log({ reorderings })

    await Parallel.each(reorderings.getActions(ActionType.REORDER).map(a => a as ReorderAction), async(action) => {
      Logger.log('Executing reorder action', action)
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
    })
  }

  async addMapping(resource:TResource, item:TItem, newId:string|number):Promise<void> {
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

  async removeMapping(resource:TResource, item:TItem):Promise<void> {
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

  async loadChildren(serverItem:TItem, mappingsSnapshot:MappingSnapshot):Promise<void> {
    if (this.canceled) {
      throw new CancelledSyncError()
    }
    if (!(serverItem instanceof Folder)) return
    if (!('loadFolderChildren' in this.server)) return
    let localItem, cacheItem
    if (serverItem === this.serverTreeRoot) {
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
      this.actionsDone += localItem.count()
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
      child => this.loadChildren(child, mappingsSnapshot)
    )
  }

  async folderHasChanged(localItem: TItem, cacheItem: TItem, serverItem: TItem):Promise<boolean> {
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

  filterOutUnmappedItems(tree: Folder, mapping: MappingSnapshot) {
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

  toJSON(): ISerializedSyncProcess {
    return {
      strategy: 'default',
      localTreeRoot: this.localTreeRoot && this.localTreeRoot.clone(false),
      cacheTreeRoot: this.cacheTreeRoot && this.cacheTreeRoot.clone(false),
      serverTreeRoot: this.serverTreeRoot && this.serverTreeRoot.clone(false),
      localPlan: this.localPlan && this.localPlan.toJSON(),
      doneLocalPlan: this.doneLocalPlan && this.doneLocalPlan.toJSON(),
      serverPlan: this.serverPlan && this.serverPlan.toJSON(),
      doneServerPlan: this.doneServerPlan && this.doneServerPlan.toJSON(),
      serverReorderPlan: this.serverReorderPlan && this.serverReorderPlan.toJSON(),
      localReorderPlan: this.localReorderPlan && this.localReorderPlan.toJSON(),
      actionsDone: this.actionsDone,
      actionsPlanned: this.actionsPlanned,
      flagLocalPostMoveMapping: this.flagLocalPostMoveMapping,
      flagLocalPostReorderReconciliation: this.flagLocalPostReorderReconciliation,
      flagServerPostMoveMapping: this.flagServerPostMoveMapping,
      flagPostReorderReconciliation: this.flagPostReorderReconciliation
    }
  }

  static async fromJSON(mappings:Mappings,
    localTree:TLocalTree,
    server:TAdapter,
    progressCb:(progress:number)=>void,
    json: any) {
    let strategy: SyncProcess
    let MergeSyncProcess: typeof SyncProcess
    let UnidirectionalSyncProcess: typeof SyncProcess
    switch (json.strategy) {
      case 'default':
        strategy = new SyncProcess(mappings, localTree, server, progressCb)
        break
      case 'merge':
        MergeSyncProcess = (await import('./Merge')).default
        strategy = new MergeSyncProcess(mappings, localTree, server, progressCb)
        break
      case 'unidirectional':
        UnidirectionalSyncProcess = (await import('./Unidirectional')).default
        strategy = new UnidirectionalSyncProcess(mappings, localTree, server, progressCb)
        break
      default:
        throw new Error('Unknown strategy: ' + json.strategy)
    }
    strategy.setProgress(json)
    strategy.setState(json)
    return strategy
  }
}

export interface ISerializedSyncProcess {
  strategy: 'default' | 'merge' | 'unidirectional'
  [k: string]: any
}
