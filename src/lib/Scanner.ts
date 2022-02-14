import * as Parallel from 'async-parallel'
import Diff, { ActionType } from './Diff'
import { Bookmark, Folder, ItemType, TItem } from './Tree'

export default class Scanner {
  private oldTree: TItem
  private newTree: TItem
  private mergeable: (i1: TItem, i2: TItem) => boolean
  private preserveOrder: boolean
  private checkHashes: boolean
  private diff: Diff
  private mapForward: (item:TItem) => (number | string)
  private mapBackward: (item:TItem) => (number | string)
  constructor(oldTree:TItem, newTree:TItem, mergeable:(i1:TItem, i2:TItem)=>boolean, preserveOrder:boolean, checkHashes = true, mapForward:(item:TItem) => number|string, mapBackward:(item:TItem) => number|string) {
    this.oldTree = oldTree
    this.newTree = newTree
    this.mergeable = mergeable
    this.mapForward = mapForward
    this.mapBackward = mapBackward
    this.preserveOrder = preserveOrder
    this.checkHashes = typeof checkHashes === 'undefined' ? true : checkHashes
    this.diff = new Diff()
  }

  getDiff():Diff {
    return this.diff
  }

  async run():Promise<Diff> {
    this.diff = new Diff()

    this.oldTree.createIndex()
    this.newTree.createIndex()

    const fuzzyMatchedOld = []
    const idMatchedOld = []

    // List items that are in oldTree but not in newTree

    await this.oldTree.map(ItemType.FOLDER, async(oldItem) => {
      if (typeof this.mapForward(oldItem) === 'undefined') {
        if (!this.newTree.findItemFilter(ItemType.FOLDER, newItem => this.mergeable(newItem, oldItem))) {
          this.diff.commit({ type: ActionType.REMOVE, payload: oldItem })
        } else {
          fuzzyMatchedOld.push(oldItem)
        }
      } else if (!this.newTree.findItem(ItemType.FOLDER, this.mapForward(oldItem))) {
        this.diff.commit({ type: ActionType.REMOVE, payload: oldItem })
      } else {
        idMatchedOld.push(oldItem)
      }
    })

    await this.oldTree.map(ItemType.BOOKMARK, async(oldItem) => {
      if (typeof this.mapForward(oldItem) === 'undefined') {
        if (!this.newTree.findItemFilter(ItemType.BOOKMARK, newItem => this.mergeable(newItem, oldItem))) {
          this.diff.commit({ type: ActionType.REMOVE, payload: oldItem })
        } else {
          fuzzyMatchedOld.push(oldItem)
        }
      } else if (!this.newTree.findItem(ItemType.BOOKMARK, this.mapForward(oldItem))) {
        this.diff.commit({ type: ActionType.REMOVE, payload: oldItem })
      } else {
        idMatchedOld.push(oldItem)
      }
    })

    // List items that are in newTree but not in oldTree

    const idMatchedNew = []
    const fuzzyMatchedNew = []

    await this.newTree.map(ItemType.FOLDER, async(newItem) => {
      if (typeof this.mapBackward(newItem) === 'undefined') {
        if (!this.oldTree.findItemFilter(ItemType.FOLDER, oldItem => this.mergeable(newItem, oldItem))) {
          const index = (this.newTree.findItem(ItemType.FOLDER, newItem.parentId) as Folder).children.indexOf(newItem)
          this.diff.commit({ type: ActionType.CREATE, payload: newItem, index })
        } else {
          fuzzyMatchedNew.push(newItem)
        }
      } else if (!this.newTree.findItem(ItemType.FOLDER, this.mapBackward(newItem))) {
        const index = (this.newTree.findItem(ItemType.FOLDER, newItem.parentId) as Folder).children.indexOf(newItem)
        this.diff.commit({ type: ActionType.CREATE, payload: newItem, index })
      } else {
        idMatchedNew.push(newItem)
      }
    })

    await this.newTree.map(ItemType.BOOKMARK, async(newItem) => {
      if (typeof this.mapBackward(newItem) === 'undefined') {
        if (!this.oldTree.findItemFilter(ItemType.BOOKMARK, oldItem => this.mergeable(newItem, oldItem))) {
          const index = (this.newTree.findItem(ItemType.FOLDER, newItem.parentId) as Folder).children.indexOf(newItem)
          this.diff.commit({ type: ActionType.CREATE, payload: newItem, index })
        } else {
          fuzzyMatchedNew.push(newItem)
        }
      } else if (!this.newTree.findItem(ItemType.BOOKMARK, this.mapBackward(newItem))) {
        const index = (this.newTree.findItem(ItemType.FOLDER, newItem.parentId) as Folder).children.indexOf(newItem)
        this.diff.commit({ type: ActionType.CREATE, payload: newItem, index })
      } else {
        idMatchedNew.push(newItem)
      }
    })

    await Parallel.map(idMatchedNew, (item) => this.diffMatchedItem(item))
    await Parallel.map(fuzzyMatchedNew, (item) => this.diffFuzzyMatchedItem(item))

    return this.diff
  }

