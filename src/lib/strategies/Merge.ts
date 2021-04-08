import { Folder, ItemLocation, ItemType, TItemLocation } from '../Tree'
import Diff, { Action, ActionType } from '../Diff'
import Scanner from '../Scanner'
import * as Parallel from 'async-parallel'
import Default from './Default'
import Mappings, { MappingSnapshot } from '../Mappings'
import Logger from '../Logger'

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

  async reconcileDiffs(sourceDiff:Diff, targetDiff:Diff, targetLocation: TItemLocation):Promise<Diff> {
    const mappingsSnapshot = await this.mappings.getSnapshot()

    const targetCreations = targetDiff.getActions(ActionType.CREATE)
    const targetMoves = targetDiff.getActions(ActionType.MOVE)

    const sourceMoves = sourceDiff.getActions(ActionType.MOVE)
    const sourceUpdates = sourceDiff.getActions(ActionType.UPDATE)

    // Prepare server plan
    const targetPlan = new Diff() // to be mapped
    await Parallel.each(sourceDiff.getActions(), async(action:Action) => {
      if (action.type === ActionType.REMOVE) {
        // don't execute deletes
        return
      }
      if (action.type === ActionType.CREATE) {
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
      }
      if (action.type === ActionType.MOVE) {
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
          return action.payload.type === ItemType.FOLDER && a.payload.type === ItemType.FOLDER &&
            sourceAncestors.find(ancestor => targetFolder.findItem(ItemType.FOLDER, Mappings.mapId(mappingsSnapshot, ancestor, targetFolder.location))) &&
            targetAncestors.find(ancestor => sourceFolder.findItem(ItemType.FOLDER, Mappings.mapId(mappingsSnapshot, ancestor, sourceFolder.location)))
        })
        if (concurrentHierarchyReversals.length) {
          if (targetLocation === ItemLocation.SERVER) {
            concurrentHierarchyReversals.forEach(a => {
              // moved locally but moved in reverse hierarchical order on server
              const payload = a.oldItem.clone() // we don't map here as we want this to look like a local action
              const oldItem = a.payload.clone()
              oldItem.id = Mappings.mapId(mappingsSnapshot, oldItem, action.payload.location)
              oldItem.parentId = Mappings.mapParentId(mappingsSnapshot, oldItem, action.payload.location)

              if (
                targetPlan.getActions(ActionType.MOVE).find(move => move.payload.id === payload.id) ||
                sourceDiff.getActions(ActionType.MOVE).find(move => move.payload.id === payload.id)
              ) {
                // Don't create duplicates!
                return
              }

              // revert server move
              targetPlan.commit({ ...a, payload, oldItem })
            })
            targetPlan.commit(action)
          }

          // if target === LOCAL: Moved locally and in reverse hierarchical order on server. local has precedence: do nothing locally
          return
        }
      }
      if (action.type === ActionType.UPDATE) {
        const concurrentUpdate = sourceUpdates.find(a =>
          action.payload.type === a.payload.type && Mappings.mappable(mappingsSnapshot, action.payload, a.payload))
        if (concurrentUpdate && targetLocation === ItemLocation.LOCAL) {
          // Updated both on server and locally, local has precedence: do nothing locally
          return
        }
      }
      if (action.type === ActionType.REORDER) {
        // Don't reorder in first sync
        return
      }

      targetPlan.commit(action)
    })

    return targetPlan
  }

  reconcileReorderings(targetTreePlan:Diff, sourceTreePlan:Diff, mappingSnapshot:MappingSnapshot) : Diff {
    return super.reconcileReorderings(targetTreePlan, sourceTreePlan, mappingSnapshot)
  }

  async loadChildren():Promise<void> {
    Logger.log('Merge strategy: Load complete tree from server')
    this.serverTreeRoot = await this.server.getBookmarksTree(true)
  }
}
