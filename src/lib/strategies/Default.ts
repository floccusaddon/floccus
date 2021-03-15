import { Bookmark, Folder, TItem, ItemType, ItemLocation, TItemLocation } from '../Tree'
import Logger from '../Logger'
import browser from '../browser-api'
import Diff, { Action, ActionType, CreateAction, MoveAction, RemoveAction, ReorderAction, UpdateAction } from '../Diff'
import Scanner from '../Scanner'
import * as Parallel from 'async-parallel'
import { throttle } from 'throttle-debounce'
import Mappings, { MappingSnapshot } from '../Mappings'
import LocalTree from '../LocalTree'
import TResource, { OrderFolderResource } from '../interfaces/Resource'
import { TAdapter } from '../interfaces/Adapter'

export default class SyncProcess {
  protected mappings: Mappings
  protected localTree: LocalTree
  protected server: TAdapter
  protected cacheTreeRoot: Folder
  protected canceled: boolean
  protected preserveOrder: boolean
  protected progressCb: (progress:number)=>void
  protected localTreeRoot: Folder
  protected serverTreeRoot: Folder
  protected actionsDone: number
  protected actionsPlanned: number

  // The location that has precedence in case of conflicts
  protected masterLocation: TItemLocation

  constructor(
    mappings:Mappings,
    localTree:LocalTree,
    cacheTreeRoot:Folder,
    server:TAdapter,
    progressCb:(progress:number)=>void
  ) {
    this.mappings = mappings
    this.localTree = localTree
    this.server = server
    this.cacheTreeRoot = cacheTreeRoot

    this.preserveOrder = 'orderFolder' in this.server

    this.progressCb = throttle(250, true, progressCb) as (progress:number)=>void
    this.actionsDone = 0
    this.actionsPlanned = 0
    this.canceled = false
  }

  async cancel() :Promise<void> {
    this.canceled = true
  }

  updateProgress():void {
    this.actionsDone++
    this.progressCb(
      Math.min(
        1,
        this.actionsDone / (this.actionsPlanned + 1)
      )
    )
  }

  async sync(): Promise<void> {
    this.masterLocation = ItemLocation.LOCAL
    await this.prepareSync()

    const {localDiff, serverDiff} = await this.getDiffs()
    Logger.log({localDiff, serverDiff})

    let serverPlan = await this.reconcileDiffs(localDiff, serverDiff, ItemLocation.SERVER)
    let localPlan = await this.reconcileDiffs(serverDiff, localDiff, ItemLocation.LOCAL)
    Logger.log({localPlan, serverPlan})

    Logger.log({localTreeRoot: this.localTreeRoot, serverTreeRoot: this.serverTreeRoot, cacheTreeRoot: this.cacheTreeRoot})

    this.actionsPlanned = serverPlan.getActions().length + localPlan.getActions().length

    // Weed out modifications to bookmarks root
    await this.filterOutRootFolderActions(localPlan)

    this.applyFailsafe(localPlan)

    serverPlan = await this.execute(this.server, serverPlan, ItemLocation.SERVER)
    localPlan = await this.execute(this.localTree, localPlan, ItemLocation.LOCAL)

    // mappings have been updated, reload
    const mappingsSnapshot = await this.mappings.getSnapshot()

    const localReorder = this.reconcileReorderings(localPlan, serverPlan, mappingsSnapshot)
      .map(mappingsSnapshot, ItemLocation.LOCAL)

    const serverReorder = this.reconcileReorderings(serverPlan, localPlan, mappingsSnapshot)
      .map(mappingsSnapshot, ItemLocation.SERVER)

    await this.filterOutRootFolderActions(localReorder)

    if ('orderFolder' in this.server) {
      await Promise.all([
        this.executeReorderings(this.server, serverReorder),
        this.executeReorderings(this.localTree, localReorder),
      ])
    }
  }

  protected async prepareSync() {
    this.localTreeRoot = await this.localTree.getBookmarksTree()
    this.serverTreeRoot = await this.server.getBookmarksTree()
    this.filterOutUnacceptedBookmarks(this.localTreeRoot)
    await this.filterOutDuplicatesInTheSameFolder(this.localTreeRoot)

    await this.mappings.addFolder({ localId: this.localTreeRoot.id, remoteId: this.serverTreeRoot.id })
    const mappingsSnapshot = await this.mappings.getSnapshot()

    if ('loadFolderChildren' in this.server) {
      Logger.log('Loading sparse tree as necessary')
      // Load sparse tree
      await this.loadChildren(this.serverTreeRoot, mappingsSnapshot)
    }

    // Cache tree might not have been initialized and thus have no id
    this.cacheTreeRoot.id = this.localTreeRoot.id

    // generate hash tables to find items faster
    this.localTreeRoot.createIndex()
    this.cacheTreeRoot.createIndex()
    this.serverTreeRoot.createIndex()
  }