  async diffMatchedItem(newItem:TItem):Promise<void> {
    const oldItem = this.oldTree.findItem(newItem.type, this.mapBackward(newItem))
    let hasChanged
    if (this.checkHashes) {
      if (newItem.type === ItemType.FOLDER && oldItem.type === ItemType.FOLDER) {
        hasChanged = await this.folderHasChanged(oldItem, newItem)
      }
      if (newItem.type === ItemType.BOOKMARK && oldItem.type === ItemType.BOOKMARK) {
        hasChanged = await this.bookmarkHasChanged(oldItem, newItem)
      }
    } else if (newItem.type === ItemType.BOOKMARK && oldItem.type === ItemType.BOOKMARK) {
      hasChanged = oldItem.title !== newItem.title || oldItem.url !== newItem.url
    }
    if (!hasChanged) {
      return
    }

    const index = (this.newTree.findItem(ItemType.FOLDER, newItem.parentId) as Folder).children.indexOf(newItem)
    const oldIndex = (this.oldTree.findItem(ItemType.FOLDER, oldItem.parentId) as Folder).children.indexOf(oldItem)
    const oldParent = this.oldTree.findItem(ItemType.FOLDER, oldItem.parentId) as Folder
    const newParent = this.newTree.findItem(ItemType.FOLDER, newItem.parentId) as Folder

    if (oldItem.parentId && newItem.parentId && !this.mergeable(oldParent, newParent)) {
      this.diff.commit({
        type: ActionType.MOVE,
        payload: newItem,
        oldItem,
        index: index,
        oldIndex: oldIndex
      })
      this.diff.commit({
        type: ActionType.REORDER,
        payload: newParent,
        order: newParent.children.map(i => ({ type: i.type, id: i.id })),
      })
      const newOldParent = this.newTree.findItem(ItemType.FOLDER, this.mapForward(oldParent)) as Folder
      this.diff.commit({
        type: ActionType.REORDER,
        payload: newOldParent,
        order: newOldParent.children.map(i => ({ type: i.type, id: i.id })),
      })
      this.diff.commit({
        type: ActionType.REORDER,
        payload: newParent,
        order: newParent.children.map(i => ({ type: i.type, id: i.id })),
      })
      return
    }

    if (oldItem.parentId && newItem.parentId && !this.mergeable(oldParent, newParent) && index !== oldIndex) {
      this.diff.commit({
        type: ActionType.REORDER,
        payload: newParent,
        order: newParent.children.map(i => ({ type: i.type, id: i.id })),
      })
    }

    if (oldItem.title !== newItem.title && oldItem.parentId && newItem.parentId) {
      // folder title changed and it's not the root folder
      this.diff.commit({type: ActionType.UPDATE, payload: newItem, oldItem: oldItem})
    }
  }

  async diffFuzzyMatchedItem(newItem:TItem):Promise<void> {
    const oldItem = this.oldTree.findItemFilter(newItem.type, item => this.mergeable(item, newItem))
    let hasChanged
    if (this.checkHashes) {
      if (newItem.type === ItemType.FOLDER && oldItem.type === ItemType.FOLDER) {
        hasChanged = await this.folderHasChanged(oldItem, newItem)
      }
      if (newItem.type === ItemType.BOOKMARK && oldItem.type === ItemType.BOOKMARK) {
        hasChanged = await this.bookmarkHasChanged(oldItem, newItem)
      }
    } else if (newItem.type === ItemType.BOOKMARK && oldItem.type === ItemType.BOOKMARK) {
      hasChanged = oldItem.title !== newItem.title || oldItem.url !== newItem.url
    }
    if (!hasChanged) {
      return
    }

    const index = (this.newTree.findItem(ItemType.FOLDER, newItem.parentId) as Folder).children.indexOf(newItem)
    const oldIndex = (this.oldTree.findItem(ItemType.FOLDER, oldItem.parentId) as Folder).children.indexOf(oldItem)
    const oldParent = this.oldTree.findItem(ItemType.FOLDER, oldItem.parentId) as Folder
    const newParent = this.newTree.findItem(ItemType.FOLDER, newItem.parentId) as Folder

    if (oldItem.parentId && newItem.parentId && !this.mergeable(oldParent, newParent)) {
      this.diff.commit({
        type: ActionType.MOVE,
        payload: newItem,
        oldItem,
        index: index,
        oldIndex: oldIndex
      })
      this.diff.commit({
        type: ActionType.REORDER,
        payload: newParent,
        order: newParent.children.map(i => ({ type: i.type, id: i.id })),
      })
      const newOldParent = this.newTree.findItemFilter(ItemType.FOLDER, item => this.mergeable(item, oldParent)) as Folder
      this.diff.commit({
        type: ActionType.REORDER,
        payload: newOldParent,
        order: newOldParent.children.map(i => ({ type: i.type, id: i.id })),
      })
      this.diff.commit({
        type: ActionType.REORDER,
        payload: newParent,
        order: newParent.children.map(i => ({ type: i.type, id: i.id })),
      })
      return
    }

    if (oldItem.parentId && newItem.parentId && !this.mergeable(oldParent, newParent) && index !== oldIndex) {
      this.diff.commit({
        type: ActionType.REORDER,
        payload: newParent,
        order: newParent.children.map(i => ({ type: i.type, id: i.id })),
      })
    }

    if (oldItem.title !== newItem.title && oldItem.parentId && newItem.parentId) {
      // folder title changed and it's not the root folder
      this.diff.commit({type: ActionType.UPDATE, payload: newItem, oldItem: oldItem})
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
}
