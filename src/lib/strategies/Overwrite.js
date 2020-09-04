import DefaultStrategy from './Default'
import Diff, { actions } from '../Diff'

const Parallel = require('async-parallel')

export default class OverwriteSyncProcess extends DefaultStrategy {
  async reconcile(localDiff, serverDiff) {
    const mappingsSnapshot = await this.mappings.getSnapshot()

    const serverRemovals = serverDiff.getActions().filter(action => action.type === actions.REMOVE)

    const localRemovals = localDiff.getActions().filter(action => action.type === actions.REMOVE)
    const localMoves = localDiff.getActions().filter(action => action.type === actions.MOVE)

    // Prepare server plan
    let serverPlan = new Diff()
    await Parallel.each(localDiff.getActions(), async action => {
      if (action.type === actions.REMOVE) {
        const concurrentRemoval = serverRemovals.find(a =>
          action.payload.id === mappingsSnapshot.ServerToLocal[a.payload.type + 's'][a.payload.id])
        if (concurrentRemoval) {
          // Already deleted on server, do nothing.
          return
        }
      }
      if (action.type === actions.MOVE) {
        const concurrentRemoval = serverRemovals.find(a =>
          action.payload.id === mappingsSnapshot.ServerToLocal[a.payload.type + 's'][a.payload.id])
        if (concurrentRemoval) {
          // moved locally but removed on the server, recreate it on the server
          serverPlan.commit({...action, type: actions.CREATE})
          return
        }
      }

      serverPlan.commit(action)
    })

    // Map payloads
    serverPlan.map(mappingsSnapshot.LocalToServer, true)

    // Prepare server plan for reversing server changes
    await Parallel.each(serverDiff.getActions(), async action => {
      if (action.type === actions.REMOVE) {
        const concurrentRemoval = localRemovals.find(a =>
          action.payload.id === mappingsSnapshot.LocalToServer[a.payload.type + 's'][a.payload.id])
        if (concurrentRemoval) {
          // Already deleted locally, do nothing.
          return
        }
        const concurrentMove = localMoves.find(a =>
          action.payload.id === mappingsSnapshot.LocalToServer[a.payload.type + 's'][a.payload.id])
        if (concurrentMove) {
          // removed on the server, moved locally, do nothing to recreate it on the server.
          return
        }
        // recreate it on the server otherwise
        serverPlan.commit({...action, type: actions.CREATE})
        return
      }
      if (action.type === actions.CREATE) {
        serverPlan.commit({...action, type: actions.REMOVE})
        return
      }
      if (action.type === actions.MOVE) {
        serverPlan.commit({type: actions.MOVE, payload: action.oldItem, oldItem: action.payload})
        return
      }
      if (action.type === actions.UPDATE) {
        const payload = action.oldItem
        payload.id = action.payload.id
        payload.parentId = action.payload.parentId
        const oldItem = action.payload
        oldItem.id = action.oldItem.id
        oldItem.parentId = action.oldItem.parentId
        serverPlan.commit({type: actions.UPDATE, payload, oldItem})
      }
    })

    const localPlan = new Diff() // empty, we don't wanna change anything here
    return { localPlan, serverPlan}
  }

  async syncChildOrder({
    localItem,
    cacheItem,
    serverItem,
    localOrder,
    remoteOrder
  }) {
    if (this.preserveOrder && localOrder.length > 1) {
      const newMappingsSnapshot = this.mappings.getSnapshot()
      // always update server tree
      await this.server.orderFolder(
        serverItem.id,
        localOrder.map(item => ({
          id: newMappingsSnapshot.LocalToServer[item.type + 's'][item.id],
          type: item.type
        }))
      )
    }
  }
}
