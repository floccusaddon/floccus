import Diff, { ActionType } from '../Diff'
import Scanner from '../Scanner'
import Unidirectional from './Unidirectional'
import * as Parallel from 'async-parallel'
import { ItemLocation, TItemLocation } from '../Tree'
import Mappings from '../Mappings'
import TResource from '../interfaces/Resource'

export default class UnidirectionalMergeSyncProcess extends Unidirectional {
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

  async reconcileDiffs(sourceDiff: Diff, targetDiff: Diff, targetLocation: TItemLocation): Promise<Diff> {
    const mappingsSnapshot = await this.mappings.getSnapshot()

    if (targetLocation === this.direction) {
      const slaveRemovals = targetDiff.getActions().filter(action => action.type === ActionType.REMOVE)

      // Prepare local plan
      const slavePlan = new Diff()

      await Parallel.each(sourceDiff.getActions(), async action => {
        if (action.type === ActionType.REMOVE) {
          const concurrentRemoval = slaveRemovals.find(a =>
            action.payload.type === a.payload.type && Mappings.mappable(mappingsSnapshot, action.payload, a.payload)
          )
          if (concurrentRemoval) {
            // Already deleted on slave, do nothing.
            return
          }
        }
        if (action.type === ActionType.MOVE) {
          const concurrentRemoval = slaveRemovals.find(a =>
            action.payload.type === a.payload.type && Mappings.mappable(mappingsSnapshot, action.payload, a.payload)
          )
          if (concurrentRemoval) {
            // moved on master but removed on slave, recreate it on slave
            slavePlan.commit({ ...action, type: ActionType.CREATE })
            return
          }
        }

        slavePlan.commit(action)
      })

      // Map payloads
      const mappedPlan = slavePlan.map(mappingsSnapshot, targetLocation, (action) => action.type !== ActionType.REORDER)
      return mappedPlan
    } else {
      const serverPlan = new Diff() // empty, we don't wanna change anything here
      return serverPlan
    }
  }

  async loadChildren() :Promise<void> {
    this.serverTreeRoot = await this.server.getBookmarksTree(true)
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
