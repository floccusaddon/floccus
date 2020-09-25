import * as Tree from '../Tree'
import Logger from '../Logger'
import browser from '../browser-api'
import OrderTracker from '../OrderTracker'
import Diff, { actions } from '../Diff'
import Scanner from '../Scanner'

const Parallel = require('async-parallel')
const { throttle } = require('throttle-debounce')

export default class SyncProcess {
  /**
   * @param mappings {Mappings} The mappings Object
   * @param localTree {LocalTree} The localTree resource object
   * @param cacheTreeRoot {Folder} The tree from the cache
   * @param server {Adapter} the server resource object
   * @param progressCb {Function} a callback that will be called with a percentage when there is progress
   */
  constructor(
    mappings,
    localTree,
    cacheTreeRoot,
    server,
    progressCb
  ) {
    this.mappings = mappings
    this.localTree = localTree
    this.server = server
    this.cacheTreeRoot = cacheTreeRoot

    this.preserveOrder = 'orderFolder' in this.server

    this.progressCb = throttle(250, true, progressCb)
    this.done = 0
    this.canceled = false
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

  async sync() {
    this.localTreeRoot = await this.localTree.getBookmarksTree()
    this.serverTreeRoot = await this.server.getBookmarksTree()
    this.filterOutUnacceptedBookmarks(this.localTreeRoot)
    await this.filterOutDuplicatesInTheSameFolder(this.localTreeRoot)

    await this.mappings.addFolder({ localId: this.localTreeRoot.id, remoteId: this.serverTreeRoot.id })
    let mappingsSnapshot = await this.mappings.getSnapshot()

    if ('loadFolderChildren' in this.server) {
      Logger.log('Loading sparse tree as necessary')
      // Load sparse tree
      await this.loadChildren(this.serverTreeRoot, mappingsSnapshot)
    }

    // Cache tree might not have been initialized and thus have no id
    this.cacheTreeRoot.id = this.localTreeRoot.id

    // generate hashtables to find items faster
    this.localTreeRoot.createIndex()
    this.cacheTreeRoot.createIndex()
    this.serverTreeRoot.createIndex()

    const localScanner = new Scanner(
      this.cacheTreeRoot,
      this.localTreeRoot,
      (oldItem, newItem) => oldItem.type === newItem.type && oldItem.id === newItem.id,
      this.preserveOrder
    )
    const serverScanner = new Scanner(
      this.cacheTreeRoot,
      this.serverTreeRoot,
      (oldItem, newItem) => Boolean(oldItem.type === newItem.type && mappingsSnapshot.LocalToServer[oldItem.type + 's'][oldItem.id] === newItem.id),
      this.preserveOrder
    )

    const [localDiff, serverDiff] = await Promise.all([localScanner.run(), serverScanner.run()])
    Logger.log({localDiff, serverDiff})

    const {localPlan, serverPlan} = await this.reconcile(localDiff, serverDiff)
    Logger.log({localPlan, serverPlan})

    // mappings have been updated, reload
    mappingsSnapshot = await this.mappings.getSnapshot()

    await Promise.all([
      this.execute(this.server, serverPlan, mappingsSnapshot.LocalToServer, true),
      this.execute(this.localTree, localPlan, mappingsSnapshot.ServerToLocal, false),
    ])

    // mappings have been updated, reload
    mappingsSnapshot = await this.mappings.getSnapshot()

    const localReorder = new Diff()
    this.reconcileReorderings(localPlan, mappingsSnapshot.LocalToServer, true)
    localReorder.add(localPlan)
    localReorder.map(mappingsSnapshot.ServerToLocal, false, (action) => action.type === actions.REORDER)

    const serverReorder = new Diff()
    this.reconcileReorderings(serverPlan, mappingsSnapshot.ServerToLocal, false)
    // localReorder.add(serverPlan)
    serverReorder.add(serverPlan)
    serverReorder.map(mappingsSnapshot.LocalToServer, true, (action) => action.type === actions.REORDER)

    await Promise.all([
      this.executeReorderings(this.server, serverReorder),
      this.executeReorderings(this.localTree, localReorder),
    ])
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
      duplicates.map(bm => this.localTree.removeBookmark(bm))
    )
  }

