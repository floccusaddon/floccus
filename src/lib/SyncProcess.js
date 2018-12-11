import * as Tree from './Tree'
import Logger from './Logger'

const _ = require('lodash')
const Parallel = require('async-parallel')
const PQueue = require('p-queue')

export default class SyncProcess {
  /**
   * @param mappings {Mappings} The mappings Object
   * @param localTree {LocalTree} The localTree resource object
   * @param cacheTreeRoot {Folder} The tree from the cache
   * @param server {Adapter} the server resource object
   */
  constructor(mappings, localTree, cacheTreeRoot, server, parallel) {
    this.mappings = mappings
    this.localTree = localTree
    this.server = server
    this.cacheTreeRoot = cacheTreeRoot
    this.preserveOrder = !!this.server.orderFolder
    this.queue = new PQueue({ concurrency: parallel ? 100 : Infinity }) // 2^6 = 64 => max supported folder layers: 6
    if (parallel) {
      this.concurrency = 2 // grows exponentially with each folder layer
    } else {
      this.concurrency = 1
    }
  }

  async sync() {
    this.localTreeRoot = await this.localTree.getBookmarksTree()
    this.serverTreeRoot = await this.server.getBookmarksTree()
    this.filterOutUnacceptedBookmarks(this.localTreeRoot)
    await this.filterOutDuplicatesInTheSameFolder(this.localTreeRoot)

    // generate hashtables to find items faster
    this.localTreeRoot.createIndex()
    this.cacheTreeRoot.createIndex()
    this.serverTreeRoot.createIndex()
    await this.syncTree(
      this.localTreeRoot,
      this.cacheTreeRoot,
      this.serverTreeRoot
    )
  }

  filterOutUnacceptedBookmarks(tree) {
    tree.children = tree.children.filter(child => {
      if (child instanceof Tree.Bookmark) {
        if (!this.server.acceptsBookmark(child)) {
          return false
        }
        return true
      } else {
        this.filterOutUnacceptedBookmarks(child)
        return true
      }
    })
  }

  async filterOutDuplicatesInTheSameFolder(tree) {
    const seenUrl = {}
    const duplicates = []
    tree.children = tree.children.filter(child => {
      if (child instanceof Tree.Bookmark) {
        if (seenUrl[child.url]) {
          duplicates.push(child)
          return false
        }
        seenUrl[child.url] = true
      } else {
        this.filterOutDuplicatesInTheSameFolder(child)
      }
      return true
    })
    Logger.log(
      'Filtered out the following duplicates before syncing',
      duplicates
    )
    await Promise.all(
      duplicates.map(bm => this.localTree.removeBookmark(bm.id))
    )
  }

