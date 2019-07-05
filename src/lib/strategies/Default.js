import * as Tree from '../Tree'
import Logger from '../Logger'
import browser from '../browser-api'

const _ = require('lodash')
const Parallel = require('async-parallel')
const PQueue = require('p-queue')
const normalizeMoreAggressively = require('normalize-url')
const { throttle } = require('throttle-debounce')

export default class SyncProcess {
  /**
   * @param mappings {Mappings} The mappings Object
   * @param localTree {LocalTree} The localTree resource object
   * @param cacheTreeRoot {Folder} The tree from the cache
   * @param server {Adapter} the server resource object
   * @param parallel {Boolean} Whether to run the sync in parallel
   * @param progressCb {Function} a callback that will be called with a percentage when there is progress
   */
  constructor(
    mappings,
    localTree,
    cacheTreeRoot,
    server,
    parallel,
    progressCb
  ) {
    this.mappings = mappings
    this.localTree = localTree
    this.server = server
    this.cacheTreeRoot = cacheTreeRoot

    this.preserveOrder = !!this.server.orderFolder

    this.progress = 0.05
    this.progressCb = throttle(250, true, progressCb)
    this.done = 0
    this.canceled = false

    this.queue = new PQueue({ concurrency: parallel ? 100 : Infinity })
    if (parallel) {
      this.concurrency = 10 // grows exponentially with each folder layer
    } else {
      this.concurrency = 1
    }
  }

  updateProgress() {
    this.progressCb(
      Math.max(
        0.05,
        Math.min(
          1,
          this.done /
            Math.max(this.localTreeRoot.count(), this.serverTreeRoot.count())
        )
      )
    )
  }

  async cancel() {
    if (this.canceled) return
    this.canceled = true
  }

  async sync() {
    this.localTreeRoot = await this.localTree.getBookmarksTree()
    this.serverTreeRoot = await this.server.getBookmarksTree()
    this.filterOutUnacceptedBookmarks(this.localTreeRoot)
    await this.filterOutDuplicatesInTheSameFolder(this.localTreeRoot)

    // Load sparse tree
    await this.loadChildren(this.serverTreeRoot, this.mappings.getSnapshot())

    // generate hashtables to find items faster
    this.localTreeRoot.createIndex()
    this.cacheTreeRoot.createIndex()
    this.serverTreeRoot.createIndex()
    await this.syncTree(
      this.localTreeRoot,
      this.cacheTreeRoot,
      this.serverTreeRoot
    )
    if (this.canceled) {
      throw new Error(browser.i18n.getMessage('Error027'))
    }
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
        // Clean up duplicates after normalization algo switch
        try {
          const childUrlNormalized = normalizeMoreAggressively(child.url)
          if (
            child.url === childUrlNormalized &&
            tree.children.some(c => {
              if (!(c instanceof Tree.Bookmark)) return false
              const cUrlNormalized = normalizeMoreAggressively(c.url)
              return (
                cUrlNormalized === childUrlNormalized &&
                c.url !== cUrlNormalized &&
                c.id !== child.id
              )
            })
          ) {
            duplicates.push(child)
            return false
          }
        } catch (e) {
          // sooo, that'd be a no, I guess.
        }
        if (seenUrl[child.url]) {
          duplicates.push(child)
          return false
        }
        seenUrl[child.url] = child
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
    this.updateProgress()
    if (this.canceled) return
    return await this.queue.add(() =>
      this._syncTree(localItem, cacheItem, serverItem)
    )
  }

