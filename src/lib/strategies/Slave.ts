import DefaultStrategy from './Default'
import Diff, { ActionType } from '../Diff'
import * as Parallel from 'async-parallel'
import TResource from '../interfaces/Resource'
import { Mapping } from '../Mappings'

export default class SlaveSyncProcess extends DefaultStrategy {
  async reconcile(localDiff: Diff, serverDiff: Diff): Promise<{serverPlan: Diff, localPlan: Diff}> {
    const mappingsSnapshot = await this.mappings.getSnapshot()

    const serverMoves = serverDiff.getActions().filter(action => action.type === ActionType.MOVE)
    const serverRemovals = serverDiff.getActions().filter(action => action.type === ActionType.REMOVE)

    const localRemovals = localDiff.getActions().filter(action => action.type === ActionType.REMOVE)

    // Prepare local plan
    const localPlan = new Diff()

    await Parallel.each(serverDiff.getActions(), async action => {
      if (action.type === ActionType.REMOVE) {
        const concurrentRemoval = localRemovals.find(a =>
          action.payload.id === mappingsSnapshot.LocalToServer[a.payload.type ][a.payload.id])
        if (concurrentRemoval) {
          // Already deleted locally, do nothing.
          return
        }
      }
      if (action.type === ActionType.MOVE) {
        const concurrentRemoval = localRemovals.find(a =>
          action.payload.id === mappingsSnapshot.LocalToServer[a.payload.type ][a.payload.id])
        if (concurrentRemoval) {
          // moved on server but removed locally, recreate it on the server
          localPlan.commit({...action, type: ActionType.CREATE})
          return
        }
      }

      localPlan.commit(action)
    })

    // Map payloads
    localPlan.map(mappingsSnapshot.ServerToLocal, false, (action) => action.type !== ActionType.REORDER && action.type !== ActionType.MOVE)

    // Prepare server plan for reversing local changes
    await Parallel.each(localDiff.getActions(), async action => {
      if (action.type === ActionType.REMOVE) {
        let concurrentRemoval = serverRemovals.find(a =>
          action.payload.id === mappingsSnapshot.ServerToLocal[a.payload.type ][a.payload.id])
        if (concurrentRemoval) {
          // Already deleted locally, do nothing.
          return
        }
        concurrentRemoval = serverRemovals.find(a =>
          action.payload.id === mappingsSnapshot.ServerToLocal[a.payload.type ][a.payload.id])
        if (concurrentRemoval) {
          // Already deleted locally, do nothing.
          return
        }
        const concurrentMove = serverMoves.find(a =>
          action.payload.id === mappingsSnapshot.ServerToLocal[a.payload.type ][a.payload.id])
        if (concurrentMove) {
          // removed on the server, moved locally, do nothing to recreate it on the server.
          return
        }
        // recreate it on the server otherwise
        const oldItem = action.payload.clone()
        oldItem.id = mappingsSnapshot.LocalToServer[oldItem.type ][oldItem.id]
        oldItem.parentId = mappingsSnapshot.LocalToServer.folder[oldItem.parentId]
        localPlan.commit({...action, type: ActionType.CREATE, oldItem})
        return
      }
      if (action.type === ActionType.CREATE) {
        localPlan.commit({...action, type: ActionType.REMOVE})
        return
      }
      if (action.type === ActionType.MOVE) {
        localPlan.commit({type: ActionType.MOVE, payload: action.oldItem, oldItem: action.payload})
        return
      }
      if (action.type === ActionType.UPDATE) {
        const payload = action.oldItem
        payload.id = action.payload.id
        payload.parentId = action.payload.parentId
        const oldItem = action.payload
        oldItem.id = action.oldItem.id
        oldItem.parentId = action.oldItem.parentId
        localPlan.commit({type: ActionType.UPDATE, payload, oldItem})
      }
    })

    const serverPlan = new Diff() // empty, we don't wanna change anything here
    return { localPlan, serverPlan}
  }

  async execute(resource: TResource, plan:Diff, mappings:Mapping, isLocalToServer: boolean): Promise<void> {
    const run = (action) => this.executeAction(resource, action, isLocalToServer)

    await Parallel.each(plan.getActions().filter(action => action.type === ActionType.CREATE || action.type === ActionType.UPDATE), run)
    // Don't map here in slave mode!
    await Parallel.each(plan.getActions(ActionType.MOVE), run, 1) // Don't run in parallel for weird hierarchy reversals
    await Parallel.each(plan.getActions(ActionType.REMOVE), run)
  }
}