  protected applyFailsafe(localPlan: Diff) {
    const localCountTotal = this.localTreeRoot.count()
    const localCountDeleted = localPlan.getActions(ActionType.REMOVE).reduce((count, action) => count + action.payload.count(), 0)

    if (localCountTotal > 5 && localCountDeleted / localCountTotal > 0.5) {
      const failsafe = this.server.getData().failsafe
      if (failsafe !== false || typeof failsafe === 'undefined') {
        throw new Error(browser.i18n.getMessage('Error029', [(localCountDeleted / localCountTotal) * 100]))
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
    await Promise.all(
      duplicates.map(bm => this.localTree.removeBookmark(bm))
    )
  }

  async filterOutRootFolderActions(plan: Diff):Promise<void> {
    // Weed out modifications to bookmarks root
    const absoluteRootFolder = await LocalTree.getAbsoluteRootFolder()
    plan
      .getActions()
      .filter(action => {
        return action.payload.id === absoluteRootFolder.id || action.payload.parentId === absoluteRootFolder.id
      })
      .forEach(action => {
        plan.retract(action)
      })
  }

  async getDiffs():Promise<{localDiff:Diff, serverDiff:Diff}> {
    const mappingsSnapshot = await this.mappings.getSnapshot()

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
    const [localDiff, serverDiff] = await Promise.all([localScanner.run(), serverScanner.run()])
    await Promise.all(newMappings.map(([localItem, serverItem]) => this.addMapping(this.server, localItem, serverItem.id)))
    return {localDiff, serverDiff}
  }

  async reconcileDiffs(sourceDiff:Diff, targetDiff:Diff, targetLocation: TItemLocation):Promise<Diff> {
    let mappingsSnapshot = await this.mappings.getSnapshot()

    const targetCreations = targetDiff.getActions(ActionType.CREATE).map(a => a as CreateAction)
    const targetRemovals = targetDiff.getActions(ActionType.REMOVE).map(a => a as RemoveAction)
    const targetMoves = targetDiff.getActions(ActionType.MOVE).map(a => a as MoveAction)
    const targetUpdates = targetDiff.getActions(ActionType.UPDATE).map(a => a as UpdateAction)
    const targetReorders = targetDiff.getActions(ActionType.REORDER).map(a => a as ReorderAction)

    const sourceCreations = sourceDiff.getActions(ActionType.CREATE).map(a => a as CreateAction)
    const sourceRemovals = sourceDiff.getActions(ActionType.REMOVE).map(a => a as RemoveAction)
    const sourceMoves = sourceDiff.getActions(ActionType.MOVE).map(a => a as MoveAction)

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
          Diff.findChain(mappingsSnapshot, allCreateAndMoveActions, action.payload, targetRemoval))
        if (concurrentRemoval) {
          // Already deleted on target, do nothing.
          return
        }

        const concurrentMove = targetMoves.find(targetMove =>
          action.payload.type === targetMove.payload.type && Mappings.mappable(mappingsSnapshot, action.payload, targetMove.payload)
        )
        if (concurrentMove) {
          // moved on the target, moves take precedence, do nothing (i.e. leave target version intact)
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
          Diff.findChain(mappingsSnapshot, allCreateAndMoveActions, action.payload, targetRemoval)
        )
        if (concurrentRemoval) {
          avoidTargetReorders[action.payload.parentId] = true
          // Already deleted on target, do nothing.
          return
        }
      }
      if (action.type === ActionType.MOVE) {
        // Find concurrent moves that form a hierarchy reversal together with this one
        const concurrentHierarchyReversals = targetMoves.filter(a => {
          if (action.payload.type !== ItemType.FOLDER || a.payload.type !== ItemType.FOLDER) {
            return false
          }
          let sourceFolder, targetFolder, sourceAncestors, targetAncestors
          if (action.payload.location === ItemLocation.LOCAL) {
            targetFolder = this.serverTreeRoot.findItem(ItemType.FOLDER, a.payload.id)
            sourceFolder = this.localTreeRoot.findItem(ItemType.FOLDER, action.payload.id)

            sourceAncestors = Folder.getAncestorsOf(this.localTreeRoot.findItem(ItemType.FOLDER, action.payload.parentId), this.localTreeRoot)
            targetAncestors = Folder.getAncestorsOf(this.serverTreeRoot.findItem(ItemType.FOLDER, a.payload.parentId), this.serverTreeRoot)
          } else {
            sourceFolder = this.serverTreeRoot.findItem(ItemType.FOLDER, action.payload.id)
            targetFolder = this.localTreeRoot.findItem(ItemType.FOLDER, a.payload.id)

            targetAncestors = Folder.getAncestorsOf(this.localTreeRoot.findItem(ItemType.FOLDER, a.payload.parentId), this.localTreeRoot)
            sourceAncestors = Folder.getAncestorsOf(this.serverTreeRoot.findItem(ItemType.FOLDER, action.payload.parentId), this.serverTreeRoot)
          }

          // If both items are folders, and one of the ancestors of one item is a child of the other item
          return sourceAncestors.find(ancestor => targetFolder.findItem(ItemType.FOLDER, Mappings.mapId(mappingsSnapshot, ancestor, targetFolder.location))) &&
            targetAncestors.find(ancestor => sourceFolder.findItem(ItemType.FOLDER, Mappings.mapId(mappingsSnapshot, ancestor, sourceFolder.location)))
        })
        if (concurrentHierarchyReversals.length) {
          if (targetLocation !== this.masterLocation) {
            concurrentHierarchyReversals.forEach(a => {
              // moved sourcely but moved in reverse hierarchical order on target
              const payload = a.oldItem.clone() // we don't map here as we want this to look like a source action
              const oldItem = a.payload.clone()
              oldItem.id = Mappings.mapId(mappingsSnapshot, oldItem, action.payload.location)
              oldItem.parentId = Mappings.mapParentId(mappingsSnapshot, oldItem, action.payload.location)

              if (
                // Don't create duplicates!
                targetPlan.getActions(ActionType.MOVE).find(move => move.payload.id === payload.id) ||
                sourceDiff.getActions(ActionType.MOVE).find(move => move.payload.id === payload.id) ||
                // Don't move back into removed territory
                targetDiff.getActions(ActionType.REMOVE).find(move => move.payload.findItem(payload.type, payload.parentId))
              ) {
                return
              }

              // revert target move
              targetPlan.commit({ ...a, payload, oldItem })
              avoidTargetReorders[payload.parentId] = true
              avoidTargetReorders[oldItem.parentId] = true
            })
            targetPlan.commit(action)
          } else {
            // Moved sourcely and in reverse hierarchical order on target. source has precedence: do nothing sourcely
            avoidTargetReorders[action.payload.parentId] = true
            avoidTargetReorders[Mappings.mapParentId(mappingsSnapshot, action.oldItem, ItemLocation.SERVER)] = true
          }
          return
        }
        // FInd out if there's a removal in the target diff which already deletes this item (via some chain of MOVE|CREATEs)
        const complexTargetTargetRemoval = targetRemovals.find(targetRemoval => {
          return Diff.findChain(mappingsSnapshot, allCreateAndMoveActions, action.payload, targetRemoval)
        })
        const concurrentTargetOriginRemoval = targetRemovals.find(targetRemoval =>
          (action.payload.type === targetRemoval.payload.type && Mappings.mappable(mappingsSnapshot, action.payload, targetRemoval.payload)) ||
            Diff.findChain(mappingsSnapshot, allCreateAndMoveActions, action.oldItem, targetRemoval)
        )
        const concurrentSourceOriginRemoval = sourceRemovals.find(sourceRemoval => {
          return Diff.findChain(mappingsSnapshot, allCreateAndMoveActions, action.oldItem, sourceRemoval)
        })
        const concurrentSourceTargetRemoval = sourceRemovals.find(sourceRemoval =>
          Diff.findChain(mappingsSnapshot, allCreateAndMoveActions, action.payload, sourceRemoval)
        )
        if (complexTargetTargetRemoval) {
          // target already deleted by a target|source REMOVE (connected via source MOVE|CREATEs)
          if (!concurrentTargetOriginRemoval && !concurrentSourceOriginRemoval) {
            // make sure this item is not already being removed, when it's no longer moved
            targetPlan.commit({ ...action, type: ActionType.REMOVE, payload: action.oldItem, oldItem: null })
            avoidTargetReorders[action.payload.id] = true
          }
          return
        }
        if (concurrentSourceTargetRemoval && targetLocation === this.masterLocation) { // No idea why this works
          // target already deleted by a source REMOVE (connected via source MOVE|CREATEs)
          avoidTargetReorders[action.payload.parentId] = true
          avoidTargetReorders[action.payload.id] = true
          return
        }
        if (concurrentTargetOriginRemoval) {
          // moved sourcely but removed on the target, recreate it on the target
          const originalCreation = sourceCreations.find(creation => creation.payload.findItem(ItemType.FOLDER, action.payload.parentId))

          // Remove subitems that have been (re)moved already by other actions
          const newPayload = action.payload.clone()
          if (newPayload.type === ItemType.FOLDER) {
            newPayload.traverse((item, folder) => {
              const extracted = sourceRemovals.find(a => Mappings.mappable(mappingsSnapshot, item, a.payload)) ||
                sourceMoves.find(a => Mappings.mappable(mappingsSnapshot, item, a.payload))
              if (extracted) {
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
          return
        }

        if (targetLocation === this.masterLocation) {
          const concurrentMove = targetMoves.find(a =>
            action.payload.type === a.payload.type && Mappings.mappable(mappingsSnapshot, action.payload, a.payload))
          if (concurrentMove) {
            // Moved both on target and sourcely, source has precedence: do nothing sourcely
            return
          }
        }
      }

      if (action.type === ActionType.UPDATE && targetLocation === this.masterLocation) {
        const concurrentUpdate = targetUpdates.find(a =>
          action.payload.type === a.payload.type && Mappings.mappable(mappingsSnapshot, action.payload, a.payload))
        if (concurrentUpdate) {
          // Updated both on target and sourcely, source has precedence: do nothing sourcely
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

    // Map payloads
    mappingsSnapshot = await this.mappings.getSnapshot() // Necessary because of concurrent creation reconciliation
    const mappedTargetPlan = targetPlan.map(mappingsSnapshot, targetLocation, (action) => action.type !== ActionType.REORDER && action.type !== ActionType.MOVE)

    return mappedTargetPlan
  }

  async execute(resource:TResource, plan:Diff, targetLocation:TItemLocation):Promise<Diff> {
    const run = (action) => this.executeAction(resource, action, targetLocation)

    await Parallel.each(plan.getActions().filter(action => action.type === ActionType.CREATE || action.type === ActionType.UPDATE), run)
    const mappingsSnapshot = await this.mappings.getSnapshot()
    const mappedPlan = plan.map(mappingsSnapshot, targetLocation, (action) => action.type === ActionType.MOVE)
    const batches = Diff.sortMoves(mappedPlan.getActions(ActionType.MOVE), targetLocation === ItemLocation.SERVER ? this.serverTreeRoot : this.localTreeRoot)
    await Parallel.each(batches, batch => Promise.all(batch.map(run)), 1)
    await Parallel.each(plan.getActions(ActionType.REMOVE), run)

    return mappedPlan
  }

  async executeAction(resource:TResource, action:Action, targetLocation:TItemLocation):Promise<void> {
    const item = action.payload

    if (this.canceled) {
      throw new Error(browser.i18n.getMessage('Error027'))
    }

    if (action.type === ActionType.REMOVE) {
      await action.payload.visitRemove(resource)
      await this.removeMapping(resource, item)
      this.updateProgress()
      return
    }

    if (action.type === ActionType.CREATE) {
      const id = await action.payload.visitCreate(resource)
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
              item,
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

            this.updateProgress()
            return
          } catch (e) {
            Logger.log('Bulk import failed, continuing with normal creation', e)
          }
        }

        // Create a sub plan
        if (action.oldItem && action.oldItem instanceof Folder) {
          const subPlan = new Diff
          action.oldItem.children.forEach((child) => subPlan.commit({ type: ActionType.CREATE, payload: child }))
          let mappingsSnapshot = await this.mappings.getSnapshot()
          const mappedSubPlan = subPlan.map(mappingsSnapshot, targetLocation)
          await this.execute(resource, mappedSubPlan, targetLocation)

          if (item.children.length > 1) {
            // Order created items after the fact, as they've been created concurrently
            const subOrder = new Diff()
            subOrder.commit({
              type: ActionType.REORDER,
              oldItem: action.payload,
              payload: action.oldItem,
              order: item.children.map(i => ({ type: i.type, id: i.id }))
            })
            mappingsSnapshot = await this.mappings.getSnapshot()
            const mappedOrder = subOrder.map(mappingsSnapshot, targetLocation)
            if ('orderFolder' in resource) {
              await this.executeReorderings(resource, mappedOrder)
            }
          }
        }
      }

      this.updateProgress()

      return
    }

    if (action.type === ActionType.UPDATE || action.type === ActionType.MOVE) {
      await action.payload.visitUpdate(resource)
      await this.addMapping(resource, action.oldItem, item.id)
      this.updateProgress()
    }
  }

  reconcileReorderings(targetTreePlan: Diff, sourceTreePlan: Diff, mappingSnapshot: MappingSnapshot) : Diff {
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
    Logger.log({ reorderings })

    await Parallel.each(reorderings.getActions(ActionType.REORDER).map(a => a as ReorderAction), async(action) => {
      const item = action.payload

      if (this.canceled) {
        throw new Error(browser.i18n.getMessage('Error027'))
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
      throw new Error(browser.i18n.getMessage('Error027'))
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
    const children = await this.server.loadFolderChildren(serverItem.id)
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
    const mappingsSnapshot = await this.mappings.getSnapshot()
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
      (cacheItem && localItem.parentId !== cacheItem.parentId)
    const changedUpstream =
      (cacheHash !== serverHash) ||
      (cacheItem &&
        cacheItem.parentId !==
        mappingsSnapshot.ServerToLocal.folder[serverItem.parentId])
    return changedLocally || changedUpstream || reconciled
  }
}