  async reconcile(localDiff, serverDiff) {
    let mappingsSnapshot = await this.mappings.getSnapshot()

    const serverCreations = serverDiff.getActions(actions.CREATE)
    const serverRemovals = serverDiff.getActions(actions.REMOVE)
    const serverMoves = serverDiff.getActions(actions.MOVE)

    const localCreations = localDiff.getActions(actions.CREATE)
    const localRemovals = localDiff.getActions(actions.REMOVE)
    const localMoves = localDiff.getActions(actions.MOVE)
    const localUpdates = localDiff.getActions(actions.UPDATE)
    const localReorders = localDiff.getActions(actions.REORDER)

    // Prepare server plan
    let serverPlan = new Diff()
    await Parallel.each(localDiff.getActions(), async action => {
      if (action.type === actions.REMOVE) {
        const concurrentRemoval = serverRemovals.find(a =>
          action.payload.id === mappingsSnapshot.ServerToLocal[a.payload.type + 's'][a.payload.id])
        if (concurrentRemoval) {
          // Already deleted on server, do nothing.
          return
        }
        const concurrentMove = serverMoves.find(a =>
          action.payload.id === mappingsSnapshot.ServerToLocal[a.payload.type + 's'][a.payload.id])
        if (concurrentMove) {
          // moved on the server, moves take precedence, do nothing (i.e. leave server version intact)
          return
        }
      }
      if (action.type === actions.CREATE) {
        const concurrentCreation = serverCreations.find(a =>
          action.payload.parentId === mappingsSnapshot.ServerToLocal.folders[a.payload.parentId] &&
          action.payload.canMergeWith(a.payload))
        if (concurrentCreation) {
          // created on both the server and locally, try to reconcile
          const newMappings = []
          const subScanner = new Scanner(
            concurrentCreation.payload,
            action.payload,
            (oldItem, newItem) => {
              if (oldItem.type === newItem.type && oldItem.canMergeWith(newItem)) {
                // if two items can be merged, we'll add mappings here directly
                newMappings.push([oldItem, newItem.id])
                return true
              }
              return false
            },
            this.preserveOrder,
            false
          )
          await subScanner.run()
          newMappings.push([concurrentCreation.payload, action.payload.id])
          await Parallel.each(newMappings, async([oldItem, newId]) => {
            await this.addMapping(this.localTree, oldItem, newId)
          },1)
          return
        }
        const concurrentRemoval = serverRemovals.find(a =>
          a.payload.findItem('folder', action.payload.parentId))
        if (concurrentRemoval) {
          // Already deleted on server, do nothing.
          return
        }
      }
      if (action.type === actions.MOVE) {
        const concurrentRemoval = serverRemovals.find(a =>
          action.payload.id === mappingsSnapshot.ServerToLocal[a.payload.type + 's'][a.payload.id])
        if (concurrentRemoval) {
          // moved locally but removed on the server, recreate it on the server
          serverPlan.commit({...action, type: actions.CREATE})
          return
        }
      }
      if (action.type === actions.REORDER) {
        const concurrentRemoval = serverRemovals.find(a =>
          a.payload.findItem('folder', action.payload.id))
        if (concurrentRemoval) {
          // Already deleted on server, do nothing.
          return
        }
      }

      serverPlan.commit(action)
    })

    // Map payloads
    mappingsSnapshot = await this.mappings.getSnapshot() // Necessary because of concurrent creation reconciliation
    serverPlan.map(mappingsSnapshot.LocalToServer, true, (action) => action.type !== actions.REORDER && action.type !== actions.MOVE)

    // Prepare local plan
    const localPlan = new Diff()
    await Parallel.each(serverDiff.getActions(), async action => {
      if (action.type === actions.REMOVE) {
        const concurrentRemoval = localRemovals.find(a =>
          action.payload.id === mappingsSnapshot.LocalToServer[a.payload.type + 's'][a.payload.id])
        if (concurrentRemoval) {
          // Already deleted on server, do nothing.
          return
        }
        const concurrentMove = localMoves.find(a =>
          action.payload.id === mappingsSnapshot.LocalToServer[a.payload.type + 's'][a.payload.id])
        if (concurrentMove) {
          // removed on server, moved locally, do nothing to keep it locally.
          return
        }
      }
      if (action.type === actions.CREATE) {
        const concurrentCreation = localCreations.find(a =>
          action.payload.parentId === mappingsSnapshot.LocalToServer.folders[a.payload.parentId] &&
          action.payload.canMergeWith(a.payload))
        if (concurrentCreation) {
          // created on both the server and locally, try to reconcile
          const newMappings = []
          const subScanner = new Scanner(
            concurrentCreation.payload,
            action.payload,
            (oldItem, newItem) => {
              if (oldItem.type === newItem.type && oldItem.canMergeWith(newItem)) {
                // if two items can be merged, we'll add mappings here directly
                newMappings.push([oldItem, newItem.id])
                return true
              }
              return false
            },
            this.preserveOrder,
            false,
          )
          await subScanner.run()
          // also add mappings for the two root folders
          newMappings.push([concurrentCreation.payload, action.payload.id])
          await Parallel.each(newMappings, async([oldItem, newId]) => {
            await this.addMapping(this.server, oldItem, newId)
          })
          return
        }
        const concurrentRemoval = localRemovals.find(a =>
          a.payload.findItem('folder', mappingsSnapshot.ServerToLocal[action.payload.parentId]))
        if (concurrentRemoval) {
          // Already deleted locally, do nothing.
          return
        }
      }
      if (action.type === actions.MOVE) {
        const concurrentRemoval = localRemovals.find(a =>
          action.payload.id === mappingsSnapshot.LocalToServer[a.payload.type + 's'][a.payload.id])
        if (concurrentRemoval) {
          localPlan.commit({...action, type: actions.CREATE})
          return
        }
        const concurrentMove = localMoves.find(a =>
          action.payload.id === mappingsSnapshot.LocalToServer[a.payload.type + 's'][a.payload.id])
        if (concurrentMove) {
          // Moved both on server and locally, local has precedence: do nothing locally
          return
        }
      }
      if (action.type === actions.UPDATE) {
        const concurrentUpdate = localUpdates.find(a =>
          action.payload.id === mappingsSnapshot.LocalToServer[a.payload.type + 's'][a.payload.id])
        if (concurrentUpdate) {
          // Updated both on server and locally, local has precedence: do nothing locally
          return
        }
      }
      if (action.type === actions.REORDER) {
        const concurrentReorder = localReorders.find(a =>
          action.payload.id === mappingsSnapshot.LocalToServer[a.payload.type + 's'][a.payload.id])
        if (concurrentReorder) {
          return
        }
        const concurrentRemoval = serverRemovals.find(a =>
          a.payload.findItem('folder', action.payload.id))
        if (concurrentRemoval) {
          // Already deleted on server, do nothing.
          return
        }
      }
      localPlan.commit(action)
    })

    mappingsSnapshot = await this.mappings.getSnapshot() // Necessary because of concurrent creation reconciliation
    localPlan.map(mappingsSnapshot.ServerToLocal, false, (action) => action.type !== actions.REORDER && action.type !== actions.MOVE)

    return { localPlan, serverPlan}
  }

