import { Folder, ItemLocation, ItemType, TItem, TItemLocation, TOppositeLocation } from '../Tree'
import Diff, { CreateAction, MoveAction, PlanStage1 } from '../Diff'
import Scanner, { ScanResult } from '../Scanner'
import * as Parallel from 'async-parallel'
import DefaultSyncProcess, { ISerializedSyncProcess } from './Default'
import Mappings from '../Mappings'
import Logger from '../Logger'

const ACTION_CONCURRENCY = 12

export default class MergeSyncProcess extends DefaultSyncProcess {
  async getDiffs():Promise<{localScanResult:ScanResult<typeof ItemLocation.LOCAL, TItemLocation>, serverScanResult:ScanResult<typeof ItemLocation.SERVER, TItemLocation>}> {
    // If there's no cache, diff the two trees directly
    const newMappings: TItem<TItemLocation>[][] = []
    const localScanner = new Scanner(
      this.serverTreeRoot,
      this.localTreeRoot,
      (serverItem, localItem) => {
        if (localItem.type === serverItem.type && serverItem.canMergeWith(localItem)) {
          newMappings.push([localItem, serverItem])
          return true
        }
        return false
      },
      this.hashSettings,
      false,
      false
    )
    const serverScanner = new Scanner(
      this.localTreeRoot,
      this.serverTreeRoot,
      (localItem, serverItem) => {
        if (serverItem.type === localItem.type && serverItem.canMergeWith(localItem)) {
          newMappings.push([localItem, serverItem])
          return true
        }
        return false
      },
      this.hashSettings,
      false,
      false
    )
    const localScanResult = await localScanner.run()
    const serverScanResult = await serverScanner.run()
    await Parallel.map(newMappings, ([localItem, serverItem]) => {
      return this.addMapping(this.server, localItem, serverItem.id)
    }, 10)

    return {localScanResult, serverScanResult}
  }

  // This is a copy of DefaultSyncProcess#reconcileDiffs without anything involving REMOVEs
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

    const findChainCacheForCreations = {}
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
          this.hashSettings,
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
            DefaultSyncProcess.removeItemFromReorders(mappingsSnapshot, sourceScanResult.REORDER, payload)
            DefaultSyncProcess.removeItemFromReorders(mappingsSnapshot, sourceScanResult.REORDER, oldItem)
          })
        } else {
          DefaultSyncProcess.removeItemFromReorders(mappingsSnapshot, sourceScanResult.REORDER, action.oldItem)
          DefaultSyncProcess.removeItemFromReorders(mappingsSnapshot, sourceScanResult.REORDER, action.payload)
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

      if (targetLocation !== this.masterLocation) {
        const concurrentReorder = targetReorders.find(a =>
          action.payload.type === a.payload.type && Mappings.mappable(mappingsSnapshot, action.payload, a.payload))
        if (concurrentReorder) {
          return
        }
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
    })

    return targetPlan
  }

  async loadChildren(serverTreeRoot: Folder<typeof ItemLocation.SERVER>):Promise<void> {
    Logger.log('Merge strategy: Load complete tree from server')
    serverTreeRoot.children = (await this.server.getBookmarksTree(true)).children
  }

  toJSON(): ISerializedSyncProcess {
    return {
      ...DefaultSyncProcess.prototype.toJSON.apply(this),
      strategy: 'merge'
    }
  }
}
