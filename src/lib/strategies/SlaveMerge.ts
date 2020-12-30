import Diff, { ActionType } from '../Diff'
import Scanner from '../Scanner'
import Slave from './Slave'
import * as Parallel from 'async-parallel'

export default class MergeSlave extends Slave {
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

  async reconcile(localDiff: Diff, serverDiff: Diff): Promise<{serverPlan: Diff, localPlan: Diff}> {
    const mappingsSnapshot = await this.mappings.getSnapshot()

    const localRemovals = localDiff.getActions().filter(action => action.type === ActionType.REMOVE)

    // Prepare local plan
    const localPlan = new Diff()

    await Parallel.each(serverDiff.getActions(), async action => {
      if (action.type === ActionType.REMOVE) {
        const concurrentRemoval = localRemovals.find(a =>
          action.payload.id === mappingsSnapshot.LocalToServer[a.payload.type ][a.payload.id] || (action.payload.type === 'bookmark' && action.payload.canMergeWith(a.payload)))
        if (concurrentRemoval) {
          // Already deleted locally, do nothing.
          return
        }
      }
      if (action.type === ActionType.MOVE) {
        const concurrentRemoval = localRemovals.find(a =>
          action.payload.id === mappingsSnapshot.LocalToServer[a.payload.type][a.payload.id] || (action.payload.type === 'bookmark' && action.payload.canMergeWith(a.payload)))
        if (concurrentRemoval) {
          // moved on server but removed locally, recreate it on the server
          localPlan.commit({...action, type: ActionType.CREATE})
          return
        }
      }

      localPlan.commit(action)
    })

    // Map payloads
    localPlan.map(mappingsSnapshot.ServerToLocal, false, (action) => action.type !== ActionType.REORDER)// && action.type !== ActionType.MOVE)

    const serverPlan = new Diff() // empty, we don't wanna change anything here
    return { localPlan, serverPlan}
  }

  async loadChildren() :Promise<void> {
    this.serverTreeRoot = await this.server.getBookmarksTree(true)
  }
}
