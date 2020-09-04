import * as Tree from '../Tree'
import Logger from '../Logger'
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
    localPlan.map(mappingsSnapshot.ServerToLocal, false)

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

  async _syncTree({
    localItem,
    cacheItem,
    serverItem,
    localOrder,
    serverOrder
  }) {
    if (this.canceled) throw new Error('Sync cancelled')
    Logger.log('COMPARE', { localItem, cacheItem, serverItem })

    let mappings = this.mappings.getSnapshot()
    let item = cacheItem || localItem || serverItem
    if (!localItem && !cacheItem && serverItem) {
      // CREATED UPSTREAM
      return item.visitCreate(this, {
        mapping: mappings.ServerToLocal,
        toTree: this.localTreeRoot,
        toResource: this.localTree,
        toOrder: localOrder,
        item: serverItem
      })
    } else if (localItem && !cacheItem && !serverItem) {
      // CREATED LOCALLY
      // --> delete locally again
      return item.visitRemove(this, {
        reverseMapping: mappings.LocalToServer,
        fromTree: this.serverTreeRoot,
        toTree: this.localTreeRoot,
        toResource: this.localTree,
        toOrder: localOrder,
        item: localItem
      })
    } else if (
      (localItem && cacheItem && serverItem) ||
      (localItem && !cacheItem && serverItem)
    ) {
      // UPDATED
      await item.visitUpdate(this, localItem, cacheItem, serverItem)
    } else if (!localItem && cacheItem && serverItem) {
      // DELETED LOCALLY
      // --> recreate locally
      return item.visitCreate(this, {
        mapping: mappings.ServerToLocal,
        toTree: this.localTreeRoot,
        toResource: this.localTree,
        toOrder: localOrder,
        item: serverItem
      })
    } else if (localItem && cacheItem && !serverItem) {
      // DELETED UPSTREAM
      return item.visitRemove(this, {
        reverseMapping: mappings.LocalToServer,
        fromTree: this.serverTreeRoot,
        toTree: this.localTreeRoot,
        toResource: this.localTree,
        toOrder: localOrder,
        item: localItem
      })
    } else if (!localItem && cacheItem && !serverItem) {
      if (cacheItem instanceof Tree.Bookmark) {
        await this.mappings.removeBookmark({ localId: cacheItem.id })
      } else {
        await this.mappings.removeFolder({ localId: cacheItem.id })
      }
    }
  }

  async syncFolderProperties(localItem, cacheItem, serverItem) {
    const { changed } = await this.folderHasChanged(
      localItem,
      cacheItem,
      serverItem
    )

    if (localItem !== this.localTreeRoot && changed) {
      const mappings = this.mappings.getSnapshot()
      // always update local folder
      await this.updateFolderProperties({
        mapping: mappings.ServerToLocal,
        fromFolder: serverItem,
        toFolder: localItem,
        toResource: this.localTree
      })
    }
  }

  async syncChildOrder({
    localItem,
    cacheItem,
    serverItem,
    localOrder,
    serverOrder
  }) {
    if (this.preserveOrder && serverOrder.length > 1) {
      const newMappingsSnapshot = this.mappings.getSnapshot()
      // always update local tree
      await this.localTree.orderFolder(
        localItem.id,
        serverOrder.map(item => ({
          id: newMappingsSnapshot.ServerToLocal[item.type + 's'][item.id],
          type: item.type
        }))
      )
    }
  }

  async updateBookmark(localItem, cacheItem, serverItem) {
    const { changed } = await this.bookmarkHasChanged(
      localItem,
      cacheItem,
      serverItem
    )

    await this.mappings.addBookmark({
      localId: localItem.id,
      remoteId: serverItem.id
    })

    this.done++

    if (!changed) {
      Logger.log('Bookmark unchanged')
      return
    }

    await this.localTree.updateBookmark(
      new Tree.Bookmark({
        id: localItem.id,
        parentId: this.mappings.folders.ServerToLocal[serverItem.parentId],
        title: serverItem.title,
        url: serverItem.url
      })
    )

    await this.mappings.addBookmark({
      localId: localItem.id,
      remoteId: serverItem.id
    })
  }
}
