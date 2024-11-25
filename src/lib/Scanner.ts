import * as Parallel from 'async-parallel'
import Diff, { ActionType, CreateAction, MoveAction, RemoveAction, ReorderAction, UpdateAction } from './Diff'
import { Bookmark, Folder, ItemLocation, ItemType, TItem, TItemLocation } from './Tree'
import Logger from './Logger'

export interface ScanResult<L1 extends TItemLocation, L2 extends TItemLocation> {
  CREATE: Diff<L1, L2, CreateAction<L1, L2>>
  UPDATE: Diff<L1, L2, UpdateAction<L1, L2>>
  MOVE: Diff<L1, L2, MoveAction<L1, L2>>
  REMOVE: Diff<L2, L1, RemoveAction<L2, L1>>
  REORDER: Diff<L1, L2, ReorderAction<L1, L2>>
}

export default class Scanner<L1 extends TItemLocation, L2 extends TItemLocation> {
  private oldTree: TItem<L1>
  private newTree: TItem<L2>
  private mergeable: (i1: TItem<TItemLocation>, i2: TItem<TItemLocation>) => boolean
  private preserveOrder: boolean
  private checkHashes: boolean
  private hasCache: boolean

  private result: ScanResult<L2, L1>

  constructor(oldTree:TItem<L1>, newTree:TItem<L2>, mergeable:(i1:TItem<TItemLocation>, i2:TItem<TItemLocation>)=>boolean, preserveOrder:boolean, checkHashes = true, hasCache = true) {
    this.oldTree = oldTree
    this.newTree = newTree
    this.mergeable = mergeable
    this.preserveOrder = preserveOrder
    this.checkHashes = typeof checkHashes === 'undefined' ? true : checkHashes
    this.hasCache = hasCache
    this.result = {
      CREATE: new Diff(),
      UPDATE: new Diff(),
      MOVE: new Diff(),
      REMOVE: new Diff(),
      REORDER: new Diff(),
    }
  }

  getDiffs(): ScanResult<L2, L1> {
    return this.result
  }

  async run():Promise<ScanResult<L2, L1>> {
    await this.diffItem(this.oldTree, this.newTree)
    await this.findMoves()
    await this.addReorders()
    return this.result
  }

  async diffItem(oldItem:TItem<L1>, newItem:TItem<L2>):Promise<void> {
    // give the browser time to breathe
    await Promise.resolve()
    Logger.log('Calculating diff for ', oldItem, newItem)
    if (oldItem.type === 'folder' && newItem.type === 'folder') {
      return this.diffFolder(oldItem, newItem)
    } else if (oldItem.type === 'bookmark' && newItem.type === 'bookmark') {
      return this.diffBookmark(oldItem, newItem)
    } else {
      throw new Error('Mismatched diff items: ' + oldItem.type + ', ' + newItem.type)
    }
  }

  async diffFolder(oldFolder:Folder<L1>, newFolder:Folder<L2>):Promise<void> {
    if (this.checkHashes) {
      const hasChanged = await this.folderHasChanged(oldFolder, newFolder)
      if (!hasChanged) {
        return
      }
    }

    if (oldFolder.title !== newFolder.title && typeof oldFolder.parentId !== 'undefined' && typeof newFolder.parentId !== 'undefined') {
      // folder title changed and it's not the root folder
      this.result.UPDATE.commit({type: ActionType.UPDATE, payload: newFolder, oldItem: oldFolder})
    }

    // Preserved Items and removed Items
    // (using map here, because 'each' doesn't provide indices)
    const unmatchedChildren = newFolder.children.slice(0)
    await Parallel.map(oldFolder.children, async(old, index) => {
      const newItem = unmatchedChildren.find((child) => old.type === child.type && this.mergeable(old, child))
      // we found an item in the new folder that matches the one in the old folder
      if (newItem) {
        await this.diffItem(old, newItem)
        unmatchedChildren.splice(unmatchedChildren.indexOf(newItem), 1)
        return
      }

      if (newFolder.isRoot && newFolder.location === ItemLocation.LOCAL) {
        // We can't remove root folders locally
        return
      }

      this.result.REMOVE.commit({type: ActionType.REMOVE, payload: old, index})
    }, 1)

    // created Items
    // (using map here, because 'each' doesn't provide indices)
    await Parallel.map(unmatchedChildren, async(newChild, index) => {
      if (oldFolder.isRoot && oldFolder.location === ItemLocation.LOCAL) {
        // We can't create root folders locally
        return
      }
      this.result.CREATE.commit({type: ActionType.CREATE, payload: newChild, index})
    }, 1)

    if (newFolder.children.length > 1) {
      this.result.REORDER.commit({
        type: ActionType.REORDER,
        payload: newFolder,
        order: newFolder.children.map(i => ({ type: i.type, id: i.id })),
      })
    }
  }