  async execute(resource, plan, mappings, isLocalToServer) {
    const run = (action) => this.executeAction(resource, action, isLocalToServer)

    await Parallel.each(plan.getActions().filter(action => action.type === actions.CREATE || action.type === actions.UPDATE), run)
    const mappingsSnapshot = await this.mappings.getSnapshot()
    plan.map(isLocalToServer ? mappingsSnapshot.LocalToServer : mappingsSnapshot.ServerToLocal, isLocalToServer, (action) => action.type === actions.MOVE)
    await Parallel.each(plan.getActions(actions.MOVE), run, 1) // Don't run in parallel for weird hierarchy reversals
    await Parallel.each(plan.getActions(actions.REMOVE), run)
  }

  async executeAction(resource, action, isLocalToServer) {
    let item = action.payload

    if (action.type === actions.REMOVE) {
      await action.payload.visitRemove(resource, item)
      await this.removeMapping(resource, item)
      return
    }

    if (action.type === actions.CREATE) {
      const id = await action.payload.visitCreate(resource, item)
      item.id = id
      await this.addMapping(resource, action.oldItem, id)

      if (item.children && item.children.length) {
        if (resource.bulkImportFolder) {
          try {
            // Try bulk import
            const imported = await resource.bulkImportFolder(item.id, item)
            const newMappings = []
            const subScanner = new Scanner(
              item,
              imported,
              (oldItem, newItem) => {
                if (oldItem.type === newItem.type && oldItem.canMergeWith(newItem)) {
                  // if two items can be merged, we'll add mappings here directly
                  newMappings.push([oldItem, newItem.id])
                  return true
                }
                return false
              },
              this.preserveOrder,
              false,
            )
            await subScanner.run()
            await Parallel.each(newMappings, async([oldItem, newId]) => {
              await this.addMapping(this.server, oldItem, newId)
            })
            return
          } catch (e) {
            Logger.log('Bulk import failed, continuing with normal creation', e)
          }
        }

        // Create a sub plan
        const subPlan = new Diff
        action.oldItem.children.forEach((child) => subPlan.commit({ type: actions.CREATE, payload: child }))
        let mappingsSnapshot = await this.mappings.getSnapshot()[resource === this.localTree ? 'ServerToLocal' : 'LocalToServer']
        subPlan.map(mappingsSnapshot, resource === this.localTree)
        await this.execute(resource, subPlan, mappingsSnapshot, isLocalToServer)

        if (item.children.length > 1) {
          // Order created items after the fact, as they've been created concurrently
          const subOrder = new Diff()
          subOrder.commit({
            type: actions.REORDER,
            oldItem: action.payload,
            payload: action.oldItem,
            order: action.payload.children.map(i => ({ type: i.type, id: i.id }))
          })
          mappingsSnapshot = await this.mappings.getSnapshot()[resource === this.localTree ? 'ServerToLocal' : 'LocalToServer']
          subOrder.map(mappingsSnapshot, resource === this.localTree)
          await this.executeReorderings(resource, subOrder)
        }
      }
      return
    }

    if (action.type === actions.UPDATE || action.type === actions.MOVE) {
      await action.payload.visitUpdate(resource, item)
      await this.addMapping(resource, action.oldItem, item.id)
      return
    }

    if (action.type === actions.REORDER) {
      return
    }

    throw new Error('Unknown action type: ' + action.type)
  }