  async syncTree(localItem, cacheItem, serverItem) {
    await this.queue.add(async () => {
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
    })
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
    if (folder.moved) {
      Logger.log('This folder was moved and has been dealt with')
      return
    }
    var oldFolder
    if ((oldFolder = toTree.findFolder(mappingFolders[folder.id]))) {
      if (oldFolder.moved) {
        Logger.log(
          'This folder was moved here and concurrently moved somewhere else, ' +
            'but it has been dealt with'
        )
        return
      }

      folder.moved = true
      Logger.log('This folder was moved here')

      if (toTree === this.localTreeRoot) {
        const cacheFolder = this.cacheTreeRoot.findFolder(oldFolder.id)
        await this.syncTree(oldFolder, cacheFolder, folder)
      } else {
        const cacheFolder = this.cacheTreeRoot.findFolder(folder.id)
        await this.syncTree(folder, cacheFolder, oldFolder)
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
    await this.mappings.addFolder({ localId, remoteId })

    // traverse children
    await Parallel.each(
      folder.children,
      async child => {
        if (toTree === this.localTreeRoot) {
          // from=server => created on the server
          await this.syncTree(null, null, child)
        } else {
          // from=local => created locally
          await this.syncTree(child, null, null)
        }
      },
      this.concurrency
    )
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
    const changed =
      localHash !== serverHash ||
      localItem.parentId !==
        this.mappings.folders.ServerToLocal[serverItem.parentId]
    const changedLocally =
      (cacheItem && !cacheItem.id) || // if id is not set, changedLocally must be true
      (localHash !== cacheHash || localItem.parentId !== cacheItem.parentId)
    const changedUpstream =
      cacheHash !== serverHash ||
      localItem.parentId !==
        this.mappings.folders.ServerToLocal[serverItem.parentId]

    if (localItem !== this.localTreeRoot && changed) {
      if (changedLocally) {
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
      type: child instanceof Tree.Folder ? 'folder' : 'bookmark',
      id: child.id
    }))

    // CREATED LOCALLY
    await Parallel.each(
      localItem.children.filter(
        local =>
          !cacheItem || !cacheItem.children.some(cache => local.id === cache.id)
      ),
      async addedChild => {
        // merge this with an item created on the server
        const serverChild = _.find(serverItem.children, serverChild => {
          if (
            serverChild instanceof Tree.Folder &&
            addedChild instanceof Tree.Folder
          ) {
            return serverChild.title === addedChild.title
          } else if (
            serverChild instanceof Tree.Bookmark &&
            addedChild instanceof Tree.Bookmark
          ) {
            return serverChild.url === addedChild.url
          }
          return false
        })
        if (serverChild) serverChild.merged = true
        await this.syncTree(addedChild, null, serverChild)
      },
      this.concurrency
    )

    // REMOVED LOCALLY
    if (cacheItem) {
      await Parallel.each(
        cacheItem.children.filter(
          cache => !localItem.children.some(local => local.id === cache.id)
        ),
        async removedChild => {
          const serverChild =
            removedChild instanceof Tree.Folder
              ? this.serverTreeRoot.findFolder(
                  mappingsSnapshot.folders.LocalToServer[removedChild.id]
                )
              : this.serverTreeRoot.findBookmark(
                  mappingsSnapshot.bookmarks.LocalToServer[removedChild.id]
                )
          await this.syncTree(null, removedChild, serverChild)
        },
        this.concurrency
      )
    }

    // don't create/remove items in the absolute root folder
    if (!localItem.isRoot) {
      // take a new snapshot since the server or we ourselves might have deduplicated above
      mappingsSnapshot = this.mappings.getSnapshot()

      // CREATED UPSTREAM
      await Parallel.each(
        serverItem.children.filter(
          child =>
            !(cacheItem || localItem).children.some(
              cacheChild =>
                mappingsSnapshot[
                  child instanceof Tree.Folder ? 'folders' : 'bookmarks'
                ].ServerToLocal[child.id] === cacheChild.id
            )
        ),
        async newChild => {
          if (newChild.merged) return
          await this.syncTree(null, null, newChild)
          // add to ordering
          localOrder.splice(serverItem.children.indexOf(newChild), 0, {
            type: newChild instanceof Tree.Folder ? 'folder' : 'bookmark',
            id: this.mappings.getSnapshot()[
              newChild instanceof Tree.Folder ? 'folders' : 'bookmarks'
            ].ServerToLocal[newChild.id]
          })
        },
        this.concurrency
      )

      // REMOVED UPSTREAM
      if (cacheItem) {
        await Parallel.each(
          cacheItem.children.filter(
            cache =>
              !serverItem.children.some(
                server =>
                  mappingsSnapshot[
                    cache instanceof Tree.Folder ? 'folders' : 'bookmarks'
                  ].ServerToLocal[server.id] === cache.id
              )
          ),
          async oldChild => {
            const localChild =
              oldChild instanceof Tree.Folder
                ? this.localTreeRoot.findFolder(oldChild.id)
                : this.localTreeRoot.findBookmark(oldChild.id)
            await this.syncTree(localChild, oldChild, null)
            if (localChild) {
              // remove from ordering
              localOrder.splice(
                localOrder.indexOf(
                  localOrder.filter(item => item.id === localChild.id)[0]
                ),
                1
              )
            }
          },
          this.concurrency
        )
      }

      // ORDER CHILDREN

      if (this.preserveOrder && localOrder.length > 1) {
        const newMappingsSnapshot = this.mappings.getSnapshot()
        await this.localTree.orderFolder(localItem.id, localOrder)
        await this.server.orderFolder(
          serverItem.id,
          localOrder.map(item => ({
            type: item.type,
            id: newMappingsSnapshot[item.type + 's'].LocalToServer[item.id]
          }))
        )
      }
    }

    // RECURSE EXISTING ITEMS

    await Parallel.each(
      localItem.children.filter(local =>
        serverItem.children.some(
          server =>
            mappingsSnapshot[
              local instanceof Tree.Folder ? 'folders' : 'bookmarks'
            ].ServerToLocal[server.id] === local.id
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
    // check if it was moved from here to somewhere else
    var newFolder
    if ((newFolder = fromTree.findFolder(reverseMapping[folder.id]))) {
      if (newFolder.moved || folder.moved) {
        Logger.log('This folder was moved and has been dealt with')
        return
      }

      newFolder.moved = true
      Logger.log('This folder was moved from here')

      if (toTree === this.localTreeRoot) {
        const cacheFolder = this.cacheTreeRoot.findFolder(folder.id)
        await this.syncTree(folder, cacheFolder, newFolder)
      } else {
        const cacheFolder = this.cacheTreeRoot.findFolder(newFolder.id)
        await this.syncTree(newFolder, cacheFolder, folder)
      }
      return
    }

    if (folder.moved) {
      Logger.log(
        'This folder was removed here and concurrently moved somewhere else ' +
          '-- moves take precedence to preserve data'
      )
      return
    }

    // remove children from resource
    // we do this so that we can check if the folder is actually empty in the end
    // if it isn't, we keep it, cause there's probably some unaccepted stuff in there
    await Parallel.each(folder.children, async child => {
      let serverChild, localChild, cacheChild
      if (toResource === this.server) {
        serverChild = child
        cacheChild =
          serverChild instanceof Tree.Folder
            ? this.cacheTreeRoot.findFolder(
                this.mappings.folders.ServerToLocal[serverChild.id]
              )
            : this.cacheTreeRoot.findBookmark(
                this.mappings.bookmarks.ServerToLocal[serverChild.id]
              )
      } else {
        localChild = child
        cacheChild =
          localChild instanceof Tree.Folder
            ? this.cacheTreeRoot.findFolder(localChild.id)
            : this.cacheTreeRoot.findBookmark(localChild.id)
      }

      await this.syncTree(localChild, cacheChild, serverChild)
    })
    // remove folder from resource
    await toResource.removeFolder(folder.id)

    // remove from mappings
    const localId = toTree === this.localTreeRoot ? folder.id : null
    const remoteId = toTree === this.localTreeRoot ? null : folder.id
    await this.mappings.removeFolder({ localId, remoteId })
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
    if (bookmark.moved) {
      Logger.log('This bookmark was moved here and has been dealt with')
      return
    }
    var oldMark
    if ((oldMark = toTree.findBookmark(mappingBookmarks[bookmark.id]))) {
      if (oldMark.moved) {
        // local changes are deal with first in updateFolder, thus this is deterministic
        Logger.log(
          'This bookmark was moved here and concurrently moved somewhere else, ' +
            'but it has been dealt with'
        )
        return
      }
      // mark as moved to avoid syncing twice
      bookmark.moved = true
      Logger.log('This bookmark was moved here')

      if (toTree === this.localTreeRoot) {
        const cacheMark = this.cacheTreeRoot.findBookmark(oldMark.id)
        await this.syncTree(oldMark, cacheMark, bookmark)
      } else {
        const cacheMark = this.cacheTreeRoot.findBookmark(bookmark.id)
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
    await this.mappings.addBookmark({ localId, remoteId })
  }

  async updateBookmark(localItem, cacheItem, serverItem) {
    const localHash = localItem ? await localItem.hash() : null
    const cacheHash = cacheItem ? await cacheItem.hash() : null
    const serverHash = serverItem ? await serverItem.hash() : null
    const changed =
      localHash !== serverHash ||
      localItem.parentId !==
        this.mappings.folders.ServerToLocal[serverItem.parentId]
    const changedLocally =
      localHash !== cacheHash || localItem.parentId !== cacheItem.parentId
    const changedUpstream = cacheHash !== serverHash

    await this.mappings.addBookmark({
      localId: localItem.id,
      remoteId: serverItem.id
    })

    if (!changed) {
      Logger.log('Bookmark unchanged')
      return
    }

    let newServerId
    if (changedLocally) {
      newServerId = await this.server.updateBookmark(
        new Tree.Bookmark({
          id: serverItem.id,
          parentId: this.mappings.folders.LocalToServer[localItem.parentId],
          title: localItem.title,
          url: localItem.url
        })
      )
    } else {
      await this.localTree.updateBookmark(
        new Tree.Bookmark({
          id: localItem.id,
          parentId: this.mappings.folders.ServerToLocal[serverItem.parentId],
          title: serverItem.title,
          url: serverItem.url
        })
      )
    }

    await this.mappings.addBookmark({
      localId: localItem.id,
      remoteId: newServerId || serverItem.id
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
    if ((newMark = fromTree.findBookmark(reverseMapping[bookmark.id]))) {
      if (newMark.moved || bookmark.moved) {
        Logger.log('This bookmark was moved from here and has been dealt with')
        return
      }
      // mark as moved to avoid syncing twice
      newMark.moved = true
      Logger.log('This bookmark was moved')

      if (toTree === this.localTreeRoot) {
        const cacheMark = this.cacheTreeRoot.findBookmark(bookmark.id)
        await this.syncTree(bookmark, cacheMark, newMark)
      } else {
        const cacheMark = this.cacheTreeRoot.findBookmark(newMark.id)
        await this.syncTree(newMark, cacheMark, bookmark)
      }
      return
    }

    if (bookmark.moved) {
      // local changes are deal with first in updateFolder, thus this is deterministic
      Logger.log(
        'This bookmark was removed here and concurrently moved somewhere else -- moves take precedence'
      )
      return
    }

    await toResource.removeBookmark(bookmark.id)
    await this.mappings.removeBookmark({
      [toResource === this.localTreeRoot ? 'localId' : 'remoteId']: bookmark.id
    })
  }
}
