import DefaultStrategy from './Default'
import Diff, { actions } from '../Diff'

const Parallel = require('async-parallel')

export default class SlaveSyncProcess extends DefaultStrategy {
  async reconcile(localDiff, serverDiff) {
    const mappingsSnapshot = await this.mappings.getSnapshot()

    const serverMoves = serverDiff.getActions().filter(action => action.type === actions.MOVE)
    const serverRemovals = serverDiff.getActions().filter(action => action.type === actions.REMOVE)

    const localRemovals = localDiff.getActions().filter(action => action.type === actions.REMOVE)

    // Prepare local plan
    let localPlan = new Diff()
    await Parallel.each(serverDiff.getActions(), async action => {
      if (action.type === actions.REMOVE) {
        const concurrentRemoval = localRemovals.find(a =>
          action.payload.id === mappingsSnapshot.LocalToServer[a.payload.type + 's'][a.payload.id])
        if (concurrentRemoval) {
          // Already deleted locally, do nothing.
          return
        }
      }
      if (action.type === actions.MOVE) {
        const concurrentRemoval = localRemovals.find(a =>
          action.payload.id === mappingsSnapshot.LocalToServer[a.payload.type + 's'][a.payload.id])
        if (concurrentRemoval) {
          // moved on server but removed locally, recreate it on the server
          localPlan.commit({...action, type: actions.CREATE})
          return
        }
      }

      localPlan.commit(action)
    })

    // Map payloads
    localPlan.map(mappingsSnapshot.ServerToLocal, false, (action) => action.type !== actions.REORDER && action.type !== actions.MOVE)

    // Prepare server plan for reversing server changes
    await Parallel.each(localDiff.getActions(), async action => {
      if (action.type === actions.REMOVE) {
        const concurrentRemoval = serverRemovals.find(a =>
          action.payload.id === mappingsSnapshot.ServerToLocal[a.payload.type + 's'][a.payload.id])
        if (concurrentRemoval) {
          // Already deleted locally, do nothing.
          return
        }
        const concurrentMove = serverMoves.find(a =>
          action.payload.id === mappingsSnapshot.ServerToLocal[a.payload.type + 's'][a.payload.id])
        if (concurrentMove) {
          // removed on the server, moved locally, do nothing to recreate it on the server.
          return
        }
        // recreate it on the server otherwise
        const oldItem = action.payload.clone()
        oldItem.id = mappingsSnapshot.LocalToServer[oldItem.type + 's'][oldItem.id]
        oldItem.parentId = mappingsSnapshot.LocalToServer.folders[oldItem.parentId]
        localPlan.commit({...action, type: actions.CREATE, oldItem})
        return
      }
      if (action.type === actions.CREATE) {
        localPlan.commit({...action, type: actions.REMOVE})
        return
      }
      if (action.type === actions.MOVE) {
        localPlan.commit({type: actions.MOVE, payload: action.oldItem, oldItem: action.payload})
        return
      }
      if (action.type === actions.UPDATE) {
        const payload = action.oldItem
        payload.id = action.payload.id
        payload.parentId = action.payload.parentId
        const oldItem = action.payload
        oldItem.id = action.oldItem.id
        oldItem.parentId = action.oldItem.parentId
        localPlan.commit({type: actions.UPDATE, payload, oldItem})
      }
    })

    const serverPlan = new Diff() // empty, we don't wanna change anything here
    return { localPlan, serverPlan}
  }

  async execute(resource, plan, mappings, isLocalToServer) {
    const run = (action) => this.executeAction(resource, action, isLocalToServer)

    await Parallel.each(plan.getActions().filter(action => action.type === actions.CREATE || action.type === actions.UPDATE), run)
    // Don't map here in slave mode!
    await Parallel.each(plan.getActions(actions.MOVE), run, 1) // Don't run in parallel for weird hierarchy reversals
    await Parallel.each(plan.getActions(actions.REMOVE), run)
  }
}
