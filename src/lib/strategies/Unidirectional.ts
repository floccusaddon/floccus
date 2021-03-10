import DefaultStrategy from './Default'
import Diff, { ActionType } from '../Diff'
import * as Parallel from 'async-parallel'
import Mappings from '../Mappings'
import { Folder, ItemLocation, ItemType, TItemLocation } from '../Tree'

export default class UnidirectionalSyncProcess extends DefaultStrategy {
  protected direction: TItemLocation

  setDirection(direction: TItemLocation): void {
    this.direction = direction
  }

  async reconcileDiffs(sourceDiff: Diff, targetDiff: Diff, targetLocation: TItemLocation): Promise<Diff> {
    const mappingsSnapshot = await this.mappings.getSnapshot()

    const masterMoves = sourceDiff.getActions().filter(action => action.type === ActionType.MOVE)
    const masterRemovals = sourceDiff.getActions().filter(action => action.type === ActionType.REMOVE)

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
            const existingCreation = slavePlan.getActions(ActionType.CREATE).find(a => a.payload.findItem(ItemType.FOLDER, action.payload.parentId))
            if (existingCreation) {
              // the new parent is already being re-created due a different revert
              const parentFolder = existingCreation.payload.findItem(ItemType.FOLDER, action.payload.parentId) as Folder
              // use concurrentRemoval here, because the MOVE from the master doesn't contain descendents that have been moved away (which would mean we lose them)
              const newItem = concurrentRemoval.payload.clone(false, parentFolder.location)
              newItem.id = Mappings.mapId(mappingsSnapshot, action.payload, parentFolder.location)
              newItem.parentId = parentFolder.id
              if (newItem.type === ItemType.FOLDER) {
                await newItem.traverse(async(item, parentFolder) => {
                  item.location = concurrentRemoval.payload.location // has been set to fakeLocation already by clone(), but for map to work we need to reset it
                  item.id = Mappings.mapId(mappingsSnapshot, item, existingCreation.payload.location)
                  item.parentId = parentFolder.id
                  item.location = existingCreation.payload.location
                })
              }
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

            // moved on server but removed locally, recreate it on the server
            slavePlan.commit({ ...action, type: ActionType.CREATE, oldItem: null })
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
            const newItem = action.payload.clone(false, parentFolder.location)
            if (newItem.type === ItemType.FOLDER) {
              await newItem.traverse(async(item, parentFolder) => {
                item.location = action.payload.location // has been set to fakeLocation already by clone(), but for map to work we need to reset it
                item.id = Mappings.mapId(mappingsSnapshot, item, concurrentRemoval.payload.location)
                item.parentId = parentFolder.id
                item.location = action.payload.location
              })
            }
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
          const payload = action.payload.clone(false, targetLocation)
          payload.id = null
          payload.parentId = Mappings.mapParentId(mappingsSnapshot, action.payload, targetLocation)
          const fakeLocation = targetLocation === ItemLocation.LOCAL ? ItemLocation.SERVER : ItemLocation.LOCAL
          const oldItem = action.payload.clone(false, fakeLocation)
          oldItem.id = Mappings.mapId(mappingsSnapshot, action.payload, fakeLocation)
          oldItem.parentId = Mappings.mapParentId(mappingsSnapshot, action.payload, fakeLocation)
          if (oldItem instanceof Folder) {
            const nonexistingItems = []
            await oldItem.traverse(async(item, parentFolder) => {
              item.location = targetLocation // has been set to fakeLocation already by clone(), but for map to work we need to reset it
              item.id = Mappings.mapId(mappingsSnapshot, item, fakeLocation)
              if (typeof item.id === 'undefined') {
                nonexistingItems.push(item)
              }
              item.parentId = parentFolder.id
              item.location = fakeLocation
            })
            oldItem.createIndex()
            // filter out all items that couldn't be mapped: These are creations from the slave side
            nonexistingItems.forEach(item => {
              const folder = oldItem.findFolder(item.parentId)
              folder.children = folder.children.filter(i => i.id)
            })
          }
          slavePlan.commit({...action, type: ActionType.CREATE, payload, oldItem: oldItem})
          return
        }
        if (action.type === ActionType.CREATE) {
          slavePlan.commit({ ...action, type: ActionType.REMOVE })
          return
        }
        if (action.type === ActionType.MOVE) {
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
}
