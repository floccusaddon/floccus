import * as Parallel from 'async-parallel'
import Diff, { ActionType, CreateAction, MoveAction, RemoveAction, ReorderAction, UpdateAction } from './Diff'
import { Bookmark, Folder, ItemLocation, ItemType, TItem, TItemLocation } from './Tree'
import Logger from './Logger'
import { IHashSettings } from './interfaces/Resource'
import { yieldToEventLoop } from './yieldToEventLoop'

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
  private hashSettings: IHashSettings
  private checkHashes: boolean
  private hasCache: boolean

  private result: ScanResult<L2, L1>

  constructor(oldTree:TItem<L1>, newTree:TItem<L2>, mergeable:(i1:TItem<TItemLocation>, i2:TItem<TItemLocation>)=>boolean, hashSettings: IHashSettings, checkHashes = true, hasCache = true) {
    this.oldTree = oldTree
    this.newTree = newTree
    this.mergeable = mergeable
    this.hashSettings = hashSettings
    this.checkHashes = typeof checkHashes === 'undefined' || checkHashes === null ? true : checkHashes
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
    await yieldToEventLoop()
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

    if (
      oldFolder.title !== newFolder.title &&
      typeof oldFolder.parentId !== 'undefined' &&
      typeof newFolder.parentId !== 'undefined'
    ) {
      // folder title changed and it's not the root folder
      this.result.UPDATE.commit({
        type: ActionType.UPDATE,
        payload: newFolder,
        oldItem: oldFolder,
      })
    }

    // Generate REORDERS before diffing anything to make sure REORDERS are from top to bottom (necessary for tab sync)
    if (newFolder.children.length > 1) {
      let needReorder = false
      for (
        let i = 0;
        i < Math.max(newFolder.children.length, oldFolder.children.length);
        i++
      ) {
        if (
          !oldFolder.children[i] ||
          !newFolder.children[i] ||
          !this.mergeable(oldFolder.children[i], newFolder.children[i])
        ) {
          needReorder = true
          break
        }
      }
      if (needReorder) {
        this.result.REORDER.commit({
          type: ActionType.REORDER,
          payload: newFolder,
          order: newFolder.children.map((i) => ({ type: i.type, id: i.id })),
        })
      }
    }

    // Preserved Items and removed Items
    // Optimization: Use a Map for O(1) lookups
    const unmatchedMap = new Map<string, TItem<L2>[]>()
    for (const child of newFolder.children) {
      const key = `${child.type}_${child.title}` // Or a better unique key based on mergeable logic
      const list = unmatchedMap.get(key) || []
      list.push(child)
      unmatchedMap.set(key, list)
    }
    const stillUnmatched = new Set(newFolder.children)

    // (using map here, because 'each' doesn't provide indices)
    await Parallel.map(
      oldFolder.children,
      async(old, index) => {
        const key = `${old.type}_${old.title}`
        const potentialMatches = unmatchedMap.get(key)
        let newItem = null
        if (potentialMatches) {
          const matchIndex = potentialMatches.findIndex((m) =>
            this.mergeable(old, m)
          )
          if (matchIndex !== -1) {
            newItem = potentialMatches.splice(matchIndex, 1)[0]
            stillUnmatched.delete(newItem)
          }
        }
        // we found an item in the new folder that matches the one in the old folder
        if (newItem) {
          await this.diffItem(old, newItem)
          return
        }

        if (newFolder.isRoot && newFolder.location === ItemLocation.LOCAL) {
          // We can't remove root folders locally
          return
        }

        this.result.REMOVE.commit({
          type: ActionType.REMOVE,
          payload: old,
          index,
        })
      },
      1
    )

    // created Items
    // (using map here, because 'each' doesn't provide indices)
    await Parallel.map(
      Array.from(stillUnmatched.values()),
      async(newChild) => {
        if (oldFolder.isRoot && oldFolder.location === ItemLocation.LOCAL) {
          // We can't create root folders locally
          return
        }
        this.result.CREATE.commit({
          type: ActionType.CREATE,
          payload: newChild,
          index: newFolder.children.findIndex((child) => child === newChild),
        })
      },
      1
    )
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
    const oldHash = await oldBookmark.hash(this.hashSettings)
    const newHash = await newBookmark.hash(this.hashSettings)
    return oldHash !== newHash
  }

  async folderHasChanged(oldFolder:Folder<L1>, newFolder:Folder<L2>):Promise<boolean> {
    const oldHash = await oldFolder.hash(this.hashSettings)
    const newHash = await newFolder.hash(this.hashSettings)
    return oldHash !== newHash
  }

  async findMoves():Promise<void> {
    Logger.log('Scanner: Finding moves')

    let hasNewActions = true

    while (hasNewActions) {
      hasNewActions = false

      const createActions = this.result.CREATE.getActions()
      const removeActions = this.result.REMOVE.getActions()

      // Index REMOVE actions for O(1) lookups
      // Build a multi-value Fuzzy Index of all REMOVE subtrees
      const removedFuzzyMap = new Map<
        string,
        { rootAction: RemoveAction<L1, L2>; item: TItem<L1> }[]
      >()

      const addToMap = (item: TItem<L1>, action: RemoveAction<L1, L2>) => {
        const key = `${item.type}_${item.title}_${
          item.type === 'bookmark' ? (item as Bookmark<TItemLocation>).url : ''
        }`
        const list = removedFuzzyMap.get(key) || []
        list.push({ rootAction: action, item })
        removedFuzzyMap.set(key, list)
      }

      for (const action of removeActions) {
        const rootItem = action.payload
        addToMap(rootItem, action)

        if (rootItem instanceof Folder) {
          await rootItem.traverse((child) => addToMap(child, action))
        }
      }

      // Single pass over CREATE actions to find direct matches
      for (const createAction of createActions) {
        await yieldToEventLoop()
        const createdItem = createAction.payload
        const key = `${createdItem.type}_${createdItem.title}_${
          createdItem.type === 'bookmark' ? (createdItem as Bookmark<TItemLocation>).url : ''
        }`

        const potentialRemovals = removedFuzzyMap.get(key)
        if (!potentialRemovals) continue

        const matchIndex = potentialRemovals.findIndex(
          ({rootAction, item }) =>
            item === rootAction.payload &&
            this.mergeable(item, createdItem) &&
            (rootAction.payload.type !== 'folder' ||
              (!this.hasCache &&
                item.childrenSimilarity(createdItem) > 0.8))
        )

        if (matchIndex !== -1) {
          const {rootAction: removeAction} = potentialRemovals.splice(matchIndex, 1)[0]
          const removedItem = removeAction.payload

          this.result.CREATE.retract(createAction)
          this.result.REMOVE.retract(removeAction)
          this.result.MOVE.commit({
            type: ActionType.MOVE,
            payload: createdItem,
            oldItem: removedItem,
            index: createAction.index,
            oldIndex: removeAction.index,
          })

          // Diff
          await this.diffItem(removedItem, createdItem)
          hasNewActions = true
          break
        }
      }

      if (hasNewActions) continue

      // Process descendant matches
      for (const createAction of createActions) {
        await yieldToEventLoop()
        const createdItem = createAction.payload
        const fuzzyKey = `${createdItem.type}_${createdItem.title}_${
          createdItem.type === 'bookmark' ? (createdItem as Bookmark<TItemLocation>).url : ''
        }`

        const potentialMatches = removedFuzzyMap.get(fuzzyKey)
        if (!potentialMatches) continue

        // Find the first match that satisfies mergeable logic
        const matchIndex = potentialMatches.findIndex(
          (match) =>
            this.mergeable(match.item, createdItem) &&
            (match.item.type !== 'folder' ||
              (!this.hasCache &&
                match.item.childrenSimilarity(createdItem) > 0.8))
        )

        if (matchIndex !== -1) {
          // Extract the specific match from the array
          const { rootAction, item: oldItem } = potentialMatches.splice(
            matchIndex,
            1
          )[0]
          const removedItem = rootAction.payload
          let oldIndex

          this.result.CREATE.retract(createAction)

          if (oldItem === removedItem) {
            this.result.REMOVE.retract(rootAction)
          } else {
            const removedItemClone = removedItem.copy(true)
            const oldParentClone = removedItemClone.findItem(
              ItemType.FOLDER,
              oldItem.parentId
            ) as Folder<L1>
            const oldItemClone = removedItemClone.findItem(
              oldItem.type,
              oldItem.id
            )

            if (oldParentClone && oldItemClone) {
              oldIndex = oldParentClone.children.indexOf(oldItemClone)
              oldParentClone.children.splice(oldIndex, 1)
              rootAction.payload = removedItemClone
              rootAction.payload.createIndex()
            }
          }

          this.result.MOVE.commit({
            type: ActionType.MOVE,
            payload: createdItem,
            oldItem,
            index: createAction.index,
            oldIndex: oldIndex ?? rootAction.index,
          })

          await this.diffItem(oldItem, createdItem)
          hasNewActions = true
          break
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
    // Give the browser time to breathe
    await yieldToEventLoop()
    this.result.REMOVE.getActions()
      .forEach(action => {
        sources[action.payload.parentId] = true
      })
    // Give the browser time to breathe
    await yieldToEventLoop()
    this.result.MOVE.getActions()
      .forEach(action => {
        targets[action.payload.parentId] = true
        sources[action.oldItem.parentId] = true
      })

    for (const folderId in sources) {
      // Give the browser time to breathe
      await yieldToEventLoop()
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
      // Give the browser time to breathe
      await yieldToEventLoop()
      const newFolder = this.newTree.findItem(ItemType.FOLDER, folderId) as Folder<L2>
      const duplicate = this.result.REORDER.getActions().find(a => String(a.payload.id) === String(newFolder.id))
      if (duplicate) {
        this.result.REORDER.retract(duplicate)
      }
      if (newFolder.children.length > 10000) {
        continue
      }
      this.result.REORDER.commit({
        type: ActionType.REORDER,
        payload: newFolder,
        order: newFolder.children.map(i => ({ type: i.type, id: i.id })),
      })
    }
  }
}
