import * as Parallel from 'async-parallel'
import Diff, { Action, ActionType, CreateAction, RemoveAction } from './Diff'
import { Bookmark, Folder, ItemType, TItem } from './Tree'

export default class Scanner {
  private oldTree: TItem
  private newTree: TItem
  private mergeable: (i1: TItem, i2: TItem) => boolean
  private preserveOrder: boolean
  private checkHashes: boolean
  private diff: Diff
  constructor(oldTree:TItem, newTree:TItem, mergeable:(i1:TItem, i2:TItem)=>boolean, preserveOrder:boolean, checkHashes = true) {
    this.oldTree = oldTree
    this.newTree = newTree
    this.mergeable = mergeable
    this.preserveOrder = preserveOrder
    this.checkHashes = typeof checkHashes === 'undefined' ? true : checkHashes
    this.diff = new Diff()
  }

  getDiff():Diff {
    return this.diff
  }

  async run():Promise<Diff> {
    this.diff = new Diff()
    await this.diffItem(this.oldTree, this.newTree)
    await this.findMoves()
    return this.diff
  }

  async diffItem(oldItem:TItem, newItem:TItem):Promise<void> {
    if (oldItem.type === 'folder' && newItem.type === 'folder') {
      return this.diffFolder(oldItem, newItem)
    } else if (oldItem.type === 'bookmark' && newItem.type === 'bookmark') {
      return this.diffBookmark(oldItem, newItem)
    } else {
      throw new Error('Mismatched diff items: ' + oldItem.type + ', ' + newItem.type)
    }
  }

  async diffFolder(oldFolder:Folder, newFolder:Folder):Promise<void> {
    if (this.checkHashes) {
      const hasChanged = await this.folderHasChanged(oldFolder, newFolder)
      if (!hasChanged) {
        return
      }
    }
    if (oldFolder.title !== newFolder.title && oldFolder.parentId && newFolder.parentId) {
      // folder title changed and it's not the root folder
      this.diff.commit({type: ActionType.UPDATE, payload: newFolder, oldItem: oldFolder})
    }

    // Preserved Items and removed Items
    // (using map here, because 'each' doesn't provide indices)
    await Parallel.map(oldFolder.children, async(old, index) => {
      const newItem = newFolder.children.find((child) => old.type === child.type && this.mergeable(old, child))
      if (newItem) {
        await this.diffItem(old, newItem)
        return
      }

      this.diff.commit({type: ActionType.REMOVE, payload: old, index})
    }, 1)

    // created Items
    // (using map here, because 'each' doesn't provide indices)
    await Parallel.map(newFolder.children, async(newChild, index) => {
      if (!oldFolder.children.some(old => old.type === newChild.type && this.mergeable(old, newChild))) {
        this.diff.commit({type: ActionType.CREATE, payload: newChild, index})
      }
    }, 1)

    if (newFolder.children.length > 1 || oldFolder.children.length > 1) {
      this.diff.commit({
        type: ActionType.REORDER,
        payload: newFolder,
        oldItem: oldFolder,
        order: newFolder.children.map(i => ({ type: i.type, id: i.id })),
        oldOrder: oldFolder.children.map(i => ({ type: i.type, id: i.id }))
      })
    }
  }

  async diffBookmark(oldBookmark:Bookmark, newBookmark:Bookmark):Promise<void> {
    let hasChanged
    if (this.checkHashes) {
      hasChanged = await this.bookmarkHasChanged(oldBookmark, newBookmark)
    } else {
      hasChanged = oldBookmark.title !== newBookmark.title || oldBookmark.url !== newBookmark.url
    }
    if (hasChanged) {
      this.diff.commit({ type: ActionType.UPDATE, payload: newBookmark, oldItem: oldBookmark })
    }
  }

  async bookmarkHasChanged(oldBookmark:Bookmark, newBookmark:Bookmark):Promise<boolean> {
    const oldHash = await oldBookmark.hash()
    const newHash = await newBookmark.hash()
    return oldHash !== newHash
  }

  async folderHasChanged(oldFolder:Folder, newFolder:Folder):Promise<boolean> {
    const oldHash = await oldFolder.hash(this.preserveOrder)
    const newHash = await newFolder.hash(this.preserveOrder)
    return oldHash !== newHash
  }

