export class SyncProcess {
  constructor(mappings, localTreeRoot, cacheTreeRoot, serverTreeRoot) {
    this.localTreeRoot = localTreeRoot
    this.cacheTreeRoot = cacheTreeRoot
    this.serverTreeRoot = serverTreeRoot
  }

  async syncTree(localItem, cacheItem, serverItem) {
    const localHash = localItem ? await localItem.hash() : null
    const serverHash = serverItem ? await serverItem.hash() : null

    if (localHash === serverHash) {
      return
    }

    if (localItem instanceof Tree.Folder) {
      const create = this.createFolder.bind(this)
      const update = this.updateFolder.bind(this)
      const remove = this.removeFolder.bind(this)
      const mappings = this.mappings.folders
    } else {
      const create = this.createBookmark.bind(this)
      const update = this.updateBookmark.bind(this)
      const remove = this.removeBookmark.bind(this)
      const mappings = this.mappings.bookmarks
    }
    if (!localItem && !cacheItem && serverItem) {
      // CREATED UPSTREAM
      await create(
        mappings.ServerToLocal,
        this.serverTreeRoot,
        this.localTreeRoot,
        this.localTree,
        serverItem
      )
    } else if (localItem && !cacheItem && !serverItem) {
      // CREATED LOCALLY
      await create(
        mappings.LocalToServer,
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
      await remove(
        mappings.ServerToLocal,
        this.localTreeRoot,
        this.serverTreeRoot,
        this.server,
        serverItem
      )
    } else if (localItem && cacheItem && !serverItem) {
      // DELETED UPSTREAM
      await remove(
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

  async createFolder(
    mapping,
    fromTree,
    toTree,
    toResource,
    folder /* in fromTree */
  ) {
    // check if it was moved here from somewhere else
    if (folder.moved) return
    var oldFolder
    if ((oldFolder = toTree.findFolder(mapping[folder.id]))) {
      folder.moved = true

      if (toTree === this.localTreeRoot) {
        const cacheFolder = this.cacheTreeRoot.findFolder(oldFolder.id)
        await this.syncTree(folder, cacheFolder, oldFolder)
      } else {
        const cacheFolder = this.cacheTreeRoot.findFolder(folder.id)
        await this.syncTree(oldFolder, cacheFolder, folder)
      }
      return
    }

    const newId = await toResource.createFolder(
      mapping[localItem.parentId],
      folder.title
    )
    // TODO: add to mappings
    await Parallel.each(folder.children, async child => {
      if (toTree === this.localTreeRoot) {
        await this.syncTree(null, null, child)
      } else {
        await this.syncTree(child, null, null)
      }
    })
  }

  async updateFolder(localItem, cacheItem, folderItem) {
    if (localItem === this.localTreeRoot) {
      // NOOP
    } else if ((await localItem.hash()) !== (await cacheItem.hash())) {
      // UPDATED LOCALLY
      await this.updateFolderProperties(
        mappings.folders.LocalToServer,
        localItem,
        serverItem,
        this.server
      )
    } else {
      // UPDATED UPSTREAM
      await this.updateFolderProperties(
        mappings.folders.ServerToLocal,
        localItem,
        serverItem,
        this.localTree
      )
    }

    // LOCAL CHANGES

    localChildren = localItem.children.map(child => child.id)
    cacheChildren = cacheItem.children.map(child => child.id)
    serverChildren = serverItem.children.map(child => child.id)

    // CREATED LOCALLY
    const addedChildren = _.difference(localChildren, cacheChildren)
    await Parallel.each(
      localChildren.filter(child => ~addedChildren.indexOf(child.id)),
      async addedChild => {
        // TODO: Merge this element with some concurrently added upstream one
        await this.syncTree(addedChild, null, null)
      }
    )

    // REMOVED LOCALLY
    const removedChildren = _.difference(cacheChildren, localChildren)
    await Parallel.each(
      cacheChildren.filter(child => ~removedChildren.indexOf(child.id)),
      async removedChild => {
        const serverChild =
          removedChild instanceof Tree.Folder
            ? this.serverTreeRoot.findFolder(
                this.mappings.folders.LocalToServer[removedChild.id]
              )
            : this.serverTreeRoot.findBookmark(
                this.mappings.bookmarks.LocalToServer[removedChild.id]
              )
        await this.syncTree(null, removedChild, serverChild)
      }
    )

    // CREATED UPSTREAM
    const newChildren = _.difference(serverChildren, localChildren)
    await Parallel.each(
      serverChildren.filter(child => ~newChildren.indexOf(child.id)),
      async newChild => {
        await this.syncTree(null, null, newChild)
      }
    )

    // REMOVED UPSTREAM
    const oldChildren = _.difference(serverChildren, cacheChildren)
    await Parallel.each(
      serverChildren.filter(child => ~oldChildren.indexOf(child.id)),
      async oldChild => {
        const localChild =
          oldChild instanceof Tree.Folder
            ? this.localTreeRoot.findFolder(
                this.mappings.folders.LocalToServer[oldChild.id]
              )
            : this.localTreeRoot.findBookmark(
                this.mappings.bookmarks.LocalToServer[oldChild.id]
              )
        await this.syncTree(localChild, oldChild, null)
      }
    )

    // DEAL WITH FOLDERS AND RECURSE UPSTREAM CHANGES

    const existingChildren = _.without(localChildren, addedChildren)
    await Parallel.each(
      localChildren.filter(child => ~existingChildren.indexOf(child.id)),
      async existingChild => {
        const serverChild =
          existingChild instanceof Tree.Folder
            ? this.serverTreeRoot.findFolder(
                this.mappings.folders.LocalToServer[existingChild.id]
              )
            : this.serverTreeRoot.findBookmark(
                this.mappings.bookmarks.LocalToServer[existingChild.id]
              )

        const cacheChild = _.find(
          cacheChildren,
          cacheChild => cacheChild.id === existingChild.id
        )
        await this.syncTree(existingChild, cacheChild, serverChild)
      }
    )
  }

  async updateFolderProperties(mapping, fromFolder, toFolder, toResource) {
    if (toFolder.title !== fromFolder.title) {
      await toResource.updateFolder(toFolder.id, fromFolder.title)
    }
    if (toFolder.parentId !== fromFolder.parentId) {
      await toResource.moveFolder(toFolder.id, mapping[fromFolder.parentId])
    }
  }

  async removeFolder(
    reverseMapping,
    fromTree,
    toTree,
    toResource,
    folder /*in toTree */
  ) {
    // check if it was moved here from somewhere else
    var newFolder
    if ((newFolder = fromTree.findFolder(reverseMapping[folder.id]))) {
      if (newFolder.moved) return
      newFolder.moved = true

      if (toTree === this.localTreeRoot) {
        const cacheFolder = this.cacheTreeRoot.findFolder(folder.id)
        await this.syncTree(folder, cacheFolder, newFolder)
      } else {
        const cacheFolder = this.cacheTreeRoot.findFolder(newFolder.id)
        await this.syncTree(folder, cacheFolder, toFolder)
      }
      return
    }

    await toResource.removeFolder(folder.id)
  }

  async createBookmark(
    mapping,
    fromTree,
    toTree,
    toResource,
    bookmark /* in fromTree */
  ) {
    // check if this has been moved from elsewhere
    if (bookmark.moved) return
    var oldMark
    if ((oldMark = toTree.findBookmark(mapping[bookmark.id]))) {
      // mark as moved to avoid syncing twice
      bookmark.moved = true

      if (toTree === this.localTreeRoot) {
        const cacheMark = this.cacheTreeRoot.findFolder(oldMark.id)
        await this.syncTree(oldMark, cacheMark, folder)
      } else {
        const cacheMark = this.cacheTreeRoot.findFolder(bookmark.id)
        await this.syncTree(bookmark, cacheMark, oldMark)
      }
      return
    }

    const newId = await toTree.createBookmark(
      new Tree.Bookmark({
        parentId: mapping[bookmark.parentId],
        title: bookmark.title,
        url: bookmark.url
      })
    )
    // TODO: Add to mappings
  }

  async updateBookmark(localItem, cacheItem, serverItem) {
    // TODO: DISTINGUISH by hashes
    await this.server.updateBookmark(
      new Tree.Bookmark({
        id: serverItem.id,
        parentId: serverItem.parentId,
        title: localItem.title,
        url: localItem.url
      })
    )
  }

  async removeBookmark(
    reverseMapping,
    fromTree,
    toTree,
    toResource,
    bookmark /* in toTree */
  ) {
    // check if this has been moved elsewhere
    var newMark
    if ((newMark = fromTree.findBookmark(mapping[bookmark.id]))) {
      if (newMark.moved) return
      // mark as moved to avoid syncing twice
      newMark.moved = true

      if (toTree === this.localTreeRoot) {
        const cacheMark = this.cacheTreeRoot.findFolder(bookmark.id)
        await this.syncTree(bookmark, cacheMark, newMark)
      } else {
        const cacheMark = this.cacheTreeRoot.findFolder(newMark)
        await this.syncTree(newMark, cacheMark, bookmark)
      }
      return
    }

    await toTree.removeBookmark(bookmark.id)
    // TODO: Remove from mappings
  }
}
