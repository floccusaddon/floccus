import * as Tree from '../Tree'
import Logger from '../Logger'
import DefaultStrategy from './Default'

export default class SlaveSyncProcess extends DefaultStrategy {
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
