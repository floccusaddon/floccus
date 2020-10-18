import { ItemType } from '../Tree'
import Diff, { Action, ActionType, MoveAction, ReorderAction } from '../Diff'
import Scanner from '../Scanner'
import * as Parallel from 'async-parallel'
import Default from './Default'
import { Mapping } from '../Mappings'

export default class MergeSyncProcess extends Default {
  async getDiffs():Promise<{localDiff:Diff, serverDiff:Diff}> {
    // If there's no cache, diff the two trees directly
    const newMappings = []
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
      false
    )
    const [localDiff, serverDiff] = await Promise.all([localScanner.run(), serverScanner.run()])
    await Promise.all(newMappings.map(([localItem, serverItem]) => {
      this.addMapping(this.server, localItem, serverItem.id)
    }))
    return {localDiff, serverDiff}
  }

  async reconcile(localDiff:Diff, serverDiff:Diff):Promise<{serverPlan: Diff, localPlan: Diff}> {
    const mappingsSnapshot = await this.mappings.getSnapshot()

    const serverCreations = serverDiff.getActions(ActionType.CREATE)
    const serverMoves = serverDiff.getActions(ActionType.MOVE)

    const localCreations = localDiff.getActions(ActionType.CREATE)
    const localMoves = localDiff.getActions(ActionType.MOVE)
    const localUpdates = localDiff.getActions(ActionType.UPDATE)

    // Prepare server plan
    const serverPlan = new Diff() // to be mapped
    await Parallel.each(localDiff.getActions(), async(action:Action) => {
      if (action.type === ActionType.REMOVE) {
        // don't execute deletes
        return
      }
      if (action.type === ActionType.CREATE) {
        const concurrentCreation = serverCreations.find(a =>
          action.payload.parentId === mappingsSnapshot.ServerToLocal.folder[a.payload.parentId] &&
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
            false
          )
          await subScanner.run()
          newMappings.push([concurrentCreation.payload, action.payload.id])
          await Parallel.each(newMappings, async([oldItem, newId]) => {
            await this.addMapping(this.localTree, oldItem, newId)
          },1)
          // TODO: subScanner may contain residual CREATE/REMOVE actions that need to be added to mappings
          return
        }
      }
      if (action.type === ActionType.MOVE) {
        const concurrentHierarchyReversals = serverMoves.filter(a =>
          action.payload.findItem(ItemType.FOLDER, mappingsSnapshot.ServerToLocal.folder[a.payload.parentId]) &&
          a.payload.findItem(ItemType.FOLDER, mappingsSnapshot.LocalToServer.folder[action.payload.parentId])
        )
        if (concurrentHierarchyReversals.length) {
          concurrentHierarchyReversals.forEach(a => {
            // moved locally but moved in reverse hierarchical order on server
            const payload = a.oldItem.clone() // we don't map here as we want this to look like a local action
            const oldItem = a.payload.clone()
            oldItem.id = mappingsSnapshot.ServerToLocal[oldItem.type ][oldItem.id]
            oldItem.parentId = mappingsSnapshot.ServerToLocal.folder[oldItem.parentId]
            // revert server move
            serverPlan.commit({...a, payload, oldItem})
          })
          serverPlan.commit(action)
          return
        }
      }
      if (action.type === ActionType.REORDER) {
        // Don't reorder in first sync
        return
      }

      serverPlan.commit(action)
    })

    // Map payloads
    serverPlan.map(mappingsSnapshot.LocalToServer, true, (action) => action.type !== ActionType.REORDER && action.type !== ActionType.MOVE)

    // Prepare local plan
    const localPlan = new Diff()
    await Parallel.each(serverDiff.getActions(), async(action:Action) => {
      if (action.type === ActionType.REMOVE) {
        // don't execute deletes
        return
      }
      if (action.type === ActionType.CREATE) {
        const concurrentCreation = localCreations.find(a =>
          action.payload.parentId === mappingsSnapshot.LocalToServer.folder[a.payload.parentId] &&
          action.payload.canMergeWith(a.payload))
        if (concurrentCreation) {
          // created on both the server and locally, try to reconcile
          const newMappings = []
          const subScanner = new Scanner(
            concurrentCreation.payload,
            action.payload,
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
          // also add mappings for the two root folders
          newMappings.push([concurrentCreation.payload, action.payload.id])
          await Parallel.each(newMappings, async([oldItem, newId]) => {
            await this.addMapping(this.server, oldItem, newId)
          })
          // do nothing locally if the trees differ, serverPlan takes care of adjusting the server tree
          return
        }
      }
      if (action.type === ActionType.MOVE) {
        const concurrentMove = localMoves.find(a =>
          action.payload.id === mappingsSnapshot.LocalToServer[a.payload.type ][a.payload.id])
        if (concurrentMove) {
          // Moved both on server and locally, local has precedence: do nothing locally
          return
        }
        const concurrentHierarchyReversals = localMoves.filter(a =>
          action.payload.findItem(ItemType.FOLDER, mappingsSnapshot.LocalToServer.folder[a.payload.parentId]) &&
          a.payload.findItem(ItemType.FOLDER, mappingsSnapshot.ServerToLocal.folder[action.payload.parentId])
        )
        if (concurrentHierarchyReversals.length) {
          // Moved locally and in reverse hierarchical order on server. local has precedence: do nothing locally
          return
        }
      }
      if (action.type === ActionType.UPDATE) {
        const concurrentUpdate = localUpdates.find(a =>
          action.payload.id === mappingsSnapshot.LocalToServer[a.payload.type ][a.payload.id])
        if (concurrentUpdate) {
          // Updated both on server and locally, local has precedence: do nothing locally
          return
        }
      }
      if (action.type === ActionType.REORDER) {
        // don't reorder in first sync
        return
      }
      localPlan.commit(action)
    })

    localPlan.map(mappingsSnapshot.ServerToLocal, false, (action) => action.type !== ActionType.REORDER && action.type !== ActionType.MOVE)

    return { localPlan, serverPlan}
  }

  reconcileReorderings(plan:Diff, reverseMappings:Mapping, isLocalToServer: boolean) :void{
    plan
      .getActions(ActionType.REORDER)
      .map(a => a as ReorderAction)
      // MOVEs have oldItem from target tree and payload now mapped to target tree
      // REORDERs have payload in source tree
      .forEach(reorderAction => {
        const childAwayMoves = plan.getActions(ActionType.MOVE)
          .filter(move =>
            (reorderAction.payload.id === reverseMappings[move.payload.type][move.oldItem.parentId]) &&
            reorderAction.order.find(item => item.id === reverseMappings[move.payload.type ][move.payload.id] && item.type === move.payload.type)
          )
        const concurrentRemovals = plan.getActions(ActionType.REMOVE)
          .filter(removal => reorderAction.order.find(item => item.id === reverseMappings[removal.payload.type ][removal.payload.id] && item.type === removal.payload.type))
        reorderAction.order = reorderAction.order.filter(item =>
          !childAwayMoves.find(move =>
            item.id === reverseMappings[move.payload.type ][move.payload.id] && move.payload.type === item.type) &&
          !concurrentRemovals.find(removal =>
            item.id === reverseMappings[removal.payload.type ][removal.payload.id] && removal.payload.type === item.type)
        )
        plan.getActions(ActionType.MOVE)
          .map(a => a as MoveAction)
          .filter(move =>
            reorderAction.payload.id === reverseMappings.folder[move.payload.parentId] &&
            !reorderAction.order.find(item => item.id === reverseMappings[move.payload.type ][move.payload.id] && item.type === move.payload.type)
          )
          .forEach(a => {
            reorderAction.order.splice(a.index, 0, { type: a.payload.type, id: reverseMappings[a.payload.type ][a.payload.id] })
          })
      })
  }
}