  reconcileReorderings(plan, reverseMappings, isLocalToServer) {
    plan
      .getActions(actions.REORDER)
      // MOVEs have oldItem from cacheTree and payload now mapped to target tree
      // REORDERs have payload in source tree
      .forEach(reorderAction => {
        const childAwayMoves = plan.getActions(actions.MOVE)
          .filter(move =>
            (isLocalToServer ? reorderAction.payload.id === move.oldItem.parentId : reorderAction.payload.id === reverseMappings[move.oldItem.parentId]) &&
            reorderAction.order.find(item => item.id === reverseMappings[move.payload.type + 's'][move.payload.id] && item.type === move.payload.type)
          )
        const concurrentRemovals = plan.getActions(actions.REMOVE)
          .filter(removal => reorderAction.order.find(item => item.id === reverseMappings[removal.payload.type + 's'][removal.payload.id] && item.type === removal.payload.type))
        reorderAction.order = reorderAction.order.filter(item =>
          !childAwayMoves.find(move =>
            item.id === reverseMappings[move.payload.type + 's'][move.payload.id] && move.payload.type === item.type) &&
          !concurrentRemovals.find(removal =>
            item.id === reverseMappings[removal.payload.type + 's'][removal.payload.id] && removal.payload.type === item.type)
        )
        plan.getActions(actions.MOVE)
          .filter(move =>
            reorderAction.payload.id === reverseMappings.folders[move.payload.parentId] &&
            !reorderAction.order.find(item => item.id === reverseMappings[move.payload.type + 's'][move.payload.id] && item.type === move.payload.type)
          )
          .forEach(a => {
            reorderAction.order.splice(a.index, 0, { type: a.payload.type, id: reverseMappings[a.payload.type + 's'][a.payload.id] })
          })
      })
  }

  async executeReorderings(resource, reorderings) {
    Logger.log({reorderings})

    await Parallel.each(reorderings.getActions(), async(action) => {
      let item = action.payload

      if (action.type === actions.REORDER) {
        await resource.orderFolder(item.id, action.order)
      }
    })
  }

  async addMapping(resource, item, newId) {
    let localId, remoteId
    if (resource === this.server) {
      localId = item.id
      remoteId = newId
    } else {
      localId = newId
      remoteId = item.id
    }
    if (item.type === 'folder') {
      await this.mappings.addFolder({ localId, remoteId })
    } else {
      await this.mappings.addBookmark({ localId, remoteId })
    }
  }

  async removeMapping(resource, item) {
    let localId, remoteId
    if (resource === this.server) {
      remoteId = item.id
    } else {
      localId = item.id
    }
    if (item.type === 'folder') {
      await this.mappings.removeFolder({ localId, remoteId })
    } else {
      await this.mappings.removeBookmark({ localId, remoteId })
    }
  }

