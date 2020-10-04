import * as Parallel from 'async-parallel'
import Diff, { ActionType } from './Diff'
import { Bookmark, Folder, TItem } from './Tree'

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

  async findMoves():Promise<void> {
    let createActions
    let removeActions
    let reconciled = true

    // As soon as one match is found, action list is updated and search is started with the new list
    // repeat until no rewrites happen anymore
    while (reconciled) {
      reconciled = false
      let createAction, removeAction

      // First find direct matches (avoids glitches when folders and their contents have been moved)
      createActions = this.diff.getActions().filter((action) => action.type === ActionType.CREATE)
      while (!reconciled && (createAction = createActions.shift())) {
        const createdItem = createAction.payload
        removeActions = this.diff.getActions().filter(action => action.type === ActionType.REMOVE)
        while (!reconciled && (removeAction = removeActions.shift())) {
          const removedItem = removeAction.payload
          if (this.mergeable(removedItem, createdItem)) {
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
            await this.diffItem(removedItem, createdItem)
          }
        }
      }

      // Then find descendant matches
      createActions = this.diff.getActions().filter((action) => action.type === ActionType.CREATE)
      while (!reconciled && (createAction = createActions.shift())) {
        const createdItem = createAction.payload
        removeActions = this.diff.getActions().filter(action => action.type === ActionType.REMOVE)
        while (!reconciled && (removeAction = removeActions.shift())) {
          const removedItem = removeAction.payload
          const oldItem = removedItem.findItemFilter(createdItem.type, item => this.mergeable(item, createdItem))
          if (oldItem) {
            let oldIndex
            this.diff.retract(createAction)
            if (oldItem === removedItem) {
              this.diff.retract(removeAction)
            } else {
              const oldParent = removedItem.findItem('folder', oldItem.parentId)
              oldIndex = oldParent.children.indexOf(oldItem)
              oldParent.children.splice(oldIndex, 1)
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
                const newParent = createdItem.findItem('folder', newItem.parentId)
                index = newParent.children.indexOf(newItem)
                newParent.children.splice(index, 1)
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
