import * as Tree from '../Tree'
import Logger from '../Logger'
import DefaultStrategy from './Default'

const _ = require('lodash')
const Parallel = require('async-parallel')

export default class OverwriteSyncProcess extends DefaultStrategy {
  async _syncTree(localItem, cacheItem, serverItem) {
    if (this.canceled) throw new Error('Sync cancelled')
    Logger.log('COMPARE', { localItem, cacheItem, serverItem })

    var create, update, remove, mappings
    if ((localItem || serverItem || cacheItem) instanceof Tree.Folder) {
      create = this.createFolder.bind(this)
      update = this.updateFolder.bind(this)
      remove = this.removeFolder.bind(this)
      mappings = this.mappings.folders
    } else {
      create = this.createBookmark.bind(this)
      update = this.updateBookmark.bind(this)
      remove = this.removeBookmark.bind(this)
      mappings = this.mappings.bookmarks
    }
    if (!localItem && !cacheItem && serverItem) {
      // CREATED UPSTREAM
      // --> remove upstream
      return remove(
        mappings.ServerToLocal,
        this.localTreeRoot,
        this.serverTreeRoot,
        this.server,
        serverItem
      )
    } else if (localItem && !cacheItem && !serverItem) {
      // CREATED LOCALLY
      // --> create remotely
      return create(
        this.mappings.bookmarks.LocalToServer,
        this.mappings.folders.LocalToServer,
        this.localTreeRoot,
        this.serverTreeRoot,
        this.server,
        localItem
      )
    } else if (
      (localItem && cacheItem && serverItem) ||
      (localItem && !cacheItem && serverItem)
    ) {
      // UPDATED
      await update(localItem, cacheItem, serverItem)
    } else if (!localItem && cacheItem && serverItem) {
      // DELETED LOCALLY
      // --> remove remotely
      return remove(
        mappings.ServerToLocal,
        this.localTreeRoot,
        this.serverTreeRoot,
        this.server,
        serverItem
      )
    } else if (localItem && cacheItem && !serverItem) {
      // DELETED UPSTREAM
      return create(
        this.mappings.bookmarks.LocalToServer,
        this.mappings.folders.LocalToServer,
        this.localTreeRoot,
        this.serverTreeRoot,
        this.server,
        localItem
      )
    } else if (!localItem && cacheItem && !serverItem) {
      // TODO: remove from mappings
    }
  }

  async updateFolder(localItem, cacheItem, serverItem) {
    const { changed } = await this.folderHasChanged(
      localItem,
      cacheItem,
      serverItem
    )

    if (localItem !== this.localTreeRoot && changed) {
      // always update remote folder
      await this.updateFolderProperties(
        this.mappings.folders.LocalToServer,
        localItem,
        serverItem,
        this.server
      )
    }

    // Add folder to mappings
    await this.mappings.addFolder({
      localId: localItem.id,
      remoteId: serverItem.id
    })

    if (!changed) {
      Logger.log('Skipping subtree')
      return
    }

    Logger.log('Checking subtree')

    // LOCAL CHANGES

    let mappingsSnapshot = this.mappings.getSnapshot()

    // cache initial local order
    const localOrder = localItem.children.map(child => ({
      type: child.type,
      id: child.id
    }))

    // CREATED LOCALLY
    let createdLocally = localItem.children.filter(
      local =>
        !cacheItem || !cacheItem.children.some(cache => local.id === cache.id)
    )
    createdLocally = await Parallel.filter(
      createdLocally,
      async addedChild => {
        // merge this with an item created on the server
        const serverChild = _.find(serverItem.children, serverChild => {
          if (
            serverChild instanceof Tree.Folder &&
            addedChild instanceof Tree.Folder
          ) {
            return serverChild.title === addedChild.title && !serverChild.merged
          } else if (
            serverChild instanceof Tree.Bookmark &&
            addedChild instanceof Tree.Bookmark
          ) {
            return serverChild.url === addedChild.url && !serverChild.merged
          }
          return false
        })
        if (serverChild) serverChild.merged = true
        return this.syncTree(addedChild, null, serverChild)
      },
      this.concurrency
    )

    // REMOVED LOCALLY
    if (cacheItem) {
      let removedLocally = cacheItem.children.filter(
        cache => !localItem.children.some(local => local.id === cache.id)
      )
      removedLocally = await Parallel.filter(
        removedLocally,
        async removedChild => {
          const serverChild =
            removedChild instanceof Tree.Folder
              ? this.serverTreeRoot.findFolder(
                mappingsSnapshot.folders.LocalToServer[removedChild.id]
              )
              : this.serverTreeRoot.findBookmark(
                mappingsSnapshot.bookmarks.LocalToServer[removedChild.id]
              )
          return this.syncTree(null, removedChild, serverChild)
        },
        this.concurrency
      )
    }

    // take a new snapshot since the server or we ourselves might have deduplicated above
    let newMappingsSnapshot = this.mappings.getSnapshot()

    // CREATED UPSTREAM
    let createdUpstream = serverItem.children.filter(
      child =>
        !(cacheItem || localItem).children.some(
          cacheChild =>
            mappingsSnapshot[child.type + 's'].ServerToLocal[child.id] ===
              cacheChild.id ||
            newMappingsSnapshot[child.type + 's'].ServerToLocal[child.id] ===
              cacheChild.id
        )
    )
    createdUpstream = await Parallel.filter(
      createdUpstream,
      async newChild => {
        if (newChild.merged) return false
        return this.syncTree(null, null, newChild)
      },
      this.concurrency
    )

    // REMOVED UPSTREAM
    if (cacheItem) {
      let removedUpstream = cacheItem.children.filter(
        cache =>
          !serverItem.children.some(
            server =>
              mappingsSnapshot[cache.type + 's'].ServerToLocal[server.id] ===
                cache.id ||
              newMappingsSnapshot[cache.type + 's'].ServerToLocal[server.id] ===
                cache.id
          )
      )
      removedUpstream = await Parallel.filter(
        removedUpstream,
        async oldChild => {
          const localChild =
            oldChild instanceof Tree.Folder
              ? this.localTreeRoot.findFolder(oldChild.id)
              : this.localTreeRoot.findBookmark(oldChild.id)
          return this.syncTree(localChild, oldChild, null)
        },
        this.concurrency
      )
    }

    // ORDER CHILDREN

    if (this.preserveOrder && localOrder.length > 1) {
      const newMappingsSnapshot = this.mappings.getSnapshot()
      await this.server.orderFolder(
        serverItem.id,
        localOrder.map(item => ({
          id: newMappingsSnapshot[item.type + 's'].LocalToServer[item.id],
          type: item.type
        }))
      )
    }

    // RECURSE EXISTING ITEMS

    await Parallel.each(
      localItem.children.filter(local =>
        serverItem.children.some(
          server =>
            mappingsSnapshot[local.type + 's'].ServerToLocal[server.id] ===
            local.id
        )
      ),
      async existingChild => {
        const serverChild =
          existingChild instanceof Tree.Folder
            ? this.serverTreeRoot.findFolder(
              this.mappings.folders.LocalToServer[existingChild.id]
            )
            : this.serverTreeRoot.findBookmark(
              this.mappings.bookmarks.LocalToServer[existingChild.id]
            )

        const cacheChild = cacheItem
          ? _.find(
            cacheItem.children,
            cacheChild => cacheChild.id === existingChild.id
          )
          : null
        await this.syncTree(existingChild, cacheChild, serverChild)
      },
      this.concurrency
    )
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
