import * as Tree from './Tree'

const _ = require('lodash')
const Parallel = require('async-parallel')

export default class SyncProcess {
  /**
   * @param mappings {Mappings} The mappings Object
   * @param localTree {LocalTree} The localTree resource object
   * @param cacheTreeRoot {Folder} The tree from the cache
   * @param server {Adapter} the server resource object
   */
  constructor(mappings, localTree, cacheTreeRoot, server) {
    this.mappings = mappings
    this.localTree = localTree
    this.server = server
    this.cacheTreeRoot = cacheTreeRoot
  }

  async sync() {
    await this.syncTree(
      (this.localTreeRoot = await this.localTree.getBookmarksTree()),
      this.cacheTreeRoot,
      (this.serverTreeRoot = await this.server.getBookmarksTree())
    )
  }

  async syncTree(localItem, cacheItem, serverItem) {
    const localHash = localItem ? await localItem.hash() : null
    const serverHash = serverItem ? await serverItem.hash() : null

    console.log('COMPARE', { localItem, cacheItem, serverItem })

    if (localHash === serverHash) {
      console.log('Skipping subtree of ', localItem)
      return
    }

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
      await create(
        this.mappings.bookmarks.ServerToLocal,
        this.mappings.folders.ServerToLocal,
        this.serverTreeRoot,
        this.localTreeRoot,
        this.localTree,
        serverItem
      )
    } else if (localItem && !cacheItem && !serverItem) {
      // CREATED LOCALLY
      await create(
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
    mappingBookmarks,
    mappingFolders,
    fromTree,
    toTree,
    toResource,
    folder /* in fromTree */
  ) {
    // check if it was moved here from somewhere else
    if (folder.moved) return
    var oldFolder
    if ((oldFolder = toTree.findFolder(mappingFolders[folder.id]))) {
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

    // Add to resource
    const newId = await toResource.createFolder(
      mappingFolders[folder.parentId],
      folder.title
    )

    // Add to mappings
    const localId = toTree === this.localTreeRoot ? newId : folder.id
    const remoteId = toTree === this.localTreeRoot ? folder.id : newId
    this.mappings.addFolder({ localId, remoteId })

    // traverse children
    await Parallel.each(folder.children, async child => {
      if (toTree === this.localTreeRoot) {
        await this.syncTree(null, null, child)
      } else {
        await this.syncTree(child, null, null)
      }
    })
  }

  async updateFolder(localItem, cacheItem, serverItem) {
    if (localItem === this.localTreeRoot) {
      // NOOP
    } else if ((await localItem.hash()) !== (await cacheItem.hash())) {
      // UPDATED LOCALLY
      await this.updateFolderProperties(
        this.mappings.folders.LocalToServer,
        localItem,
        serverItem,
        this.server
      )
    } else {
      // UPDATED UPSTREAM
      await this.updateFolderProperties(
        this.mappings.folders.ServerToLocal,
        serverItem,
        localItem,
        this.localTree
      )
    }

    // Add folder to mappings
    this.mappings.addFolder({ localId: localItem.id, remoteId: serverItem.id })

    // LOCAL CHANGES

    // CREATED LOCALLY
    await Parallel.each(
      localItem.children.filter(
        local => !cacheItem.children.some(cache => local.id === cache.id)
      ),
      async addedChild => {
        // TODO: Merge this element with some concurrently added upstream one
        await this.syncTree(addedChild, null, null)
      }
    )

    // REMOVED LOCALLY
    await Parallel.each(
      cacheItem.children.filter(
        cache => !localItem.children.some(local => local.id === cache.id)
      ),
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
    await Parallel.each(
      serverItem.children.filter(
        child =>
          !this.mappings[child instanceof Tree.Folder ? 'folders' : 'bookmarks']
            .ServerToLocal[child.id]
      ),
      async newChild => {
        await this.syncTree(null, null, newChild)
      }
    )

    // REMOVED UPSTREAM
    await Parallel.each(
      cacheItem.children.filter(
        cache =>
          !serverItem.children.some(
            server =>
              this.mappings[
                cache instanceof Tree.Folder ? 'folders' : 'bookmarks'
              ].LocalToServer[cache.id] === server.id
          )
      ),
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

    // RECURSE EXISTING ITEMS

    await Parallel.each(
      localItem.children.filter(local =>
        serverItem.children.some(
          server =>
            this.mappings[
              local instanceof Tree.Folder ? 'folders' : 'bookmarks'
            ].LocalToServer[local.id] === server.id
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

        const cacheChild = _.find(
          cacheItem.children,
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
    if (toFolder.parentId !== mapping[fromFolder.parentId]) {
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

    // remove from resource
    await toResource.removeFolder(folder.id)

    // remove from mappings
    const localId = toTree === this.localTreeRoot ? folder.id : null
    const remoteId = toTree === this.localTreeRoot ? null : folder.id
    this.mappings.removeFolder({ localId, remoteId })
  }

  async createBookmark(
    mappingBookmarks,
    mappingFolders,
    fromTree,
    toTree,
    toResource,
    bookmark /* in fromTree */
  ) {
    // check if this has been moved from elsewhere
    if (bookmark.moved) return
    var oldMark
    if ((oldMark = toTree.findBookmark(mappingBookmarks[bookmark.id]))) {
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

    // create in resource
    const newId = await toResource.createBookmark(
      new Tree.Bookmark({
        parentId: mappingFolders[bookmark.parentId],
        title: bookmark.title,
        url: bookmark.url
      })
    )

    // add to mappings
    const localId = toTree === this.localTreeRoot ? newId : bookmark.id
    const remoteId = toTree === this.localTreeRoot ? bookmark.id : newId
    this.mappings.addBookmark({ localId, remoteId })
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

    this.mappings.addBookmark({
      localId: localItem.id,
      remoteId: serverItem.id
    })
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

    await toResource.removeBookmark(bookmark.id)
    // TODO: Remove from mappings
  }
}
