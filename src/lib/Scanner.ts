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

      if (createActions.length === 0 || removeActions.length === 0) break

      // Build Multi-Signal Fuzzy Index (O(N))
      const removedFuzzyMap = new Map<string, { rootAction: RemoveAction<L1, L2>; item: TItem<L1> }[]>()
      const allCreatedItems: { rootAction: CreateAction<L2, L1>; item: TItem<L2> }[] = []

      const addToFuzzyIndex = (item: TItem<L1>, action: RemoveAction<L1, L2>) => {
        const keys = new Set<string>()
        // Signal 1: Full signature (Type + Title + URL)
        keys.add(`${item.type}_${item.title}_${item.type === 'bookmark' ? (item as Bookmark<L1>).url : ''}`)

        // Signal 2: Title only (Handles URL changes for bookmarks or ID changes for folders)
        if (item.title) keys.add(`${item.type}_title_${item.title}`)

        // Signal 3: URL only (Handles Title changes for bookmarks)
        if (item instanceof Bookmark) keys.add(`bookmark_url_${item.url}`)

        keys.add(item.type)

        for (const key of keys) {
          removedFuzzyMap.set(key, (removedFuzzyMap.get(key) || []).concat({ rootAction: action, item }))
        }
      }

      for (const action of removeActions) {
        await addToFuzzyIndex(action.payload, action)
        if (action.payload instanceof Folder) {
          await action.payload.traverse((child) => addToFuzzyIndex(child, action))
        }
      }

      for (const action of createActions) {
        allCreatedItems.push({ rootAction: action, item: action.payload })
        if (action.payload instanceof Folder) {
          await action.payload.traverse((child) => {
            allCreatedItems.push({ rootAction: action, item: child })
          })
        }
      }

      allCreatedItems
        .sort((a, b) => b.item.count() - a.item.count())

      // Match ALL created items (roots + descendants) against removed pool
      let i = 0
      for (const createdEntry of allCreatedItems) {
        if (i === 100) {
          i = 0
          await yieldToEventLoop()
        }
        i++
        const { rootAction: createRootAction, item: createdItem } = createdEntry

        // Gather potential matches from all signals
        const searchKeys = [
          `${createdItem.type}_${createdItem.title}_${createdItem.type === 'bookmark' ? (createdItem as Bookmark<L2>).url : ''}`,
          `${createdItem.type}_title_${createdItem.title}`,
          ...(createdItem instanceof Bookmark ? [`bookmark_url_${createdItem.url}`] : []),
          createdItem.type
        ]

        // Collect unique potential matches from all signals
        const potentialSet = new Set<{ rootAction: RemoveAction<L1, L2>; item: TItem<L1> }>()
        for (const key of searchKeys) {
          const list = removedFuzzyMap.get(key)
          if (list && list.filter((m) => this.mergeable(m.item, createdItem)).length) {
            list.forEach(m => potentialSet.add(m))
            break
          }
        }

        if (potentialSet.size === 0) {
          continue
        }

        const matches = Array.from(potentialSet).filter((m) =>
          this.mergeable(m.item, createdItem)
        )

        // Heuristic: Prefer matches that have more descendants
        // In case we have no cache: Calculate similarity and sore by it
        matches.sort((a, b) => {
          if (createdItem.type === 'folder' && !this.hasCache) {
            const simA = a.item.childrenSimilarity(createdItem)
            const simB = b.item.childrenSimilarity(createdItem)
            if (simA !== simB) return simB - simA
          }
          return b.item.count() - a.item.count()
        })

        if (matches.length === 0) {
          continue
        }

        const { rootAction: removeRootAction, item: oldItem } = matches[0]
        const removedRoot = removeRootAction.payload
        const createdRoot = createRootAction.payload

        let oldIndex, newIndex

        // Retract or Mutate "Old" (Removed) side
        if (oldItem === removedRoot) {
          this.result.REMOVE.retract(removeRootAction)
        } else {
          const removedRootClone = removedRoot.copy(true)
          const oldParentClone = removedRootClone.findItem(
            ItemType.FOLDER,
            oldItem.parentId
          ) as Folder<L1>
          const oldItemClone = removedRootClone.findItem(
            oldItem.type,
            oldItem.id
          )
          if (oldParentClone && oldItemClone) {
            oldIndex = oldParentClone.children.indexOf(oldItemClone)
            oldParentClone.children.splice(oldIndex, 1)
            removeRootAction.payload = removedRootClone
            removeRootAction.payload.createIndex()
          }
        }

        // Retract or Mutate "New" (Created) side
        if (createdItem === createdRoot) {
          this.result.CREATE.retract(createRootAction)
        } else {
          const createdRootClone = createdRoot.copy(true)
          const newParentClone = createdRootClone.findItem(
            ItemType.FOLDER,
            createdItem.parentId
          ) as Folder<L2>
          const createdItemClone = createdRootClone.findItem(
            createdItem.type,
            createdItem.id
          )
          if (newParentClone && createdItemClone) {
            newIndex = newParentClone.children.indexOf(createdItemClone)
            newParentClone.children.splice(newIndex, 1)
            createRootAction.payload = createdRootClone
            createRootAction.payload.createIndex()
          }
        }

        this.result.MOVE.commit({
          type: ActionType.MOVE,
          payload: createdItem,
          oldItem,
          index: newIndex ?? createRootAction.index,
          oldIndex: oldIndex ?? removeRootAction.index,
        })

        await this.diffItem(oldItem, createdItem)
        hasNewActions = true
        break
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
