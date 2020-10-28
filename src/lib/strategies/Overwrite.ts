import DefaultStrategy from './Default'
import Diff, { ActionType } from '../Diff'
import * as Parallel from 'async-parallel'

export default class OverwriteSyncProcess extends DefaultStrategy {
  async reconcile(localDiff: Diff, serverDiff: Diff):Promise<{serverPlan: Diff, localPlan: Diff}> {
    const mappingsSnapshot = await this.mappings.getSnapshot()

    const serverRemovals = serverDiff.getActions().filter(action => action.type === ActionType.REMOVE)

    const localRemovals = localDiff.getActions().filter(action => action.type === ActionType.REMOVE)
    const localMoves = localDiff.getActions().filter(action => action.type === ActionType.MOVE)

    // Prepare server plan
    const serverPlan = new Diff()
    await Parallel.each(localDiff.getActions(), async action => {
      if (action.type === ActionType.REMOVE) {
        const concurrentRemoval = serverRemovals.find(a =>
          action.payload.id === mappingsSnapshot.ServerToLocal[a.payload.type ][a.payload.id])
        if (concurrentRemoval) {
          // Already deleted on server, do nothing.
          return
        }
      }
      if (action.type === ActionType.MOVE) {
        const concurrentRemoval = serverRemovals.find(a =>
          action.payload.id === mappingsSnapshot.ServerToLocal[a.payload.type ][a.payload.id])
        if (concurrentRemoval) {
          // moved locally but removed on the server, recreate it on the server
          serverPlan.commit({...action, type: ActionType.CREATE})
          return
        }
      }

      serverPlan.commit(action)
    })

    // Map payloads
    serverPlan.map(mappingsSnapshot.LocalToServer, true, (action) => action.type !== ActionType.REORDER && action.type !== ActionType.MOVE)

    // Prepare server plan for reversing server changes
    await Parallel.each(serverDiff.getActions(), async action => {
      if (action.type === ActionType.REMOVE) {
        const concurrentRemoval = localRemovals.find(a =>
          action.payload.id === mappingsSnapshot.LocalToServer[a.payload.type ][a.payload.id])
        if (concurrentRemoval) {
          // Already deleted locally, do nothing.
          return
        }
        const concurrentMove = localMoves.find(a =>
          action.payload.id === mappingsSnapshot.LocalToServer[a.payload.type ][a.payload.id])
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
}
