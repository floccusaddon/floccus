import { Bookmark, Folder, TItem, ItemType } from '../Tree'
import Logger from '../Logger'
import browser from '../browser-api'
import Diff, { Action, ActionType, MoveAction, ReorderAction } from '../Diff'
import Scanner from '../Scanner'
import * as Parallel from 'async-parallel'
import { throttle } from 'throttle-debounce'
import Mappings, { Mapping, MappingSnapshot } from '../Mappings'
import LocalTree from '../LocalTree'
import TResource, { OrderFolderResource } from '../interfaces/Resource'
import { TAdapter } from '../interfaces/Adapter'

export default class SyncProcess {
  protected mappings: Mappings
  protected localTree: LocalTree
  protected server: TAdapter
  protected cacheTreeRoot: Folder
  protected canceled: boolean
  protected preserveOrder: boolean
  protected progressCb: (progress:number)=>void
  protected localTreeRoot: Folder
  protected serverTreeRoot: Folder
  protected actionsDone: number
  protected actionsPlanned: number

  constructor(
    mappings:Mappings,
    localTree:LocalTree,
    cacheTreeRoot:Folder,
    server:TAdapter,
    progressCb:(progress:number)=>void
  ) {
    this.mappings = mappings
    this.localTree = localTree
    this.server = server
    this.cacheTreeRoot = cacheTreeRoot

    this.preserveOrder = 'orderFolder' in this.server

    this.progressCb = throttle(250, true, progressCb) as (progress:number)=>void
    this.actionsDone = 0
    this.actionsPlanned = 0
    this.canceled = false
  }

  async cancel() :Promise<void> {
    this.canceled = true
  }

  updateProgress():void {
    this.actionsDone++
    this.progressCb(
      Math.min(
        1,
        this.actionsDone / (this.actionsPlanned + 1)
      )
    )
  }

  async sync(): Promise<void> {
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

    // generate hash tables to find items faster
    this.localTreeRoot.createIndex()
    this.cacheTreeRoot.createIndex()
    this.serverTreeRoot.createIndex()

    const {localDiff, serverDiff} = await this.getDiffs()
    Logger.log({localDiff, serverDiff})

    const {localPlan, serverPlan} = await this.reconcile(localDiff, serverDiff)
    Logger.log({localPlan, serverPlan})

    this.actionsPlanned = serverPlan.getActions().length + localPlan.getActions().length

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
    localReorder.map(mappingsSnapshot.ServerToLocal, false, (action) => action.type === ActionType.REORDER)

    const serverReorder = new Diff()
    this.reconcileReorderings(serverPlan, mappingsSnapshot.ServerToLocal, false)
    // localReorder.add(serverPlan)
    serverReorder.add(serverPlan)
    serverReorder.map(mappingsSnapshot.LocalToServer, true, (action) => action.type === ActionType.REORDER)

    if ('orderFolder' in this.server) {
      await Promise.all([
        this.executeReorderings(this.server, serverReorder),
        this.executeReorderings(this.localTree, localReorder),
      ])
    }
  }

  filterOutUnacceptedBookmarks(tree: Folder): void {
    tree.children = tree.children.filter(child => {
      if (child instanceof Bookmark) {
        return this.server.acceptsBookmark(child)
      } else {
        this.filterOutUnacceptedBookmarks(child)
        return true
      }
    })
  }

