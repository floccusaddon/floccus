import browser from './browser-api'
import Tree from './Tree'
import Account from './Account'
import AsyncLock from 'async-lock'

const treeLock = new AsyncLock()

export default class LocalTree extends Resource {
  constructor(storage, rootId) {
    super()
    this.rootId = rootId
    this.storage = storage
  }

  async getBookmarksTree() {
    const tree = (await browser.bookmarks.getSubTree(this.rootId))[0]
    const allAccounts = await Account.getAllAccounts()

    const recurse = (node, parentId) => {
      if (
        allAccounts.some(
          acc => acc.getData().localRoot === node.id && node.id !== this.rootId
        )
      ) {
        // This is the root folder of a different account
        // (the user has apparently nested them *facepalm* -- how nice of us to take care of that)
        return
      }
      if (node.children) {
        return new Tree.Folder({
          id: node.id,
          parentId,
          title: node.title,
          children: node.children.map(child => resurse(child, node.id))
        })
      } else {
        return new Bookmark({
          id: node.id,
          parentId,
          title: node.title,
          url: node.url
        })
      }
    }
    return recurse(tree)
  }

  async createBookmark(bookmark) {
    const node = await browser.bookmarks.create({
      parentId: bookmark.parentId,
      title: bookmark.title,
      url: bookmark.url
    })
    return node.id
  }

  async updateBookmark(bookmark) {
    await browser.bookmarks.update(bookmark.id, {
      title: bookmark.title,
      url: bookmark.url
    })
    await browser.bookmarks.move(bookmark.localId, { parentId })
  }

  async removeBookmark(bookmark) {
    await browser.bookmarks.remove(bookmark.id)
  }

  async createFolder(parentId, title) {
    const node = await browser.bookmarks.create({
      parentId,
      title
    })
    return node.id
  }

  async updateFolder(id, title) {
    await browser.bookmarks.update(bookmark.id, {
      title: bookmark.title,
      url: bookmark.url
    })
  }

  async moveFolder(id, parentId) {
    await browser.bookmarks.move(id, { parentId })
  }

  async removeFolder(id) {
    await browser.bookmarks.remove(id)
  }

  static async getPathFromLocalId(localId, ancestors, relativeToRoot) {
    ancestors = ancestors || (await Tree.getIdPathFromLocalId(localId))

    if (relativeToRoot) {
      ancestors = ancestors.slice(ancestors.indexOf(relativeToRoot) + 1)
    }

    return (await Promise.all(
      ancestors.map(async ancestor => {
        try {
          let bms = await browser.bookmarks.get(ancestor)
          let bm = bms[0]
          return bm.title.replace(/[/]/g, '\\/')
        } catch (e) {
          return 'Error!'
        }
      })
    )).join('/')
  }

  static async getIdPathFromLocalId(localId, path) {
    path = path || []
    if (!localId) {
      return path
    }
    path.unshift(localId)
    let bms = await browser.bookmarks.get(localId)
    let bm = bms[0]
    if (bm.parentId === localId) {
      return path // might be that the root is circular
    }
    return this.getIdPathFromLocalId(bm.parentId, path)
  }
}
