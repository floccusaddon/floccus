import * as Tree from '../Tree'
import Logger from '../Logger'
import DefaultStrategy from './Default'

export default class OverwriteSyncProcess extends DefaultStrategy {
  async _syncTree({ localItem, cacheItem, serverItem, localOrder, serverOrder }) {
    if (this.canceled) throw new Error('Sync cancelled')
    Logger.log('COMPARE', { localItem, cacheItem, serverItem })

    let mappings = this.mappings.getSnapshot()
    let item = (localItem || serverItem || cacheItem)
    if (!localItem && !cacheItem && serverItem) {
      // CREATED UPSTREAM
      // --> remove upstream
      return item.visitRemove(this, {
          reverseMapping: mappings.ServerToLocal,
          fromTree: this.localTreeRoot,
          toTree: this.serverTreeRoot,
          toResource: this.server,
          toOrder: serverOrder,
          item: serverItem
        }
      )
    } else if (localItem && !cacheItem && !serverItem) {
      // CREATED LOCALLY
      // --> create remotely
      return item.visitCreate(this, {
          mapping: mappings.LocalToServer,
          toTree: this.serverTreeRoot,
          toResource: this.server,
          toOrder: serverOrder,
          item: localItem
        }
      )
    } else if (
      (localItem && cacheItem && serverItem) ||
      (localItem && !cacheItem && serverItem)
    ) {
      // UPDATED
      await item.visitUpdate(this, localItem, cacheItem, serverItem)
    } else if (!localItem && cacheItem && serverItem) {
      // DELETED LOCALLY
      // --> remove remotely
      return item.visitRemove(this, {
          reverseMapping: mappings.ServerToLocal,
          fromTree: this.localTreeRoot,
          toTree: this.serverTreeRoot,
          toResource: this.server,
          toOrder: serverOrder,
          item: serverItem
        }
      )
    } else if (localItem && cacheItem && !serverItem) {
      // DELETED UPSTREAM
      return item.visitCreate(this, {
        mapping: mappings.LocalToServer,
        toTree: this.serverTreeRoot,
        toResource: this.server,
        toOrder: serverOrder,
        item: localItem
      })
    } else if (!localItem && cacheItem && !serverItem) {
      if (cacheItem instanceof Tree.Bookmark) {
        await this.mappings.removeBookmark({localId: cacheItem.id})
      }else{
        await this.mappings.removeFolder({localId: cacheItem.id})
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
      // always update remote folder
      await this.updateFolderProperties({
        mapping: mappings.LocalToServer,
        fromFolder: localItem,
        toFolder: serverItem,
        toResource: this.server
      })
    }
  }

  async syncChildOrder({ localItem, cacheItem, serverItem, localOrder, remoteOrder }) {
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

    await this.server.updateBookmark(
      new Tree.Bookmark({
        id: serverItem.id,
        parentId: this.mappings.folders.LocalToServer[localItem.parentId],
        title: localItem.title,
        url: localItem.url
      })
    )

    await this.mappings.addBookmark({
      localId: localItem.id,
      remoteId: serverItem.id
    })
  }
}