  async diffBookmark(oldBookmark:Bookmark<L1>, newBookmark:Bookmark<L2>):Promise<void> {
    let hasChanged
    if (this.checkHashes) {
      hasChanged = await this.bookmarkHasChanged(oldBookmark, newBookmark)
    } else {
      hasChanged = oldBookmark.title !== newBookmark.title || oldBookmark.url !== newBookmark.url
    }
    if (hasChanged) {
      this.result.UPDATE.commit({ type: ActionType.UPDATE, payload: newBookmark, oldItem: oldBookmark })
    }
  }

  async bookmarkHasChanged(oldBookmark:Bookmark<L1>, newBookmark:Bookmark<L2>):Promise<boolean> {
    const oldHash = await oldBookmark.hash()
    const newHash = await newBookmark.hash()
    return oldHash !== newHash
  }

  async folderHasChanged(oldFolder:Folder<L1>, newFolder:Folder<L2>):Promise<boolean> {
    const oldHash = await oldFolder.hash(this.preserveOrder)
    const newHash = await newFolder.hash(this.preserveOrder)
    return oldHash !== newHash
  }

  async findMoves():Promise<void> {
    Logger.log('Scanner: Finding moves')
    let createActions
    let removeActions
    let reconciled = true

    // As soon as one match is found, action list is updated and search is started with the new list
    // repeat until no rewrites happen anymore
    while (reconciled) {
      reconciled = false
      let createAction: CreateAction<L2, L1>, removeAction: RemoveAction<L1,L2>

      // First find direct matches (avoids glitches when folders and their contents have been moved)
      createActions = this.result.CREATE.getActions()
      while (!reconciled && (createAction = createActions.shift())) {
        // give the browser time to breathe
        await Promise.resolve()
        const createdItem = createAction.payload
        removeActions = this.result.REMOVE.getActions()
        while (!reconciled && (removeAction = removeActions.shift())) {
          // give the browser time to breathe
          await Promise.resolve()
          const removedItem = removeAction.payload

          if (this.mergeable(removedItem, createdItem) &&
            (removedItem.type !== 'folder' ||
              (!this.hasCache && removedItem.childrenSimilarity(createdItem) > 0.8))) {
            this.result.CREATE.retract(createAction)
            this.result.REMOVE.retract(removeAction)
            this.result.MOVE.commit({
              type: ActionType.MOVE,
              payload: createdItem,
              oldItem: removedItem,
              index: createAction.index,
              oldIndex: removeAction.index
            })
            reconciled = true
            // Don't use the items from the action, but the ones in the actual tree to avoid using tree parts mutated by this algorithm (see below)
            await this.diffItem(removedItem, createdItem)
          }
        }
      }

      // Then find descendant matches
      createActions = this.result.CREATE.getActions()
      while (!reconciled && (createAction = createActions.shift())) {
        // give the browser time to breathe
        await Promise.resolve()
        const createdItem = createAction.payload
        removeActions = this.result.REMOVE.getActions()
        while (!reconciled && (removeAction = removeActions.shift())) {
          // give the browser time to breathe
          await Promise.resolve()
          const removedItem = removeAction.payload
          const oldItem = removedItem.findItemFilter(
            createdItem.type,
            item => this.mergeable(item, createdItem),
            item => item.childrenSimilarity(createdItem)
          )
          if (oldItem) {
            let oldIndex
            this.result.CREATE.retract(createAction)
            if (oldItem === removedItem) {
              this.result.REMOVE.retract(removeAction)
            } else {
              // We clone the item here, because we don't want to mutate all copies of this tree (item)
              const removedItemClone = removedItem.clone(true)
              const oldParentClone = removedItemClone.findItem(ItemType.FOLDER, oldItem.parentId) as Folder<L1>
              const oldItemClone = removedItemClone.findItem(oldItem.type, oldItem.id)
              oldIndex = oldParentClone.children.indexOf(oldItemClone)
              oldParentClone.children.splice(oldIndex, 1)
              removeAction.payload = removedItemClone
              removeAction.payload.createIndex()
            }
            this.result.MOVE.commit({
              type: ActionType.MOVE,
              payload: createdItem,
              oldItem,
              index: createAction.index,
              oldIndex: oldIndex || removeAction.index
            })
            reconciled = true
            if (oldItem.type === ItemType.FOLDER) { // TODO: Is this necessary?
              await this.diffItem(oldItem, createdItem)
            }
          } else {
            const newItem = createdItem.findItemFilter(
              removedItem.type,
              item => this.mergeable(removedItem, item),
              item => item.childrenSimilarity(removedItem)
            )
            let index
            if (newItem) {
              this.result.REMOVE.retract(removeAction)
              if (newItem === createdItem) {
                this.result.CREATE.retract(createAction)
              } else {
                // We clone the item here, because we don't want to mutate all copies of this tree (item)
                const createdItemClone = createdItem.clone(true)
                const newParentClone = createdItemClone.findItem(ItemType.FOLDER, newItem.parentId) as Folder<L2>
                const newClonedItem = createdItemClone.findItem(newItem.type, newItem.id)
                index = newParentClone.children.indexOf(newClonedItem)
                newParentClone.children.splice(index, 1)
                createAction.payload = createdItemClone
                createAction.payload.createIndex()
              }
              this.result.MOVE.commit({
                type: ActionType.MOVE,
                payload: newItem,
                oldItem: removedItem,
                index: index || createAction.index,
                oldIndex: removeAction.index
              })
              reconciled = true
              if (removedItem.type === ItemType.FOLDER) {
                await this.diffItem(removedItem, newItem)
              }
            }
          }
        }
      }
    }

    // Remove all UPDATEs that have already been handled by a MOVE
    const moves = this.result.MOVE.getActions()
    const updates = this.result.UPDATE.getActions()
    updates.forEach(update => {
      if (moves.find(move => String(move.payload.id) === String(update.payload.id))) {
        this.result.UPDATE.retract(update)
      }
    })
  }

