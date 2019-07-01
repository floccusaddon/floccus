import * as Tree from '../Tree'
import Logger from '../Logger'
import DefaultStrategy from './Default'

const _ = require('lodash')
const Parallel = require('async-parallel')
const PQueue = require('p-queue')
const normalizeMoreAggressively = require('normalize-url')

export default class SlaveSyncProcess extends DefaultStrategy {
  async syncTree(localItem, cacheItem, serverItem) {
    const execSync = async () => {
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
        return await create(
          this.mappings.bookmarks.ServerToLocal,
          this.mappings.folders.ServerToLocal,
          this.serverTreeRoot,
          this.localTreeRoot,
          this.localTree,
          serverItem
        )
      } else if (localItem && !cacheItem && !serverItem) {
        // CREATED LOCALLY
        // --> delete locally again
        return await remove(
          mappings.LocalToServer,
          this.serverTreeRoot,
          this.localTreeRoot,
          this.localTree,
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
        // --> recreate locally
        return await create(
          this.mappings.bookmarks.ServerToLocal,
          this.mappings.folders.ServerToLocal,
          this.serverTreeRoot,
          this.localTreeRoot,
          this.localTree,
          serverItem
        )
      } else if (localItem && cacheItem && !serverItem) {
        // DELETED UPSTREAM
        return await remove(
          mappings.LocalToServer,
          this.serverTreeRoot,
          this.localTreeRoot,
          this.localTree,
          localItem
        )
      } else if (!localItem && cacheItem && !serverItem) {
        // TODO: remove from mappings
      }
    }

    if ((localItem || serverItem || cacheItem) instanceof Tree.Folder) {
      return await execSync()
    } else {
      this.updateProgress()
      return await this.queue.add(execSync)
    }
  }

  async updateFolder(localItem, cacheItem, serverItem) {
    const localHash = localItem
      ? await localItem.hash(this.preserveOrder)
      : null
    const cacheHash = cacheItem
      ? await cacheItem.hash(this.preserveOrder)
      : null
    const serverHash = serverItem
      ? await serverItem.hash(this.preserveOrder)
      : null
    const changedLocally =
      !cacheItem ||
      (cacheItem && !cacheItem.id) || // if id is not set, changedLocally must be true
      localHash !== cacheHash ||
      localItem.parentId !== cacheItem.parentId
    const changedUpstream =
      localHash !== serverHash ||
      localItem.parentId !==
        this.mappings.folders.ServerToLocal[serverItem.parentId]
    const changed = changedLocally || changedUpstream

    if (localItem !== this.localTreeRoot && changed) {
      // always update local folder
      await this.updateFolderProperties(
        this.mappings.folders.ServerToLocal,
        serverItem,
        localItem,
        this.localTree
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

    // cache initial order
    const remoteOrder = serverItem.children.map(child => ({
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
        return await this.syncTree(addedChild, null, serverChild)
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
          return await this.syncTree(null, removedChild, serverChild)
        },
        this.concurrency
      )
    }

    // don't create/remove items in the absolute root folder
    if (!localItem.isRoot) {
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
          return await this.syncTree(null, null, newChild)
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
                newMappingsSnapshot[cache.type + 's'].ServerToLocal[
                  server.id
                ] === cache.id
            )
        )
        removedUpstream = await Parallel.filter(
          removedUpstream,
          async oldChild => {
            const localChild =
              oldChild instanceof Tree.Folder
                ? this.localTreeRoot.findFolder(oldChild.id)
                : this.localTreeRoot.findBookmark(oldChild.id)
            return await this.syncTree(localChild, oldChild, null)
          },
          this.concurrency
        )
      }

      // ORDER CHILDREN

      if (this.preserveOrder && remoteOrder.length > 1) {
        const newMappingsSnapshot = this.mappings.getSnapshot()
        // always update local tree
        await this.localTree.orderFolder(
          localItem.id,
          remoteOrder.map(item => ({
            id: newMappingsSnapshot[item.type + 's'].ServerToLocal[item.id],
            type: item.type
          }))
        )
      }
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
    const localHash = localItem ? await localItem.hash() : null
    const cacheHash = cacheItem ? await cacheItem.hash() : null
    const serverHash = serverItem ? await serverItem.hash() : null
    const changedLocally =
      (localHash !== serverHash && localHash !== cacheHash) ||
      (cacheItem && localItem.parentId !== cacheItem.parentId)
    const changedUpstream =
      (localHash !== serverHash && cacheHash !== serverHash) ||
      localItem.parentId !==
        this.mappings.folders.ServerToLocal[serverItem.parentId]
    const changed = changedLocally || changedUpstream

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