  async filterOutDuplicatesInTheSameFolder(tree: Folder): Promise<void> {
    const seenUrl = {}
    const duplicates = []
    tree.children = tree.children.filter(child => {
      if (child.type === ItemType.BOOKMARK) {
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

  async getDiffs():Promise<{localDiff:Diff, serverDiff:Diff}> {
    const mappingsSnapshot = await this.mappings.getSnapshot()
    // if we have the cache available, Diff cache and both trees
    const localScanner = new Scanner(
      this.cacheTreeRoot,
      this.localTreeRoot,
      (oldItem, newItem) => oldItem.type === newItem.type && String(oldItem.id) === String(newItem.id),
      this.preserveOrder
    )
    const serverScanner = new Scanner(
      this.cacheTreeRoot,
      this.serverTreeRoot,
      (oldItem, newItem) => oldItem.type === newItem.type && String(mappingsSnapshot.LocalToServer[oldItem.type][oldItem.id]) === String(newItem.id),
      this.preserveOrder
    )
    const [localDiff, serverDiff] = await Promise.all([localScanner.run(), serverScanner.run()])
    return {localDiff, serverDiff}
  }

  async reconcile(localDiff:Diff, serverDiff:Diff):Promise<{serverPlan: Diff, localPlan: Diff}> {
    let mappingsSnapshot = await this.mappings.getSnapshot()

    const serverCreations = serverDiff.getActions(ActionType.CREATE)
    const serverRemovals = serverDiff.getActions(ActionType.REMOVE)
    const serverMoves = serverDiff.getActions(ActionType.MOVE)

    const localCreations = localDiff.getActions(ActionType.CREATE)
    const localRemovals = localDiff.getActions(ActionType.REMOVE)
    const localMoves = localDiff.getActions(ActionType.MOVE)
    const localUpdates = localDiff.getActions(ActionType.UPDATE)
    const localReorders = localDiff.getActions(ActionType.REORDER)

    // Prepare server plan
    const serverPlan = new Diff() // to be mapped
    await Parallel.each(localDiff.getActions(), async(action:Action) => {
      if (action.type === ActionType.REMOVE) {
        const concurrentRemoval = serverRemovals.find(a =>
          String(action.payload.id) === String(mappingsSnapshot.ServerToLocal[a.payload.type ][a.payload.id]))
        if (concurrentRemoval) {
          // Already deleted on server, do nothing.
          return
        }
        const concurrentMove = serverMoves.find(a =>
          String(action.payload.id) === String(mappingsSnapshot.ServerToLocal[a.payload.type ][a.payload.id]))
        if (concurrentMove) {
          // moved on the server, moves take precedence, do nothing (i.e. leave server version intact)
          return
        }
      }
      if (action.type === ActionType.CREATE) {
        const concurrentCreation = serverCreations.find(a =>
          String(action.payload.parentId) === String(mappingsSnapshot.ServerToLocal.folder[a.payload.parentId]) &&
          action.payload.canMergeWith(a.payload))
        if (concurrentCreation) {
          // created on both the server and locally, try to reconcile
          const newMappings = []
          const subScanner = new Scanner(
            concurrentCreation.payload, // server tree
            action.payload, // local tree
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
          // TODO: subScanner may contain residual CREATE/REMOVE actions that need to be added to mappings
          return
        }
        const concurrentRemoval = serverRemovals.find(a =>
          a.payload.findItem('folder', action.payload.parentId))
        if (concurrentRemoval) {
          // Already deleted on server, do nothing.
          return
        }
      }
      if (action.type === ActionType.MOVE) {
        const concurrentRemoval = serverRemovals.find(a =>
          String(action.payload.id) === String(mappingsSnapshot.ServerToLocal[a.payload.type][a.payload.id]))
        if (concurrentRemoval) {
          // moved locally but removed on the server, recreate it on the server
          serverPlan.commit({...action, type: ActionType.CREATE})
          return
        }
        const concurrentHierarchyReversals = serverMoves.filter(a =>
          action.payload.findItem(ItemType.FOLDER, mappingsSnapshot.ServerToLocal.folder[a.payload.parentId]) &&
          a.payload.findItem(ItemType.FOLDER, mappingsSnapshot.LocalToServer.folder[action.payload.parentId])
        )
        if (concurrentHierarchyReversals.length) {
          concurrentHierarchyReversals.forEach(a => {
            // moved locally but moved in reverse hierarchical order on server
            const payload = a.oldItem.clone() // we don't map here as we want this to look like a local action
            const oldItem = a.payload.clone()
            oldItem.id = mappingsSnapshot.ServerToLocal[oldItem.type ][oldItem.id]
            oldItem.parentId = mappingsSnapshot.ServerToLocal.folder[oldItem.parentId]
            // revert server move
            serverPlan.commit({...a, payload, oldItem})
          })
          serverPlan.commit(action)
          return
        }
      }
      if (action.type === ActionType.REORDER) {
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
    serverPlan.map(mappingsSnapshot.LocalToServer, true, (action) => action.type !== ActionType.REORDER && action.type !== ActionType.MOVE)

    // Prepare local plan
    const localPlan = new Diff()
    await Parallel.each(serverDiff.getActions(), async(action:Action) => {
      if (action.type === ActionType.REMOVE) {
        const concurrentRemoval = localRemovals.find(a =>
          String(action.payload.id) === String(mappingsSnapshot.LocalToServer[a.payload.type ][a.payload.id]))
        if (concurrentRemoval) {
          // Already deleted on server, do nothing.
          return
        }
        const concurrentMove = localMoves.find(a =>
          String(action.payload.id) === String(mappingsSnapshot.LocalToServer[a.payload.type ][a.payload.id]))
        if (concurrentMove) {
          // removed on server, moved locally, do nothing to keep it locally.
          return
        }
      }
      if (action.type === ActionType.CREATE) {
        const concurrentCreation = localCreations.find(a =>
          String(action.payload.parentId === mappingsSnapshot.LocalToServer.folder[a.payload.parentId]) &&
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
          // do nothing locally if the trees differ, serverPlan takes care of adjusting the server tree
          return
        }
        const concurrentRemoval = localRemovals.find(a =>
          a.payload.findItem(ItemType.FOLDER, mappingsSnapshot.ServerToLocal.folder[action.payload.parentId]))
        if (concurrentRemoval) {
          // Already deleted locally, do nothing.
          return
        }
      }
      if (action.type === ActionType.MOVE) {
        const concurrentRemoval = localRemovals.find(a =>
          String(action.payload.id) === String(mappingsSnapshot.LocalToServer[a.payload.type ][a.payload.id]))
        if (concurrentRemoval) {
          localPlan.commit({...action, type: ActionType.CREATE})
          return
        }
        const concurrentMove = localMoves.find(a =>
          String(action.payload.id) === String(mappingsSnapshot.LocalToServer[a.payload.type ][a.payload.id]))
        if (concurrentMove) {
          // Moved both on server and locally, local has precedence: do nothing locally
          return
        }
        const concurrentHierarchyReversals = localMoves.filter(a =>
          action.payload.findItem(ItemType.FOLDER, mappingsSnapshot.LocalToServer.folder[a.payload.parentId]) &&
          a.payload.findItem(ItemType.FOLDER, mappingsSnapshot.ServerToLocal.folder[action.payload.parentId])
        )
        if (concurrentHierarchyReversals.length) {
          // Moved locally and in reverse hierarchical order on server. local has precedence: do nothing locally
          return
        }
      }
      if (action.type === ActionType.UPDATE) {
        const concurrentUpdate = localUpdates.find(a =>
          String(action.payload.id) === String(mappingsSnapshot.LocalToServer[a.payload.type ][a.payload.id]))
        if (concurrentUpdate) {
          // Updated both on server and locally, local has precedence: do nothing locally
          return
        }
      }
      if (action.type === ActionType.REORDER) {
        const concurrentReorder = localReorders.find(a =>
          String(action.payload.id) === String(mappingsSnapshot.LocalToServer[a.payload.type][a.payload.id]))
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
    localPlan.map(mappingsSnapshot.ServerToLocal, false, (action) => action.type !== ActionType.REORDER && action.type !== ActionType.MOVE)

    return { localPlan, serverPlan}
  }

  async execute(resource:TResource, plan:Diff, mappings:Mapping, isLocalToServer:boolean):Promise<void> {
    const run = (action) => this.executeAction(resource, action, isLocalToServer)

    await Parallel.each(plan.getActions().filter(action => action.type === ActionType.CREATE || action.type === ActionType.UPDATE), run)
    const mappingsSnapshot = await this.mappings.getSnapshot()
    plan.map(isLocalToServer ? mappingsSnapshot.LocalToServer : mappingsSnapshot.ServerToLocal, isLocalToServer, (action) => action.type === ActionType.MOVE)
    const batches = Diff.sortMoves(plan.getActions(ActionType.MOVE), isLocalToServer ? this.serverTreeRoot : this.localTreeRoot)
    await Parallel.each(batches, batch => Promise.all(batch.map(run)), 1)
    await Parallel.each(plan.getActions(ActionType.REMOVE), run)
  }

  async executeAction(resource:TResource, action:Action, isLocalToServer:boolean):Promise<void> {
    const item = action.payload

    if (this.canceled) {
      throw new Error(browser.i18n.getMessage('Error027'))
    }

    if (action.type === ActionType.REMOVE) {
      await action.payload.visitRemove(resource)
      await this.removeMapping(resource, item)
      this.updateProgress()
      return
    }

    if (action.type === ActionType.CREATE) {
      const id = await action.payload.visitCreate(resource)
      item.id = id
      await this.addMapping(resource, action.oldItem, id)

      if (item instanceof Folder && item.children.length) {
        if ('bulkImportFolder' in resource) {
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
              await this.addMapping(resource, oldItem, newId)
            })

            this.updateProgress()
            return
          } catch (e) {
            Logger.log('Bulk import failed, continuing with normal creation', e)
          }
        }

        // Create a sub plan
        if (action.oldItem && action.oldItem instanceof Folder) {
          const subPlan = new Diff
          action.oldItem.children.forEach((child) => subPlan.commit({ type: ActionType.CREATE, payload: child }))
          const mappingsSnapshot = await this.mappings.getSnapshot()[resource === this.localTree ? 'ServerToLocal' : 'LocalToServer']
          subPlan.map(mappingsSnapshot, resource === this.localTree)
          await this.execute(resource, subPlan, mappingsSnapshot, isLocalToServer)
        }

        if (item.children.length > 1) {
          // Order created items after the fact, as they've been created concurrently
          const subOrder = new Diff()
          subOrder.commit({
            type: ActionType.REORDER,
            oldItem: action.payload,
            payload: action.oldItem,
            order: item.children.map(i => ({ type: i.type, id: i.id }))
          })
          const mappingsSnapshot = await this.mappings.getSnapshot()[resource === this.localTree ? 'ServerToLocal' : 'LocalToServer']
          subOrder.map(mappingsSnapshot, resource === this.localTree)
          if ('orderFolder' in resource) {
            await this.executeReorderings(resource, subOrder)
          }
        }
      }

      this.updateProgress()

      return
    }

    if (action.type === ActionType.UPDATE || action.type === ActionType.MOVE) {
      await action.payload.visitUpdate(resource)
      await this.addMapping(resource, action.oldItem, item.id)
      this.updateProgress()
    }
  }

  reconcileReorderings(plan:Diff, reverseMappings:Mapping, isLocalToServer: boolean) :void{
    plan
      .getActions(ActionType.REORDER)
      .map(a => a as ReorderAction)
      // MOVEs have oldItem from cacheTree and payload now mapped to target tree
      // REORDERs have payload in source tree
      .forEach(reorderAction => {
        const childAwayMoves = plan.getActions(ActionType.MOVE)
          .filter(move =>
            (isLocalToServer ? String(reorderAction.payload.id) === String(move.oldItem.parentId) : String(reorderAction.payload.id) === String(reverseMappings[move.payload.type][move.oldItem.parentId])) &&
            reorderAction.order.find(item => String(item.id) === String(reverseMappings[move.payload.type ][move.payload.id]) && item.type === move.payload.type)
          )
        const concurrentRemovals = plan.getActions(ActionType.REMOVE)
          .filter(removal => reorderAction.order.find(item => String(item.id) === String(reverseMappings[removal.payload.type][removal.payload.id]) && item.type === removal.payload.type))
        reorderAction.order = reorderAction.order.filter(item =>
          !childAwayMoves.find(move =>
            String(item.id) === String(reverseMappings[move.payload.type][move.payload.id]) && move.payload.type === item.type) &&
          !concurrentRemovals.find(removal =>
            String(item.id) === String(reverseMappings[removal.payload.type][removal.payload.id]) && removal.payload.type === item.type)
        )
        plan.getActions(ActionType.MOVE)
          .map(a => a as MoveAction)
          .filter(move =>
            String(reorderAction.payload.id) === String(reverseMappings.folder[move.payload.parentId]) &&
            !reorderAction.order.find(item => String(item.id) === String(reverseMappings[move.payload.type][move.payload.id]) && item.type === move.payload.type)
          )
          .forEach(a => {
            reorderAction.order.splice(a.index, 0, { type: a.payload.type, id: reverseMappings[a.payload.type ][a.payload.id] })
          })
      })
  }

  async executeReorderings(resource:OrderFolderResource, reorderings:Diff):Promise<void> {
    Logger.log({ reorderings })

    await Parallel.each(reorderings.getActions(), async(action) => {
      const item = action.payload

      if (this.canceled) {
        throw new Error(browser.i18n.getMessage('Error027'))
      }

      if (!item.parentId) {
        Logger.log('Skipping reordering of root folder.')
        return
      }

      if (action.type === ActionType.REORDER) {
        await resource.orderFolder(item.id, action.order)
        this.updateProgress()
      }
    })
  }

  async addMapping(resource:TResource, item:TItem, newId:string|number):Promise<void> {
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

  async removeMapping(resource:TResource, item:TItem):Promise<void> {
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

  async loadChildren(serverItem:TItem, mappingsSnapshot:MappingSnapshot):Promise<void> {
    if (this.canceled) {
      throw new Error(browser.i18n.getMessage('Error027'))
    }
    if (!(serverItem instanceof Folder)) return
    if (!('loadFolderChildren' in this.server)) return
    let localItem, cacheItem
    if (serverItem === this.serverTreeRoot) {
      localItem = this.localTreeRoot
      cacheItem = this.cacheTreeRoot
    } else {
      const localId = mappingsSnapshot.ServerToLocal.folder[serverItem.id]
      localItem = this.localTreeRoot.findFolder(localId)
      cacheItem = this.cacheTreeRoot.findFolder(localId)
    }
    if (
      localItem &&
      !(await this.folderHasChanged(localItem, cacheItem, serverItem))
    ) {
      this.actionsDone += localItem.count()
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
      child => this.loadChildren(child, mappingsSnapshot)
    )

    // recalculate hash
    serverItem.hashValue = {}
    await serverItem.hash(true)
  }

  async folderHasChanged(localItem: TItem, cacheItem: TItem, serverItem: TItem):Promise<boolean> {
    const mappingsSnapshot = await this.mappings.getSnapshot()
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
    const changedLocally =
      (localHash !== cacheHash && localHash !== serverHash) ||
      (cacheItem && localItem.parentId !== cacheItem.parentId)
    const changedUpstream =
      (cacheHash !== serverHash && localHash !== serverHash) ||
      (cacheItem &&
        cacheItem.parentId !==
        mappingsSnapshot.ServerToLocal.folder[serverItem.parentId])
    return changedLocally || changedUpstream || reconciled
  }
}