  async addReorders(): Promise<void> {
    Logger.log('Scanner: Generate reorders')
    const targets = {}
    const sources = {}

    // Collect folders to reorder
    this.result.CREATE.getActions()
      .forEach(action => {
        targets[action.payload.parentId] = true
      })
    this.result.REMOVE.getActions()
      .forEach(action => {
        sources[action.payload.parentId] = true
      })
    this.result.MOVE.getActions()
      .forEach(action => {
        targets[action.payload.parentId] = true
        sources[action.oldItem.parentId] = true
      })

    for (const folderId in sources) {
      const oldFolder = this.oldTree.findItem(ItemType.FOLDER, folderId) as Folder<L1>
      if (!oldFolder) {
        // In case a MOVE's old parent was removed
        continue
      }
      const newFolder = this.newTree.findItemFilter(ItemType.FOLDER, (item) => this.mergeable(oldFolder, item)) as Folder<L2>
      if (newFolder) {
        targets[newFolder.id] = true
      }
    }

    for (const folderId in targets) {
      const newFolder = this.newTree.findItem(ItemType.FOLDER, folderId) as Folder<L2>
      const duplicate = this.result.REORDER.getActions().find(a => String(a.payload.id) === String(newFolder.id))
      if (duplicate) {
        this.result.REORDER.retract(duplicate)
      }
      this.result.REORDER.commit({
        type: ActionType.REORDER,
        payload: newFolder,
        order: newFolder.children.map(i => ({ type: i.type, id: i.id })),
      })
    }
  }
}
