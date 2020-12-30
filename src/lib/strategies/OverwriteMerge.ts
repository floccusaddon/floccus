import Diff, { ActionType } from '../Diff'
import Scanner from '../Scanner'
import OverwriteSyncProcess from './Overwrite'
import * as Parallel from 'async-parallel'

export default class MergeOverwrite extends OverwriteSyncProcess {
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

  async reconcile(localDiff: Diff, serverDiff: Diff):Promise<{serverPlan: Diff, localPlan: Diff}> {
    const mappingsSnapshot = await this.mappings.getSnapshot()

    const localRemovals = localDiff.getActions().filter(action => action.type === ActionType.REMOVE)
    const localMoves = localDiff.getActions().filter(action => action.type === ActionType.MOVE)

    // Prepare server plan
    const serverPlan = new Diff()

    // Prepare server plan for reversing server changes
    await Parallel.each(serverDiff.getActions(), async action => {
      if (action.type === ActionType.REMOVE) {
        const concurrentRemoval = localRemovals.find(a =>
          action.payload.id === mappingsSnapshot.LocalToServer[a.payload.type ][a.payload.id] || (action.payload.type === 'bookmark' && action.payload.canMergeWith(a.payload)))
        if (concurrentRemoval) {
          // Already deleted locally, do nothing.
          return
        }
        const concurrentMove = localMoves.find(a =>
          action.payload.id === mappingsSnapshot.LocalToServer[a.payload.type ][a.payload.id] || (action.payload.type === 'bookmark' && action.payload.canMergeWith(a.payload)))
        if (concurrentMove) {
          // removed on the server, moved locally, do nothing to recreate it on the server.
          return
        }

        const payload = action.payload.clone()
        payload.id = null
        payload.parentId = mappingsSnapshot.LocalToServer.folder[payload.parentId]
        // recreate it on the server otherwise
        serverPlan.commit({...action, type: ActionType.CREATE, payload, oldItem: action.payload})
        return
      }
      if (action.type === ActionType.CREATE) {
        serverPlan.commit({...action, type: ActionType.REMOVE})
        return
      }
      if (action.type === ActionType.MOVE) {
        serverPlan.commit({type: ActionType.MOVE, payload: action.oldItem, oldItem: action.payload})
        return
      }
      if (action.type === ActionType.UPDATE) {
        const payload = action.oldItem
        payload.id = action.payload.id
        payload.parentId = action.payload.parentId
        const oldItem = action.payload
        oldItem.id = action.oldItem.id
        oldItem.parentId = action.oldItem.parentId
        serverPlan.commit({type: ActionType.UPDATE, payload, oldItem})
      }
    })

    const localPlan = new Diff() // empty, we don't wanna change anything here
    return { localPlan, serverPlan}
  }

  async loadChildren() :Promise<void> {
    this.serverTreeRoot = await this.server.getBookmarksTree(true)
  }
}
