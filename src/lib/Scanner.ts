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
    let index = 0
    for (const old of oldFolder.children) {
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
        index++
        continue
      }

      if (newFolder.isRoot && newFolder.location === ItemLocation.LOCAL) {
        // We can't remove root folders locally
        index++
        continue
      }

      this.result.REMOVE.commit({
        type: ActionType.REMOVE,
        payload: old,
        index,
      })

      index++
    }

    // created Items
    const childToIndex = new Map<TItem<L2>, number>()
    newFolder.children.forEach((child, i) => childToIndex.set(child, i))

    for (const newChild of stillUnmatched) {
      if (oldFolder.isRoot && oldFolder.location === ItemLocation.LOCAL) {
        // We can't create root folders locally
        continue
      }
      this.result.CREATE.commit({
        type: ActionType.CREATE,
        payload: newChild,
        index: childToIndex.get(newChild),
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

    const handledRemovals = new Set<TItem<L1>>()
    const handledCreations = new Set<TItem<L2>>()
    const removedFuzzyMap = new Map<string, Set<{ rootAction: RemoveAction<L1, L2>; item: TItem<L1> }>>()
    const creationQueue: { rootAction: CreateAction<L2, L1>; item: TItem<L2> }[] = []

    // Initial Indexing

    const addToRemovedFuzzyMap = (
      action: RemoveAction<L1, L2>,
      item: TItem<L1>
    ) => {
      const keys = new Set<string>()
      // Signal 1: Full signature (Type + Title + URL)
      keys.add(
        `${item.type}_${item.title}_${
          item.type === 'bookmark' ? (item as Bookmark<L1>).url : ''
        }`
      )

      // Signal 2: Title only (Handles URL changes for bookmarks or ID changes for folders)
      if (item.title) keys.add(`${item.type}_title_${item.title}`)

      // Signal 3: URL only (Handles Title changes for bookmarks)
      if (item instanceof Bookmark) keys.add(`bookmark_url_${item.url}`)

      keys.add(item.type)

      const element = { rootAction: action, item } // outside the loop so we can later use Set#has
      for (const key of keys) {
        let list = removedFuzzyMap.get(key)
        if (!list) {
          list = new Set()
          removedFuzzyMap.set(key, list)
        }
        list.add(element)
      }
    }

    for (const action of this.result.REMOVE.getActions()) {
      addToRemovedFuzzyMap(action, action.payload)
      if (action.payload instanceof Folder) {
        await action.payload.traverse(item => addToRemovedFuzzyMap(action, item))
      }
    }

    const enqueueNewCreations = async() => {
      const currentActions = this.result.CREATE.getActions()
      const newEntries: typeof creationQueue = []
      for (const action of currentActions) {
        // Only enqueue items we haven't seen before
        if (handledCreations.has(action.payload)) continue

        // We use a property check or external tracking to avoid re-enqueuing the same Action object
        // but for simplicity here we assume the queue only grows from new diffItem calls
        newEntries.push({ rootAction: action, item: action.payload })
        if (action.payload instanceof Folder) {
          await action.payload.traverse(child => {
            newEntries.push({ rootAction: action, item: child })
          })
        }
      }
      creationQueue.push(...newEntries)
      creationQueue.sort((a, b) => (b.item.countFolders() * 1000 + b.item.count()) - (a.item.countFolders() * 1000 + a.item.count()))
    }

    await enqueueNewCreations()

    // 2. Process queue in a single pass
    let iterations = 0
    while (creationQueue.length > 0) {
      const entry = creationQueue.shift()
      const { rootAction: createRootAction, item: createdItem } = entry

      if (handledCreations.has(createdItem)) continue
      if (++iterations % 1000 === 0) await yieldToEventLoop()

      const searchKeys = [
        `${createdItem.type}_${createdItem.title}_${createdItem.type === 'bookmark' ? (createdItem as Bookmark<L2>).url : ''}`,
        `${createdItem.type}_title_${createdItem.title}`,
        ...(createdItem instanceof Bookmark ? [`bookmark_url_${createdItem.url}`] : []),
        createdItem.type
      ]

      let bestMatch = null
      for (const key of searchKeys) {
        const list = removedFuzzyMap.get(key)
        if (!list) continue
        const matches = Array.from(list).filter(
          (m) =>
            !handledRemovals.has(m.item) && this.mergeable(m.item, createdItem)
        )
        if (matches.length > 0) {
          // Heuristic: Prefer matches that have more descendants
          // In case we have no cache: Calculate similarity and sore by it
          matches.sort((a, b) => {
            if (createdItem.type === 'folder' && !this.hasCache) {
              const simA = a.item.childrenSimilarity(createdItem)
              const simB = b.item.childrenSimilarity(createdItem)
              if (simA !== simB) return simB - simA
            }
            return (b.item.countFolders() * 1000 + b.item.count()) - (a.item.countFolders() * 1000 + a.item.count())
          })
          bestMatch = matches[0]
          break
        }
      }

      if (bestMatch) {
        const { rootAction: removeRootAction, item: oldItem } = bestMatch
        const removedRoot = removeRootAction.payload
        const createdRoot = createRootAction.payload

        let oldIndex, newIndex

        // Handle the "Old" (Removed) side
        if (oldItem === removedRoot) {
          this.result.REMOVE.retract(removeRootAction)
        } else {
          const clone = (removedRoot as Folder<L1>).clone(true)
          const parentClone = clone.findItem(ItemType.FOLDER, oldItem.parentId) as Folder<L1>
          const itemClone = clone.findItem(oldItem.type, oldItem.id)
          if (parentClone && itemClone) {
            oldIndex = parentClone.children.indexOf(itemClone)
            parentClone.children.splice(oldIndex, 1)
            clone.createIndex()
            removeRootAction.payload = clone
          }
        }

        // Handle the "New" (Created) side
        if (createdItem === createdRoot) {
          this.result.CREATE.retract(createRootAction)
        } else {
          const clone = (createdRoot as Folder<L2>).clone(true)
          const parentClone = clone.findItem(ItemType.FOLDER, createdItem.parentId) as Folder<L2>
          const itemClone = clone.findItem(createdItem.type, createdItem.id)
          if (parentClone && itemClone) {
            newIndex = parentClone.children.indexOf(itemClone)
            parentClone.children.splice(newIndex, 1)
            clone.createIndex()
            createRootAction.payload = clone
          }
        }

        // Mark matched branches as handled
        const markHandled = async(item: TItem<any>, set: Set<TItem<any>>) => {
          set.add(item)
          if (item instanceof Folder) await item.traverse(child => set.add(child))
        }
        await markHandled(oldItem, handledRemovals)
        await markHandled(createdItem, handledCreations)

        this.result.MOVE.commit({
          type: ActionType.MOVE,
          payload: createdItem,
          oldItem,
          index: newIndex ?? createRootAction.index,
          oldIndex: oldIndex ?? removeRootAction.index,
        })

        // Diff the matched items (which might discover more creates/removes)
        const prevCreateCount = this.result.CREATE.getActions().length
        await this.diffItem(oldItem, createdItem)

        if (this.result.CREATE.getActions().length > prevCreateCount) {
          await enqueueNewCreations()
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
