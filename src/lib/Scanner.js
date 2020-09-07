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

    // Preserved Items
    await Parallel.each(oldFolder.children, async old => {
      if (newFolder.children.some(
        newChild =>
          newChild.type === old.type &&
          this.mergeable(old, newChild)
      )) {
        const newItem = newFolder.children.find((child) => old.type === child.type && this.mergeable(old, child))
        await this.diffItem(old, newItem)
        return true
      }
    }, 1)

    // created Items
    // (using map here, because 'each' doesn't provide indices)
    await Parallel.map(newFolder.children, async(newChild, index) => {
      if (!oldFolder.children.some(old => old.type === newChild.type && this.mergeable(old, newChild))) {
        await this.diff.commit({type: actions.CREATE, payload: newChild, index})
      }
    }, 1)

    // removed Items
    // (using map here, because 'each' doesn't provide indices)
    await Parallel.map(oldFolder.children, async(old, index) => {
      if (!newFolder.children.some(newChild => newChild.type === old.type && this.mergeable(old, newChild))) {
        await this.diff.commit({type: actions.REMOVE, payload: old, index})
      }
    }, 1)

    if (newFolder.children.length > 1 || oldFolder.children.length > 1) {
      this.diff.commit({
        type: actions.REORDER,
        payload: newFolder,
        oldItem: oldFolder,
        order: newFolder.children.map(i => ({ type: i.type, id: i.id })),
        oldOrder: oldFolder.children.map(i => ({ type: i.type, id: i.id }))
      })
    }
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
    let createActions
    let removeActions
    let reconciliations = 1

    while (reconciliations > 0) {
      while (reconciliations > 0) {
        reconciliations = 0
        createActions = this.diff.getActions().filter((action) => action.type === actions.CREATE)
        removeActions = this.diff.getActions().filter(action => action.type === actions.REMOVE)

        await Parallel.each(createActions, async(createAction) => {
          const createdItem = createAction.payload
          await Parallel.each(removeActions, async(removeAction) => {
            const removedItem = removeAction.payload
            if (this.mergeable(removedItem, createdItem) && removedItem.type === createdItem.type) {
              this.diff.retract(createAction)
              this.diff.retract(removeAction)
              this.diff.commit({
                type: actions.MOVE,
                payload: createdItem,
                oldItem: removedItem,
                index: createAction.index,
                oldIndex: removeAction.index
              })
              reconciliations++
              await this.diffItem(removedItem, createdItem)
            }
          }, 1)
        }, 1)
      }

      reconciliations = 0
      createActions = this.diff.getActions().filter((action) => action.type === actions.CREATE)
      removeActions = this.diff.getActions().filter(action => action.type === actions.REMOVE)

      await Parallel.each(createActions, async(createAction) => {
        const createdItem = createAction.payload
        await Parallel.each(removeActions, async(removeAction) => {
          const removedItem = removeAction.payload
          if (removedItem.type === 'folder') {
            const oldItem = removedItem.findItemFilter(createdItem.type, item => this.mergeable(item, createdItem))
            if (oldItem) {
              this.diff.retract(createAction)
              this.diff.commit({ type: actions.MOVE, payload: createdItem, oldItem, index: createAction.index })
              reconciliations++
              await this.diffItem(oldItem, createdItem)
            }
          }
          if (createdItem.type === 'folder') {
            const newItem = createdItem.findItemFilter(removedItem.type, item => this.mergeable(removedItem, item))
            if (newItem) {
              this.diff.retract(removeAction)
              const newParent = createdItem.findItem('folder', newItem.parentId)
              newParent.children.splice(newParent.children.indexOf(newItem), 1)
              this.diff.commit({
                type: actions.MOVE,
                payload: newItem,
                oldItem: removedItem,
                index: createAction.index
              })
              reconciliations++
              await this.diffItem(removedItem, newItem)
            }
          }
        }, 1)
      }, 1)
    }
  }
}
