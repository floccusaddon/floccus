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
    let reconciled = true

    // As soon as one match is found, action list is updated and search is started with the new list
    // repeat until no rewrites happen anymore
    while (reconciled) {
      reconciled = false
      let createAction, removeAction

      // First find direct matches (avoids glitches when folders and their contents have been moved)
      createActions = this.diff.getActions().filter((action) => action.type === actions.CREATE)
      while (!reconciled && (createAction = createActions.shift())) {
        const createdItem = createAction.payload
        removeActions = this.diff.getActions().filter(action => action.type === actions.REMOVE)
        while (!reconciled && (removeAction = removeActions.shift())) {
          const removedItem = removeAction.payload
          if (this.mergeable(removedItem, createdItem)) {
            this.diff.retract(createAction)
            this.diff.retract(removeAction)
            this.diff.commit({
              type: actions.MOVE,
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
      createActions = this.diff.getActions().filter((action) => action.type === actions.CREATE)
      while (!reconciled && (createAction = createActions.shift())) {
        const createdItem = createAction.payload
        removeActions = this.diff.getActions().filter(action => action.type === actions.REMOVE)
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
              type: actions.MOVE,
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
                type: actions.MOVE,
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
