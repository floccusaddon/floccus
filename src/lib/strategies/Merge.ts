import { Folder, ItemLocation, TItem, TItemLocation, TOppositeLocation } from '../Tree'
import Diff, { CreateAction, MoveAction, PlanStage1, PlanStage3, ReorderAction } from '../Diff'
import Scanner, { ScanResult } from '../Scanner'
import * as Parallel from 'async-parallel'
import DefaultSyncProcess, { ISerializedSyncProcess } from './Default'
import Mappings, { MappingSnapshot } from '../Mappings'
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
      this.preserveOrder,
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
      this.preserveOrder,
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

  async reconcileDiffs<L1 extends TItemLocation, L2 extends TItemLocation, L3 extends TItemLocation>(
    sourceScanResult:ScanResult<L1, L2>,
    targetScanResult:ScanResult<TOppositeLocation<L1>, L3>,
    targetLocation: TOppositeLocation<L1>
  ): Promise<PlanStage1<L1, L2>> {
    const mappingsSnapshot = this.mappings.getSnapshot()

    const targetCreations = targetScanResult.CREATE.getActions()
    const targetMoves = targetScanResult.MOVE.getActions()

    const sourceMoves = sourceScanResult.MOVE.getActions()
    const sourceUpdates = sourceScanResult.UPDATE.getActions()

    const targetTree = this.getTargetTree(targetLocation)
    const sourceTree = this.getTargetTree(targetLocation === ItemLocation.LOCAL ? ItemLocation.SERVER : ItemLocation.LOCAL) as Folder<L1>

    const allCreateAndMoveActions = (sourceScanResult.CREATE.getActions() as Array<CreateAction<L1, L2> | MoveAction<L1, L2> | CreateAction<TOppositeLocation<L1>, L3> | MoveAction<TOppositeLocation<L1>, L3>>)
      .concat(sourceScanResult.MOVE.getActions())
      .concat(targetScanResult.CREATE.getActions())
      .concat(targetScanResult.MOVE.getActions())

    // Prepare target plan
    const targetPlan: PlanStage1<L1, L2> = {
      CREATE: new Diff(),
      UPDATE: new Diff(),
      MOVE: new Diff(),
      REMOVE: new Diff(),
      REORDER: new Diff(),
    }

    await Parallel.each(sourceScanResult.CREATE.getActions(), async(action) => {
      const concurrentCreation = targetCreations.find(a =>
        a.payload.parentId === Mappings.mapParentId(mappingsSnapshot, action.payload, a.payload.location) &&
        action.payload.canMergeWith(a.payload))
      if (concurrentCreation) {
        // created on both the server and locally, try to reconcile
        const newMappings = []
        const subScanner = new Scanner(
          concurrentCreation.payload, // server tree
          action.payload, // local tree
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

      targetPlan.CREATE.commit(action)
    }, ACTION_CONCURRENCY)

    await Parallel.each(sourceScanResult.MOVE.getActions(), async(action) => {
      if (targetLocation === ItemLocation.LOCAL) {
        const concurrentMove = sourceMoves.find(a =>
          (action.payload.type === a.payload.type && Mappings.mappable(mappingsSnapshot, action.payload, a.payload)) ||
          (action.payload.type === 'bookmark' && action.payload.canMergeWith(a.payload))
        )
        if (concurrentMove) {
          // Moved both on server and locally, local has precedence: do nothing locally
          return
        }
      }
      // Find concurrent moves that form a hierarchy reversal together with this one
      const concurrentHierarchyReversals = targetMoves.filter(targetMove => {
        return Diff.findChain(mappingsSnapshot, allCreateAndMoveActions, sourceTree, action.payload, targetMove) &&
          Diff.findChain(mappingsSnapshot, allCreateAndMoveActions, targetTree, targetMove.payload, action)
      })
      if (concurrentHierarchyReversals.length) {
        if (targetLocation === ItemLocation.SERVER) {
          concurrentHierarchyReversals.forEach(a => {
            // moved locally but moved in reverse hierarchical order on server
            const payload = a.oldItem.cloneWithLocation(false, action.payload.location) // we don't map here as we want this to look like a local action
            const oldItem = a.payload.cloneWithLocation(false, action.oldItem.location)
            oldItem.id = Mappings.mapId(mappingsSnapshot, oldItem, action.payload.location)
            oldItem.parentId = Mappings.mapParentId(mappingsSnapshot, oldItem, action.payload.location)

            if (
              targetPlan.MOVE.getActions().find(move => String(move.payload.id) === String(payload.id)) ||
              sourceMoves.find(move => String(move.payload.id) === String(payload.id))
            ) {
              // Don't create duplicates!
              return
            }

            // revert server move
            targetPlan.MOVE.commit({ ...a, payload, oldItem })
          })
          targetPlan.MOVE.commit(action)
        }

        // if target === LOCAL: Moved locally and in reverse hierarchical order on server. local has precedence: do nothing locally
        return
      }

      targetPlan.MOVE.commit(action)
    }, ACTION_CONCURRENCY)

    await Parallel.each(sourceScanResult.UPDATE.getActions(), async(action) => {
      const concurrentUpdate = sourceUpdates.find(a =>
        action.payload.type === a.payload.type && Mappings.mappable(mappingsSnapshot, action.payload, a.payload))
      if (concurrentUpdate && targetLocation === ItemLocation.LOCAL) {
        // Updated both on server and locally, local has precedence: do nothing locally
        return
      }

      targetPlan.UPDATE.commit(action)
    }, ACTION_CONCURRENCY)

    return targetPlan
  }

  reconcileReorderings<L1 extends TItemLocation, L2 extends TItemLocation>(
    targetReorders: Diff<L2, TItemLocation, ReorderAction<L2, TItemLocation>>,
    sourceDonePlan: PlanStage3<L1, TItemLocation, L2>,
    targetLocation: L1,
    mappingSnapshot: MappingSnapshot
  ) : Diff<L1, TItemLocation, ReorderAction<L1, TItemLocation>> {
    return super.reconcileReorderings(targetReorders, sourceDonePlan, targetLocation, mappingSnapshot)
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