  sort(actions: Action[]): Action[] {
    const bookmarks = actions.filter(a => a.payload.type === ItemType.BOOKMARK)
    let folders = actions.filter(a => a.payload.type === ItemType.FOLDER)
    folders = folders.sort((a1, a2) => {
      const f1 = a1.payload as Folder
      const f2 = a2.payload as Folder
      if (f1.count() > f2.count()) {
        return 1
      } else if (f1.count() < f2.count()) {
        return -1
      } else {
        return 0
      }
    })

    return folders.concat(bookmarks)
  }

  async findMoves():Promise<void> {
    let createActions
    let removeActions
    let reconciled = true

    // As soon as one match is found, action list is updated and search is started with the new list
    // repeat until no rewrites happen anymore
    while (reconciled) {
      reconciled = false
      let createAction: CreateAction, removeAction: RemoveAction

      // First find direct matches (avoids glitches when folders and their contents have been moved)
      createActions = this.sort(this.diff.getActions(ActionType.CREATE)).map(a => a as CreateAction)
      while (!reconciled && (createAction = createActions.shift())) {
        const createdItem = createAction.payload
        removeActions = this.sort(this.diff.getActions(ActionType.REMOVE)).map(a => a as RemoveAction)
        while (!reconciled && (removeAction = removeActions.shift())) {
          const removedItem = removeAction.payload
          // We also allow canMergeWith here, because e.g. for NextcloudFolders the id of moved bookmarks changes
          // 2020-12-21 15:09 -- removed this part because I couldn't make sense of why I added it...
          if (this.mergeable(removedItem, createdItem) || (removedItem.type === 'bookmark' && removedItem.canMergeWith(createdItem))) {
            this.diff.retract(createAction)
            this.diff.retract(removeAction)
            this.diff.commit({
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
      createActions = this.sort(this.diff.getActions(ActionType.CREATE)).map(a => a as CreateAction)
      while (!reconciled && (createAction = createActions.shift())) {
        const createdItem = createAction.payload
        removeActions = this.sort(this.diff.getActions(ActionType.REMOVE)).map(a => a as RemoveAction)
        while (!reconciled && (removeAction = removeActions.shift())) {
          const removedItem = removeAction.payload
          const oldItem = removedItem.findItemFilter(createdItem.type, item => this.mergeable(item, createdItem))
          if (oldItem) {
            let oldIndex
            this.diff.retract(createAction)
            if (oldItem === removedItem) {
              this.diff.retract(removeAction)
            } else {
              // We clone the item here, because we don't want to mutate all copies of this tree (item)
              const clonedRemovedItem = removedItem.clone()
              const oldParent = clonedRemovedItem.findItem('folder', oldItem.parentId) as Folder
              const oldClonedItem = oldParent.findItem(oldItem.type, oldItem.id)
              oldIndex = oldParent.children.indexOf(oldClonedItem)
              oldParent.children.splice(oldIndex, 1)
              removeAction.payload = clonedRemovedItem
            }
            this.diff.commit({
              type: ActionType.MOVE,
              payload: createdItem,
              oldItem,
              index: createAction.index,
              oldIndex: oldIndex || removeAction.index
            })
            reconciled = true
            await this.diffItem(oldItem, createdItem)
          } else {
            const newItem = createdItem.findItemFilter(removedItem.type, item => this.mergeable(removedItem, item))
            let index
            if (newItem) {
              this.diff.retract(removeAction)
              if (newItem === createdItem) {
                this.diff.retract(createAction)
              } else {
                // We clone the item here, because we don't want to mutate all copies of this tree (item)
                const clonedCreatedItem = createdItem.clone()
                const newParent = clonedCreatedItem.findItem('folder', newItem.parentId) as Folder
                const newClonedItem = newParent.findItem(newItem.type, newItem.id) as Folder
                index = newParent.children.indexOf(newClonedItem)
                newParent.children.splice(index, 1)
                createAction.payload = clonedCreatedItem
              }
              this.diff.commit({
                type: ActionType.MOVE,
                payload: newItem,
                oldItem: removedItem,
                index: index || createAction.index,
                oldIndex: removeAction.index
              })
              reconciled = true
              await this.diffItem(removedItem, newItem)
            }
          }
        }
      }
    }
  }
}
