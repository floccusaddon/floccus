import DefaultStrategy from './Default'
import Diff, { ActionType } from '../Diff'
import * as Parallel from 'async-parallel'
import Mappings, { MappingSnapshot } from '../Mappings'
import { Folder, ItemLocation, ItemType, TItem, TItemLocation } from '../Tree'

export default class UnidirectionalSyncProcess extends DefaultStrategy {
  protected direction: TItemLocation

  setDirection(direction: TItemLocation): void {
    this.direction = direction
  }

  async reconcileDiffs(sourceDiff: Diff, targetDiff: Diff, targetLocation: TItemLocation): Promise<Diff> {
    const mappingsSnapshot = await this.mappings.getSnapshot()

    const masterMoves = sourceDiff.getActions().filter(action => action.type === ActionType.MOVE)
    const masterRemovals = sourceDiff.getActions().filter(action => action.type === ActionType.REMOVE)
    const masterCreations = sourceDiff.getActions().filter(action => action.type === ActionType.CREATE)

    const slaveRemovals = targetDiff.getActions().filter(action => action.type === ActionType.REMOVE)

    if (targetLocation === this.direction) {
      // Prepare slave plan
      let slavePlan = new Diff()

      // Process master diff first
      await Parallel.each(sourceDiff.getActions(), async action => {
        if (action.type === ActionType.REMOVE) {
          const concurrentRemoval = slaveRemovals.find(a =>
            action.payload.type === a.payload.type && Mappings.mappable(mappingsSnapshot, action.payload, a.payload)
          )
          if (concurrentRemoval) {
            // Already deleted locally, do nothing.
            return
          }
        }
        if (action.type === ActionType.MOVE) {
          const concurrentRemoval = slaveRemovals.find(a =>
            action.payload.type === a.payload.type && Mappings.mappable(mappingsSnapshot, action.payload, a.payload)
          )
          if (concurrentRemoval) {
            const existingCreation = slavePlan.getActions(ActionType.CREATE).find(a => a.payload.findItem(ItemType.FOLDER, action.payload.parentId)) ||
              masterCreations.find(a => a.payload.findItem(ItemType.FOLDER, action.payload.parentId))
            if (existingCreation) {
              // the new parent is already being re-created due a different revert
              const parentFolder = existingCreation.payload.findItem(ItemType.FOLDER, action.payload.parentId) as Folder
              // use concurrentRemoval here, because the MOVE from the master doesn't contain descendents that have been moved away (which would mean we lose them)
              const newItem = await this.translateCompleteItem(concurrentRemoval.payload, mappingsSnapshot, parentFolder.location)
              newItem.id = Mappings.mapId(mappingsSnapshot, concurrentRemoval.payload, parentFolder.location)
              newItem.parentId = parentFolder.id
              parentFolder.children.splice(action.index, 0, newItem)
              return
            }

            const existingRemoval = slaveRemovals.find(a => a !== concurrentRemoval && a.payload.findItem(ItemType.FOLDER, Mappings.mapParentId(mappingsSnapshot, action.payload, targetLocation)))
            if (existingRemoval) {
              // the new parent is already being re-created due a different revert
              const parentFolder = existingRemoval.payload.findItem(ItemType.FOLDER, Mappings.mapParentId(mappingsSnapshot, action.payload, targetLocation)) as Folder
              // use concurrentRemoval here, because the MOVE from the master doesn't contain descendents that have been moved away (which would mean we lose them)
              const newItem = concurrentRemoval.payload.clone()
              parentFolder.children.splice(action.index, 0, newItem)
              return
            }

            const newItem = await this.translateCompleteItem(concurrentRemoval.payload, mappingsSnapshot, action.payload.location)
            newItem.id = action.payload.id
            newItem.parentId = action.payload.parentId

            // moved on server but removed locally, recreate it on the server
            slavePlan.commit({ ...action, type: ActionType.CREATE, payload: newItem, oldItem: null })
            return
          }

          const concurrentNestedSlaveRemoval = slaveRemovals.find(a =>
            a.payload.findItem(action.payload.type, Mappings.mapId(mappingsSnapshot, action.payload, a.payload.location))
          )
          const concurrentNestedMasterRemoval = masterRemovals.find(a =>
            // we search for the old parent here (paylod.parentId is the move target)
            a.payload.findItem(ItemType.FOLDER, Mappings.mapParentId(mappingsSnapshot, action.oldItem, a.payload.location))
          )
          if (concurrentNestedSlaveRemoval && concurrentNestedMasterRemoval) {
            // If slave has removed this item and master, too, we have to switch this from MOVE to CREATE
            const newItem = action.payload.clone()
            newItem.id = action.payload.id
            newItem.parentId = action.payload.parentId

            slavePlan.commit({ type: ActionType.CREATE, payload: newItem, index: action.index })
            return
          }

          // prevent mapper from falling back to oldItem which may have been removed from tree
          slavePlan.commit({ ...action, oldItem: null })
          return
        }
        if (action.type === ActionType.CREATE) {
          const concurrentRemoval = slaveRemovals.find(a =>
            a.payload.findItem(ItemType.FOLDER, Mappings.mapParentId(mappingsSnapshot, action.payload, a.payload.location))
          )
          if (concurrentRemoval) {
            // locally removed the parent of a newly created item on the server
            const parentFolder = concurrentRemoval.payload.findItem(ItemType.FOLDER, Mappings.mapParentId(mappingsSnapshot, action.payload, concurrentRemoval.payload.location)) as Folder
            const newItem = await this.translateCompleteItem(action.payload, mappingsSnapshot, concurrentRemoval.payload.location)
            newItem.parentId = parentFolder.id
            parentFolder.children.splice(action.index, 0, newItem)
            return
          }
        }

        slavePlan.commit(action)
      })

      // Map payloads
      slavePlan = slavePlan.map(mappingsSnapshot, targetLocation, (action) => action.type !== ActionType.REORDER && action.type !== ActionType.MOVE)

      // Prepare slave plan for reversing slave changes
      await Parallel.each(targetDiff.getActions(), async action => {
        if (action.type === ActionType.REMOVE) {
          const concurrentRemoval = masterRemovals.find(a =>
            action.payload.type === a.payload.type && Mappings.mappable(mappingsSnapshot, action.payload, a.payload)
          )
          if (concurrentRemoval) {
            // Already deleted on slave, do nothing.
            return
          }
          const concurrentMove = masterMoves.find(a =>
            (action.payload.type === a.payload.type && Mappings.mappable(mappingsSnapshot, action.payload, a.payload)) ||
            (action.payload.type === 'bookmark' && action.payload.canMergeWith(a.payload))
          )
          if (concurrentMove) {
            // removed on the slave, moved in master, do nothing to recreate it.
            return
          }

          // recreate it on slave resource otherwise
          const oldItem = await this.translateCompleteItem(action.payload, mappingsSnapshot, targetLocation === ItemLocation.LOCAL ? ItemLocation.SERVER : ItemLocation.LOCAL)
          const payload = action.payload.clone()
          payload.id = null
          slavePlan.commit({...action, type: ActionType.CREATE, payload, oldItem: oldItem})
          return
        }
        if (action.type === ActionType.CREATE) {
          slavePlan.commit({ ...action, type: ActionType.REMOVE })
          return
        }
        if (action.type === ActionType.MOVE) {
          const concurrentNestedMasterRemoval = masterRemovals
            .find(a => a.payload.findItem(ItemType.FOLDER, Mappings.mapParentId(mappingsSnapshot, action.oldItem, a.payload.location)))
          /* const concurrentNestedSlaveRemoval = slaveRemovals
            .find(a => a.payload.findItem(ItemType.FOLDER, Mappings.mapParentId(mappingsSnapshot, action.oldItem, a.payload.location))) */
          if (concurrentNestedMasterRemoval) {
            slavePlan.commit({ type: ActionType.REMOVE, payload: action.payload })
            return
          }

          const concurrentMove = slavePlan.getActions(ActionType.MOVE).find(a => Mappings.mappable(mappingsSnapshot, a.payload, action.oldItem))
          if (concurrentMove) {
            return
          }
          const oldItem = action.oldItem.clone(false, targetLocation === ItemLocation.LOCAL ? ItemLocation.SERVER : ItemLocation.LOCAL)
          oldItem.id = Mappings.mapId(mappingsSnapshot, action.oldItem, oldItem.location)
          oldItem.parentId = Mappings.mapParentId(mappingsSnapshot, action.oldItem, oldItem.location)

          slavePlan.commit({ type: ActionType.MOVE, payload: oldItem, oldItem: action.payload })
          return
        }
        if (action.type === ActionType.UPDATE) {
          const payload = action.oldItem
          payload.id = action.payload.id
          payload.parentId = action.payload.parentId
          const oldItem = action.payload
          oldItem.id = action.oldItem.id
          oldItem.parentId = action.oldItem.parentId
          slavePlan.commit({ type: ActionType.UPDATE, payload, oldItem })
        }
      })

      return slavePlan
    } else {
      return new Diff() // empty, we don't wanna change anything here
    }
  }

  private async translateCompleteItem(item: TItem, mappingsSnapshot: MappingSnapshot, fakeLocation: TItemLocation) {
    const newItem = item.clone(false, fakeLocation)
    newItem.id = Mappings.mapId(mappingsSnapshot, item, fakeLocation)
    newItem.parentId = Mappings.mapParentId(mappingsSnapshot, item, fakeLocation)
    if (newItem instanceof Folder) {
      const nonexistingItems = []
      await newItem.traverse(async(child, parentFolder) => {
        child.location = item.location // has been set to fakeLocation already by clone(), but for map to work we need to reset it
        child.id = Mappings.mapId(mappingsSnapshot, child, fakeLocation)
        if (typeof child.id === 'undefined') {
          nonexistingItems.push(child)
        }
        child.parentId = parentFolder.id
        child.location = fakeLocation
      })
      newItem.createIndex()
      // filter out all items that couldn't be mapped: These are creations from the slave side
      nonexistingItems.forEach(item => {
        const folder = newItem.findFolder(item.parentId)
        folder.children = folder.children.filter(i => i.id)
      })
    }
    return newItem
  }
}
