import * as Tree from '../Tree'
import Logger from '../Logger'
import browser from '../browser-api'
import OrderTracker from '../OrderTracker'

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

    this.preserveOrder = ('orderFolder' in this.server)

    this.progress = 0.05
    this.progressCb = throttle(250, true, progressCb)
    this.done = 0
    this.canceled = false

    // The queue concurrency is for bookmark syncTree tasks
    this.queue = new PQueue({ concurrency: 20 })
    // the `concurrency` is for folder tasks created in a parent folder
    if (parallel) {
      this.concurrency = 10
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

    if ('hasFeatureHashing' in this.server) {
      const roughFolderDiff =
        this.localTreeRoot.countFolders() - this.serverTreeRoot.countFolders()
      if (roughFolderDiff > -100) {
        // Load sparse tree
        await this.loadChildren(
          this.serverTreeRoot,
          this.mappings.getSnapshot()
        )
      } else {
        // rather load the complete tree, as we do less requests this way
        this.serverTreeRoot = await this.server.getBookmarksTree(true)
      }
    }

    // generate hashtables to find items faster
    this.localTreeRoot.createIndex()
    this.cacheTreeRoot.createIndex()
    this.serverTreeRoot.createIndex()
    await this.syncTree({
      localItem: this.localTreeRoot,
      cacheItem: this.cacheTreeRoot,
      serverItem: this.serverTreeRoot
    })
    if (this.canceled) {
      throw new Error(browser.i18n.getMessage('Error027'))
    }
  }

  filterOutUnacceptedBookmarks(tree) {
    tree.children = tree.children.filter(child => {
      if (child instanceof Tree.Bookmark) {
        return this.server.acceptsBookmark(child)
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
    duplicates.length &&
    Logger.log(
      'Filtered out the following duplicates before syncing',
      duplicates
    )
    await Promise.all(
      duplicates.map(bm => this.localTree.removeBookmark(bm.id))
    )
  }

  async syncTree({ localItem, cacheItem, serverItem, localOrder, serverOrder }) {
    await new Promise(resolve => setImmediate(resolve))
    this.updateProgress()
    if (this.canceled) throw new Error('Sync cancelled')
    if ((localItem || serverItem || cacheItem) instanceof Tree.Folder) {
      return this._syncTree({ localItem, cacheItem, serverItem, localOrder, serverOrder })
    } else {
      return this.queue.add(() =>
        this._syncTree({ localItem, cacheItem, serverItem, localOrder, serverOrder })
      )
    }
  }

  async _syncTree({ localItem, cacheItem, serverItem, localOrder, serverOrder }) {
    if (this.canceled) throw new Error('Sync cancelled')
    Logger.log('COMPARE', { localItem, cacheItem, serverItem })

    let mappings = this.mappings.getSnapshot()
    let item = (localItem || serverItem || cacheItem)

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
      return item.visitCreate(this, {
        mapping: mappings.LocalToServer,
        toTree: this.serverTreeRoot,
        toResource: this.server,
        toOrder: serverOrder,
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
      return item.visitRemove(this, {
        reverseMapping: mappings.ServerToLocal,
        fromTree: this.localTreeRoot,
        toTree: this.serverTreeRoot,
        toResource: this.server,
        toOrder: serverOrder,
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
        await this.mappings.removeBookmark({localId: cacheItem.id})
      }else{
        await this.mappings.removeFolder({localId: cacheItem.id})
      }
    }
  }

  async loadChildren(serverItem, mappingsSnapshot) {
    if (this.canceled) {
      throw new Error(browser.i18n.getMessage('Error027'))
    }
    if (serverItem instanceof Tree.Bookmark) return
    if ('loadFolderChildren' in this.server) return
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
      this.concurrency
    )

    // recalculate hash
    serverItem.hashValue = {}
    await serverItem.hash(true)
  }

  async createFolder({
                       mapping,
                       toTree,
                       toResource,
                       toOrder,
                       item: folder/* in fromTree */
                     }) {
    if (toTree.findFolder(mapping.folders[folder.parentId]).isRoot) {
      Logger.log(
        'We\'re not allowed to change any direct children of the absolute root folder. Skipping.'
      )
      return
    }
    let oldFolder
    if ((oldFolder = toTree.findFolder(mapping.folders[folder.id]))) {
      if (oldFolder.moved) {
        Logger.log(
          'This folder was moved here and concurrently moved somewhere else, ' +
          'but it has been dealt with'
        )
        return
      }

      // check if it was moved here from somewhere else
      if (folder.moved) {
        Logger.log('This folder was moved and has been dealt with in a delete branch')
        // Add to order
        toOrder.insert('folder', folder.id, oldFolder.id)
        return
      }


      folder.moved = true
      Logger.log('This folder was moved here')

      // Add to order
      toOrder.insert('folder', folder.id, oldFolder.id)

      if (toTree === this.localTreeRoot) {
        const cacheFolder = this.cacheTreeRoot.findFolder(oldFolder.id)
        await this.syncTree({ localItem: oldFolder, cacheItem: cacheFolder, serverItem: folder })
      } else {
        const cacheFolder = this.cacheTreeRoot.findFolder(folder.id)
        await this.syncTree({ localItem: folder, cacheItem: cacheFolder, serverItem: oldFolder })
      }
      return
    }

    // Add to resource
    const newId = await toResource.createFolder(
      mapping.folders[folder.parentId],
      folder.title
    )

    // Add to order
    toOrder.insert('folder', folder.id, newId)

    // Add to mappings
    const localId = toTree === this.localTreeRoot ? newId : folder.id
    const remoteId = toTree === this.localTreeRoot ? folder.id : newId
    await this.mappings.addFolder({ localId, remoteId })

    let importedFolder
    if (toResource.bulkImportFolder) {
      try {
        importedFolder = await toResource.bulkImportFolder(newId, folder)
        importedFolder.parentId = mapping.folders[folder.parentId]
      } catch (e) {
        Logger.log('Bulk import failed')
        Logger.log(e)
      }
    }

    if (importedFolder) {
      // We've bulk imported the whole folder contents, now
      // we have to link them
      console.log('Imported folder:', importedFolder)
      if (toTree === this.localTreeRoot) {
        // from=server to=local
        await this.syncTree({ localItem: importedFolder, serverItem: folder })
      } else {
        // from=local to=server <-- this is usually the case as LocalTree doesn't have bulkImport
        await this.syncTree({ localItem: folder, serverItem: importedFolder })
      }
    } else {
      // we couldn't bulk import, so we
      // traverse children and add them one by one

      const orderTracker = new OrderTracker({ fromFolder: folder })

      await Parallel.each(
        folder.children,
        async child => {
          if (toTree === this.localTreeRoot) {
            // from=server => was created on the server
            await this.syncTree({ serverItem: child, localOrder: orderTracker })
          } else {
            // from=local => was created locally
            await this.syncTree({ localItem: child, serverOrder: orderTracker })
          }
        },
        this.concurrency
      )

      if (this.preserveOrder) {
        await toResource.orderFolder(
          newId,
          orderTracker.getOrder()
        )
      }
    }
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
    const reconciled = !cacheItem
    const enPar = localHash === serverHash
    const changedLocally =
      (localHash !== cacheHash && localHash !== serverHash) ||
      (cacheItem && localItem.parentId !== cacheItem.parentId)
    const changedUpstream =
      (cacheHash !== serverHash && localHash !== serverHash) ||
      (cacheItem &&
        cacheItem.parentId !==
        this.mappings.folders.ServerToLocal[serverItem.parentId])
    const changed = changedLocally || changedUpstream || reconciled
    return { changedLocally, changedUpstream, changed, reconciled, enPar }
  }

  async updateFolder(localItem, cacheItem, serverItem) {
    const { changed } = await this.folderHasChanged(localItem, cacheItem, serverItem)

    await this.syncFolderProperties(localItem, cacheItem, serverItem)

    // Add folder to mappings
    await this.mappings.addFolder({
      localId: localItem.id,
      remoteId: serverItem.id
    })

    if (!changed) {
      Logger.log('Skipping subtree')
      this.done += localItem.count()
      return
    }

    Logger.log('Checking subtree')

    // LOCAL CHANGES

    let mappingsSnapshot = this.mappings.getSnapshot()
    let localOrder = new OrderTracker({ fromFolder: serverItem, toFolder: localItem })
    let serverOrder = new OrderTracker({ fromFolder: localItem, toFolder: serverItem })

    // CREATED LOCALLY
    let createdLocally = localItem.children.filter(
      local =>
        !cacheItem || !cacheItem.children.some(cache => local.id === cache.id)
    )
    await Parallel.each(
      createdLocally,
      async addedChild => {
        // merge this with an item created on the server
        const serverChild = _.find(serverItem.children, serverChild => {
          return serverChild.canMergeWith(addedChild) && !serverChild.merged
        })
        if (serverChild) serverChild.merged = true
        await this.syncTree({ localItem: addedChild, serverItem: serverChild, localOrder, serverOrder })
      },
      this.concurrency
    )

    // REMOVED LOCALLY
    let removedLocally = cacheItem ? cacheItem.children.filter(
      cache => !localItem.children.some(local => local.id === cache.id)
      )
      : []
    await Parallel.each(
      removedLocally,
      async removedChild => {
        const serverChild =
          this.serverTreeRoot.findItem(removedChild.type, mappingsSnapshot.LocalToServer[removedChild.type + 's'][removedChild.id])
        await this.syncTree({ cacheItem: removedChild, serverItem: serverChild, serverOrder, localOrder })
      },
      this.concurrency
    )

    // take a new snapshot since the server or we ourselves might have deduplicated above
    let newMappingsSnapshot = this.mappings.getSnapshot()

    // CREATED UPSTREAM
    let createdUpstream = serverItem.children.filter(
      child =>
        !(cacheItem || localItem).children.some(
          cacheChild =>
            mappingsSnapshot.ServerToLocal[child.type + 's'][child.id] ===
            cacheChild.id ||
            newMappingsSnapshot.ServerToLocal[child.type + 's'][child.id] ===
            cacheChild.id
        )
    )
    await Parallel.each(
      createdUpstream,
      async newChild => {
        if (newChild.merged) return false
        await this.syncTree({ serverItem: newChild, localOrder, serverOrder })
      },
      this.concurrency
    )

    // REMOVED UPSTREAM
    let removedUpstream = cacheItem ?
      cacheItem.children.filter(
        cache =>
          !serverItem.children.some(
            server =>
              mappingsSnapshot.ServerToLocal[cache.type + 's'][server.id] ===
              cache.id ||
              newMappingsSnapshot.ServerToLocal[cache.type + 's'][
                server.id
                ] === cache.id
          )
      )
      : []
    await Parallel.each(
      removedUpstream,
      async oldChild => {
        const localChild =
          this.localTreeRoot.findItem(oldChild.type, oldChild.id)
        await this.syncTree({ localItem: localChild, cacheItem: oldChild, localOrder, serverOrder })
      },
      this.concurrency
    )

    // ORDER CHILDREN
    await this.syncChildOrder({ localItem, cacheItem, serverItem, localOrder, serverOrder })

    // RECURSE EXISTING ITEMS

    mappingsSnapshot = this.mappings.getSnapshot()

    let existingItems =
      localItem.children.filter(local =>
        serverItem.children.some(
          server =>
            mappingsSnapshot.ServerToLocal[local.type + 's'][server.id] ===
            local.id
        )
      )
    await Parallel.each(
      existingItems,
      async existingChild => {
        const serverChild = this.serverTreeRoot.findItem(
          existingChild.type,
          mappingsSnapshot.LocalToServer[existingChild.type + 's'][existingChild.id]
        )

        const cacheChild = cacheItem
          ? _.find(
            cacheItem.children,
            cacheChild => cacheChild.id === existingChild.id
          )
          : null
        await this.syncTree({ localItem: existingChild, cacheItem: cacheChild, serverItem: serverChild })
      },
      this.concurrency
    )
  }

  async syncChildOrder({ localItem, cacheItem, serverItem, localOrder, serverOrder }) {
    const newMappingsSnapshot = this.mappings.getSnapshot()
    const {
      changedLocally,
      reconciled,
      enPar
    } = await this.folderHasChanged(localItem, cacheItem, serverItem)

    if (this.preserveOrder && !enPar) {
      if (changedLocally || reconciled) {
        await this.server.orderFolder(
          serverItem.id,
          localOrder.getOrder().map(item => ({
            id: newMappingsSnapshot[item.type + 's'].LocalToServer[item.id],
            type: item.type
          }))
        )
      } else {
        await this.localTree.orderFolder(
          localItem.id,
          serverOrder.getOrder().map(item => ({
            id: newMappingsSnapshot[item.type + 's'].ServerToLocal[item.id],
            type: item.type
          }))
        )
      }
    }
  }

  async syncFolderProperties(localItem, cacheItem, serverItem) {
    const {
      changed,
      changedLocally,
      reconciled
    } = await this.folderHasChanged(localItem, cacheItem, serverItem)

    const mappings = this.mappings.getSnapshot()

    if (localItem !== this.localTreeRoot && changed) {
      if (changedLocally || reconciled) {
        // UPDATED LOCALLY
        await this.updateFolderProperties({
          mapping: mappings.LocalToServer,
          fromFolder: localItem,
          toFolder: serverItem,
          toResource: this.server
        })
      } else {
        // UPDATED UPSTREAM
        await this.updateFolderProperties({
          mapping: mappings.ServerToLocal,
          fromFolder: serverItem,
          toFolder: localItem,
          toResource: this.localTree
        })
      }
    }
  }

  async updateFolderProperties({ mapping, fromFolder, toFolder, toResource }) {
    if (toFolder.title !== fromFolder.title) {
      await toResource.updateFolder(toFolder.id, fromFolder.title)
    }
    if (toFolder.parentId !== mapping.folders[fromFolder.parentId]) {
      await toResource.moveFolder(toFolder.id, mapping.folders[fromFolder.parentId])
    }
  }

  async removeFolder({
                       reverseMapping,
                       fromTree,
                       toTree,
                       toResource,
                       toOrder,
                       item: folder /* in toTree */
                     }) {
    if (toTree.findFolder(folder.parentId).isRoot) {
      Logger.log(
        'We\'re not allowed to change any direct children of the absolute root folder. Skipping.'
      )
      return
    }

    if (folder.moved) {
      Logger.log(
        'This folder was removed here and concurrently moved somewhere else ' +
        '-- moves take precedence to preserve data'
      )
      return
    }

    // check if it was moved from here to somewhere else
    let newFolder
    if ((newFolder = fromTree.findFolder(reverseMapping.folders[folder.id]))) {
      if (newFolder.moved) {
        Logger.log('This folder was moved and has been dealt with')

        // remove from order
        toOrder.remove('folder', folder.id)
        return
      }

      newFolder.moved = true
      Logger.log('This folder was moved from here')

      // remove from order
      toOrder.remove('folder', folder.id)

      if (toTree === this.localTreeRoot) {
        const cacheFolder = this.cacheTreeRoot.findFolder(folder.id)
        await this.syncTree({ localItem: folder, cacheItem: cacheFolder, serverItem: newFolder })
      } else {
        const cacheFolder = this.cacheTreeRoot.findFolder(newFolder.id)
        await this.syncTree({ localItem: newFolder, cacheItem: cacheFolder, serverItem: folder })
      }
      return
    }

    // remove children from resource
    // we do this so that we can check if the folder is actually empty in the end
    // if it isn't, we keep it, cause there's probably some unaccepted stuff in there
    await Parallel.each(folder.children, async child => {
      let serverChild, localChild, cacheChild
      if (toTree === this.serverTreeRoot) {
        serverChild = child
        cacheChild = this.cacheTreeRoot.findItem(serverChild.type, this.mappings.getSnapshot().ServerToLocal[serverChild.type + 's'][serverChild.id])
      } else {
        localChild = child
        cacheChild = this.cacheTreeRoot.findItem(localChild.type, localChild.id)
      }

      await this.syncTree({ localChild, cacheChild, serverChild })
    })
    // remove folder from resource
    await toResource.removeFolder(folder.id)

    // remove from order
    toOrder.remove('folder', folder.id)

    // remove from mappings
    const localId = toTree === this.localTreeRoot ? folder.id : null
    const remoteId = toTree === this.localTreeRoot ? null : folder.id
    await this.mappings.removeFolder({ localId, remoteId })
  }

  async createBookmark({
                         mapping,
                         toTree,
                         toResource,
                         toOrder,
                         item: bookmark /* in fromTree */
                       }) {
    if (toTree.findFolder(mapping.folders[bookmark.parentId]).isRoot) {
      Logger.log(
        'We\'re not allowed to change any direct children of the absolute root folder. Skipping.'
      )
      return
    }
    let oldMark
    if ((oldMark = toTree.findBookmark(mapping.bookmarks[bookmark.id]))) {
      if (oldMark.moved) {
        // local changes are deal with first in updateFolder, thus this is deterministic
        Logger.log(
          'This bookmark was moved here and concurrently moved somewhere else, ' +
          'but it has been dealt with'
        )
        return
      }

      if (bookmark.moved) {
        Logger.log('This bookmark was moved here and has been dealt with')
        // add to order
        toOrder.insert('bookmark', oldMark.id)
        return
      }

      // mark as moved to avoid syncing twice
      bookmark.moved = true
      Logger.log('This bookmark was moved here')

      // add to order
      toOrder.insert('bookmark', oldMark.id)

      if (toTree === this.localTreeRoot) {
        const cacheMark = this.cacheTreeRoot.findBookmark(oldMark.id)
        await this.syncTree({ localItem: oldMark, cacheItem: cacheMark, serverItem: bookmark })
      } else {
        const cacheMark = this.cacheTreeRoot.findBookmark(bookmark.id)
        await this.syncTree({ localItem: bookmark, cacheItem: cacheMark, serverItem: oldMark })
      }
      return true
    }

    // create in resource
    const newId = await toResource.createBookmark(
      new Tree.Bookmark({
        parentId: mapping.folders[bookmark.parentId],
        title: bookmark.title,
        url: bookmark.url
      })
    )

    // add to order
    toOrder.insert('bookmark', newId)

    // add to mappings
    const localId = toTree === this.localTreeRoot ? newId : bookmark.id
    const remoteId = toTree === this.localTreeRoot ? bookmark.id : newId
    await this.mappings.addBookmark({ localId, remoteId })

    this.done++
  }

  async bookmarkHasChanged(localItem, cacheItem, serverItem) {
    const localHash = localItem ? await localItem.hash() : null
    const cacheHash = cacheItem ? await cacheItem.hash() : null
    const serverHash = serverItem ? await serverItem.hash() : null
    const changedLocally =
      (localHash !== serverHash && localHash !== cacheHash) ||
      (cacheItem && localItem.parentId !== cacheItem.parentId)
    const changedUpstream =
      (localHash !== serverHash && cacheHash !== serverHash) ||
      (cacheItem &&
        cacheItem.parentId !==
        this.mappings.folders.ServerToLocal[serverItem.parentId])
    const reconciled = !cacheItem && localHash !== serverHash
    const changed = changedLocally || changedUpstream || reconciled
    return { changed, changedLocally, changedUpstream, reconciled }
  }

  async updateBookmark(localItem, cacheItem, serverItem) {
    const {
      changed,
      changedLocally,
      reconciled
    } = await this.bookmarkHasChanged(localItem, cacheItem, serverItem)

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
    if (changedLocally || reconciled) {
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

  async removeBookmark({
                         reverseMapping,
                         fromTree,
                         toTree,
                         toResource,
                         toOrder,
                         item: bookmark /* in toTree */
                       }) {
    if (toTree.findFolder(bookmark.parentId).isRoot) {
      Logger.log(
        'We\'re not allowed to change any direct children of the absolute root folder. Skipping.'
      )
      return false
    }
    if (bookmark.moved) {
      // local changes are deal with first in updateFolder, thus this is deterministic
      Logger.log(
        'This bookmark was removed here and concurrently moved somewhere else -- moves take precedence'
      )
      return true
    }

    // check if this has been moved elsewhere
    let newMark
    if ((newMark = fromTree.findBookmark(reverseMapping.bookmarks[bookmark.id]))) {
      if (newMark.moved) {
        Logger.log('This bookmark was moved from here and has been dealt with')

        // remove bookmark from order
        toOrder.remove('bookmark', bookmark.id)
        return
      }
      // mark as moved to avoid syncing twice
      newMark.moved = true
      Logger.log('This bookmark was moved')

      // remove bookmark from order
      toOrder.remove('bookmark', bookmark.id)

      if (toTree === this.localTreeRoot) {
        const cacheMark = this.cacheTreeRoot.findBookmark(bookmark.id)
        await this.syncTree({localItem: bookmark, cacheItem: cacheMark, serverItem: newMark})
      } else {
        const cacheMark = this.cacheTreeRoot.findBookmark(newMark.id)
        await this.syncTree({localItem: newMark, cacheItem: cacheMark, serverItem: bookmark})
      }
      return
    }

    // remove bookmark from resource
    await toResource.removeBookmark(bookmark.id)

    // remove bookmark from order
    toOrder.remove('bookmark', bookmark.id)

    // remove bookmark from mappings
    await this.mappings.removeBookmark({
      [toResource === this.localTreeRoot ? 'localId' : 'remoteId']: bookmark.id
    })

    this.done++
  }
}
