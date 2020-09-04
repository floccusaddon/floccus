const Parallel = require('async-parallel')
import Diff, { actions } from './Diff'

export default class Scanner {
  constructor(oldTree, newTree, mergeable, preserveOrder) {
    this.oldTree = oldTree
    this.newTree = newTree
    this.mergeable = mergeable
    this.preserveOrder = preserveOrder
    this.diff = new Diff()
  }

  getDiff() {
    return this.diff
  }

  async run() {
    this.diff = new Diff()
    await this.diffItem(this.oldTree, this.newTree)
    await this.findMoves()
    return this.diff
  }

  async diffItem(oldItem, newItem) {
    if (oldItem.type === 'folder') {
      return this.diffFolder(oldItem, newItem)
    } else {
      return this.diffBookmark(oldItem, newItem)
    }
  }

  async diffFolder(oldFolder, newFolder) {
    const hasChanged = await this.folderHasChanged(oldFolder, newFolder)
    if (!hasChanged) {
      return
    }
    if (oldFolder.title !== newFolder.title && oldFolder.parentId && newFolder.parentId) {
      this.diff.commit({type: actions.UPDATE, payload: newFolder, oldItem: oldFolder})
    }

    let preservedItems = oldFolder.children.filter(old =>
      newFolder.children.some(
        newChild =>
          newChild.type === old.type &&
          this.mergeable(old, newChild)
      )
    )
    let createdItems = newFolder.children.filter(
      newChild =>
        !oldFolder.children.some(old => old.type === newChild.type && this.mergeable(old, newChild))
    )
    let removedItems = oldFolder.children.filter(
      old => !newFolder.children.some(newChild => newChild.type === old.type && this.mergeable(old, newChild))
    )

    await Parallel.each(preservedItems, async(item) => {
      const newItem = newFolder.children.find((child) => item.type === child.type && this.mergeable(item, child))
      await this.diffItem(item, newItem)
    })
    await Parallel.each(createdItems, async(item) => {
      this.diff.commit({type: actions.CREATE, payload: item})
    })
    await Parallel.each(removedItems, async(item) => {
      this.diff.commit({type: actions.REMOVE, payload: item})
    })
  }

  async diffBookmark(oldBookmark, newBookmark) {
    const hasChanged = await this.bookmarkHasChanged(oldBookmark, newBookmark)
    if (hasChanged) {
      this.diff.commit({ type: actions.UPDATE, payload: newBookmark, oldItem: oldBookmark })
    }
  }

  async bookmarkHasChanged(oldBookmark, newBookmark) {
    const oldHash = await oldBookmark.hash()
    const newHash = await newBookmark.hash()
    return oldHash !== newHash
  }

  async folderHasChanged(oldFolder, newFolder) {
    const oldHash = await oldFolder.hash(this.preserveOrder)
    const newHash = await newFolder.hash(this.preserveOrder)
    return oldHash !== newHash
  }

  async findMoves() {
    const createActions = this.diff.getActions().filter((action) => action.type === actions.CREATE)
    const removeActions = this.diff.getActions().filter(action => action.type === actions.REMOVE)

    await Parallel.each(createActions, async(createAction) => {
      const createdItem = createAction.payload
      await Parallel.each(removeActions, async(removeAction) => {
        const removedItem = removeAction.payload
        if (this.mergeable(removedItem, createdItem) && removedItem.type === createdItem.type) {
          this.diff.retract(createAction)
          this.diff.retract(removeAction)
          this.diff.commit({type: actions.MOVE, payload: createdItem, oldItem: removedItem})
          await this.diffItem(removedItem, createdItem)
          return
        }
        if (removedItem.type === 'folder') {
          const oldItem = removedItem.findItemFilter(createdItem.type, item => this.mergeable(item, createdItem))
          if (oldItem) {
            this.diff.retract(createAction)
            this.diff.commit({type: actions.MOVE, payload: createdItem, oldItem})
            await this.diffItem(oldItem, createdItem)
          }
        }
      })
    })
  }
}