  async _syncTree(localItem, cacheItem, serverItem) {
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
      return await create(
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
      return await remove(
        mappings.ServerToLocal,
        this.localTreeRoot,
        this.serverTreeRoot,
        this.server,
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

  async loadChildren(serverItem, mappingsSnapshot) {
    if (serverItem instanceof Tree.Bookmark) return
    if (typeof this.server.loadFolderChildren === 'undefined') return
    let localItem, cacheItem
    if (serverItem === this.serverTreeRoot) {
      localItem = this.localTreeRoot
      cacheItem = this.cacheTreeRoot
    } else {
      const localId = mappingsSnapshot.folders.ServerToLocal[serverItem.id]
      localItem = this.localTreeRoot.findFolder(localId)
      cacheItem = this.cacheTreeRoot.findFolder(localId)
    }
    if (
      localItem &&
      !(await this.folderHasChanged(localItem, cacheItem, serverItem)).changed
    ) {
      return
    }
    Logger.log('LOADCHILDREN', serverItem)
    const children = await this.server.loadFolderChildren(serverItem.id)
    if (!children) {
      return
    }
    serverItem.children = children

    // recurse
    await Parallel.each(
      serverItem.children,
      child => this.loadChildren(child, mappingsSnapshot),
      1
    )
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
      return true
    }
    var oldFolder
    if ((oldFolder = toTree.findFolder(mappingFolders[folder.id]))) {
      if (oldFolder.moved) {
        Logger.log(
          'This folder was moved here and concurrently moved somewhere else, ' +
            'but it has been dealt with'
        )
        return false
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
      return true
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

    if (this.preserveOrder) {
      const newMappingsSnapshot = this.mappings.getSnapshot()
      const direction =
        toTree === this.localTreeRoot ? 'ServerToLocal' : 'LocalToServer'
      toResource.orderFolder(
        newId,
        folder.children.map(item => ({
          type: item.type,
          id: newMappingsSnapshot[item.type + 's'][direction][item.id]
        }))
      )
    }

    return true
  }

  async folderHasChanged(localItem, cacheItem, serverItem) {
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
    return { changedLocally, changedUpstream, changed }
  }

  async updateFolder(localItem, cacheItem, serverItem) {
    const {
      changed,
      changedLocally,
      changedUpstream
    } = await this.folderHasChanged(localItem, cacheItem, serverItem)

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
      type: child.type,
      id: child.id
    }))
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
    createdLocally.forEach(newChild => {
      // add to ordering
      remoteOrder.splice(localItem.children.indexOf(newChild), 0, {
        type: newChild.type,
        id: this.mappings.getSnapshot()[newChild.type + 's'].LocalToServer[
          newChild.id
        ]
      })
    })

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
      removedLocally.forEach(oldChild => {
        const serverChild =
          oldChild instanceof Tree.Folder
            ? this.serverTreeRoot.findFolder(
                mappingsSnapshot.folders.LocalToServer[oldChild.id]
              )
            : this.serverTreeRoot.findBookmark(
                mappingsSnapshot.bookmarks.LocalToServer[oldChild.id]
              )
        if (serverChild && serverChild.parentId === serverItem.id) {
          // remove from ordering
          remoteOrder.splice(
            remoteOrder.indexOf(
              remoteOrder.filter(item => item.id === serverChild.id)[0]
            ),
            1
          )
        }
      })
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
      createdUpstream.forEach(newChild => {
        // add to ordering
        localOrder.splice(serverItem.children.indexOf(newChild), 0, {
          type: newChild.type,
          id: this.mappings.getSnapshot()[newChild.type + 's'].ServerToLocal[
            newChild.id
          ]
        })
      })

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
        removedUpstream.forEach(oldChild => {
          const localChild =
            oldChild instanceof Tree.Folder
              ? this.localTreeRoot.findFolder(
                  newMappingsSnapshot.folders.ServerToLocal[oldChild.id]
                )
              : this.localTreeRoot.findBookmark(
                  newMappingsSnapshot.bookmarks.ServerToLocal[oldChild.id]
                )
          if (localChild) {
            // remove from ordering
            localOrder.splice(
              localOrder.indexOf(
                localOrder.filter(item => item.id === localChild.id)[0]
              ),
              1
            )
          }
        })
      }

      // ORDER CHILDREN

      if (this.preserveOrder && localOrder.length > 1) {
        const newMappingsSnapshot = this.mappings.getSnapshot()
        if (changedLocally) {
          await this.server.orderFolder(
            serverItem.id,
            localOrder.map(item => ({
              id: newMappingsSnapshot[item.type + 's'].LocalToServer[item.id],
              type: item.type
            }))
          )
        } else {
          await this.localTree.orderFolder(
            localItem.id,
            remoteOrder.map(item => ({
              id: newMappingsSnapshot[item.type + 's'].ServerToLocal[item.id],
              type: item.type
            }))
          )
        }
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
    if (folder.moved) {
      Logger.log(
        'This folder was removed here and concurrently moved somewhere else ' +
          '-- moves take precedence to preserve data'
      )
      return true
    }

    // check if it was moved from here to somewhere else
    var newFolder
    if ((newFolder = fromTree.findFolder(reverseMapping[folder.id]))) {
      if (newFolder.moved) {
        Logger.log('This folder was moved and has been dealt with')
        return true
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
      return true
    }

    // remove children from resource
    // we do this so that we can check if the folder is actually empty in the end
    // if it isn't, we keep it, cause there's probably some unaccepted stuff in there
    await Parallel.each(folder.children, async child => {
      let serverChild, localChild, cacheChild
      if (toTree === this.serverTreeRoot) {
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
    return true
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
      return true
    }
    var oldMark
    if ((oldMark = toTree.findBookmark(mappingBookmarks[bookmark.id]))) {
      if (oldMark.moved) {
        // local changes are deal with first in updateFolder, thus this is deterministic
        Logger.log(
          'This bookmark was moved here and concurrently moved somewhere else, ' +
            'but it has been dealt with'
        )
        return false
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
      return true
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
    this.done++
    return true
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
    if (bookmark.moved) {
      // local changes are deal with first in updateFolder, thus this is deterministic
      Logger.log(
        'This bookmark was removed here and concurrently moved somewhere else -- moves take precedence'
      )
      return true
    }

    // check if this has been moved elsewhere
    var newMark
    if ((newMark = fromTree.findBookmark(reverseMapping[bookmark.id]))) {
      if (newMark.moved) {
        Logger.log('This bookmark was moved from here and has been dealt with')
        return true
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
      return true
    }

    await toResource.removeBookmark(bookmark.id)
    await this.mappings.removeBookmark({
      [toResource === this.localTreeRoot ? 'localId' : 'remoteId']: bookmark.id
    })
    this.done++
    return true
  }
}