  async loadChildren(serverItem, mappingsSnapshot) {
    if (this.canceled) {
      throw new Error(browser.i18n.getMessage('Error027'))
    }
    if (serverItem instanceof Tree.Bookmark) return
    if (!this.server.hasFeatureHashing) return
    let localItem, cacheItem
    if (serverItem === this.serverTreeRoot) {
      localItem = this.localTreeRoot
      cacheItem = this.cacheTreeRoot
    } else {
      const localId = mappingsSnapshot.ServerToLocal.folders[serverItem.id]
      localItem = this.localTreeRoot.findFolder(localId)
      cacheItem = this.cacheTreeRoot.findFolder(localId)
    }
    if (
      localItem &&
      !(await this.folderHasChanged(localItem, cacheItem, serverItem)).changed
    ) {
      this.done += localItem.count()
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
    item: folder /* in fromTree */
  }) {
    const toParent = toTree.findFolder(mapping.folders[folder.parentId])
    if (toParent && toParent.isRoot) {
      Logger.log(
        "We're not allowed to change any direct children of the absolute root folder. Skipping."
      )
      return
    }
    let oldFolder
    if ((oldFolder = toTree.findFolder(mapping.folders[folder.id]))) {
      const localFolder = toTree === this.localTreeRoot ? oldFolder : folder

      if (
        this.moveFolderLock.isBusy(localFolder.id) &&
        oldFolder.findFolder(mapping.folders[folder.parentId])
      ) {
        Logger.log(
          'create branch: Detected hierarchy inversion. Stopping recursion / dead-lock'
        )
        return
      }

      await this.moveFolderLock.acquire(localFolder.id, async() => {
        if (oldFolder.moved) {
          // local changes are dealt with first, so this is deterministic
          Logger.log(
            'create branch: This folder was moved here in fromTree and concurrently moved somewhere else in toTree, ' +
              'but it has been dealt with'
          )
          return
        }

        if (!folder.moved) {
          folder.moved = true
        }

        Logger.log('create branch: This folder was moved here in fromTree')

        if (toTree === this.localTreeRoot) {
          const cacheFolder = this.cacheTreeRoot.findFolder(oldFolder.id)
          await this.syncTree({
            localItem: oldFolder,
            cacheItem: cacheFolder,
            serverItem: folder
          })
        } else {
          const cacheFolder = this.cacheTreeRoot.findFolder(folder.id)
          await this.syncTree({
            localItem: folder,
            cacheItem: cacheFolder,
            serverItem: oldFolder
          })
        }

        if (typeof folder.moved === 'function') {
          folder.moved()
        }

        // Add to order
        toOrder.insert('folder', folder.id, oldFolder.id)()
      })
      return
    }

    // Add to resource
    const newId = await toResource.createFolder(
      mapping.folders[folder.parentId],
      folder.title
    )

    // Add to mappings
    const localId = toTree === this.localTreeRoot ? newId : folder.id
    const remoteId = toTree === this.localTreeRoot ? folder.id : newId
    await this.mappings.addFolder({ localId, remoteId })

    let containsMovedItems = false
    await folder.traverse(async item => {
      if (toTree.findItem(item.type, mapping[item.type + 's'][item.id])) {
        containsMovedItems = true
      }
    })

    let importedFolder
    if (toResource.bulkImportFolder && !containsMovedItems) {
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
      Logger.log('Imported folder:', importedFolder)
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
        await toResource.orderFolder(newId, await orderTracker.getOrder())
      }
    }

    // Add to order
    toOrder.insert('folder', folder.id, newId)()
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

  async syncChildOrder({
    localItem,
    cacheItem,
    serverItem,
    localOrder,
    serverOrder
  }) {
    const { changedLocally, reconciled, enPar } = await this.folderHasChanged(
      localItem,
      cacheItem,
      serverItem
    )

    if (!this.preserveOrder) return
    if (localItem.isRoot) return
    if (enPar) return

    await localOrder.onFinished()
    await serverOrder.onFinished()

    const newMappingsSnapshot = this.mappings.getSnapshot()

    if (changedLocally || reconciled) {
      const unmappable = (await localOrder.getOrder()).filter(item => newMappingsSnapshot.LocalToServer[item.type + 's'][item.id] === undefined)
      if (unmappable.length) {
        throw new Error(`Cannot find mapped children of ${localItem.id} / ${serverItem.id} for ` + JSON.stringify(unmappable))
      }
      await this.server.orderFolder(
        serverItem.id,
        (await localOrder.getOrder()).map(item => ({
          id: newMappingsSnapshot.LocalToServer[item.type + 's'][item.id],
          type: item.type
        }))
      )
    } else {
      const unmappable = (await serverOrder.getOrder()).filter(item => newMappingsSnapshot.ServerToLocal[item.type + 's'][item.id] === undefined)
      if (unmappable.length) {
        throw new Error(`Cannot find mapped children of ${localItem.id} / ${serverItem.id} for ` + JSON.stringify(unmappable))
      }
      await this.localTree.orderFolder(
        localItem.id,
        (await serverOrder.getOrder()).map(item => ({
          id: newMappingsSnapshot.ServerToLocal[item.type + 's'][item.id],
          type: item.type
        }))
      )
    }
  }
}
