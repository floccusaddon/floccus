import DefaultStrategy from './Default'
import Diff, { ActionType } from '../Diff'
import * as Parallel from 'async-parallel'
import TResource from '../interfaces/Resource'
import Mappings from '../Mappings'
import { ItemLocation, TItemLocation } from '../Tree'

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
            // moved on server but removed locally, recreate it on the server
            slavePlan.commit({ ...action, type: ActionType.CREATE })
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
            // removed on the master, moved in slave, do nothing to recreate it on the master.
            return
          }

          // recreate it on slave resource otherwise
          const payload = action.payload.clone(false, targetLocation)
          payload.id = null
          payload.parentId = Mappings.mapParentId(mappingsSnapshot, action.payload, targetLocation)
          slavePlan.commit({...action, type: ActionType.CREATE, payload, oldItem: action.payload})
          return
        }
        if (action.type === ActionType.CREATE) {
          slavePlan.commit({ ...action, type: ActionType.REMOVE })
          return
        }
        if (action.type === ActionType.MOVE) {
          slavePlan.commit({ type: ActionType.MOVE, payload: action.oldItem, oldItem: action.payload })
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

  async execute(resource:TResource, plan:Diff, targetLocation:TItemLocation):Promise<Diff> {
    if (this.direction === ItemLocation.LOCAL) {
      const run = (action) => this.executeAction(resource, action, targetLocation)

      await Parallel.each(plan.getActions().filter(action => action.type === ActionType.CREATE || action.type === ActionType.UPDATE), run)
      // Don't map here in slave mode!
      const batches = Diff.sortMoves(plan.getActions(ActionType.MOVE), targetLocation === ItemLocation.SERVER ? this.serverTreeRoot : this.localTreeRoot)
      await Parallel.each(batches, batch => Promise.all(batch.map(run)), 1)
      await Parallel.each(plan.getActions(ActionType.REMOVE), run)
      return plan
    } else {
      return super.execute(resource, plan, targetLocation)
    }
  }
}
