import browser from './browser-api'
import Logger from './Logger'
import * as Tree from './Tree'
import Resource from './interfaces/Resource'
import PQueue from 'p-queue'
import Account from './Account'

export default class LocalTree extends Resource {
  constructor(storage, rootId) {
    super()
    this.rootId = rootId
    this.storage = storage
    this.queue = new PQueue({ concurrency: 10 })
  }

  async getBookmarksTree() {
    const [rootTree] = await browser.bookmarks.getTree() // XXX: Kinda inefficient, but well.
    const tree = (await browser.bookmarks.getSubTree(this.rootId))[0]
    const allAccounts = await Account.getAllAccounts()

    const recurse = (node, parentId) => {
      if (
        allAccounts.some(
          acc => acc.getData().localRoot === node.id && node.id !== this.rootId && !acc.getData().nestedSync
        )
      ) {
        // This is the root folder of a different account and the user doesn't want nested sync
        return
      }
      let overrideTitle, isRoot
      if (node.parentId === rootTree.id) {
        switch (node.id) {
          case '1': // Chrome
          case 'toolbar_____': // Firefox
            overrideTitle = 'Bookmarks Bar'
            break
          case '2': // Chrome
          case 'unfiled_____': // Firefox
            overrideTitle = 'Other Bookmarks'
            break
          case 'menu________': // Firefox
            overrideTitle = 'Bookmarks Menu'
            break
        }
        if (overrideTitle) {
          Logger.log(
            'Overriding title of built-in node',
            node.id,
            node.title,
            '=>',
            overrideTitle
          )
        }
      }
      if (node.id === rootTree.id) {
        isRoot = true
      }
      if (node.children) {
        let folder = new Tree.Folder({
          id: node.id,
          parentId,
          title: parentId ? overrideTitle || node.title : undefined,
          dateGroupModified: node.dateGroupModified,
          children: node.children
            .map(child => recurse(child, node.id))
            .filter(child => !!child) // filter out `undefined` from nested accounts
        })
        folder.isRoot = isRoot
        return folder
      } else {
        return new Tree.Bookmark({
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
    Logger.log('(local)CREATE', bookmark)
    const node = await this.queue.add(() =>
      browser.bookmarks.create({
        parentId: bookmark.parentId,
        title: bookmark.title,
        url: bookmark.url
      })
    )
    return node.id
  }

  async updateBookmark(bookmark) {
    Logger.log('(local)UPDATE', bookmark)
    await this.queue.add(() =>
      browser.bookmarks.update(bookmark.id, {
        title: bookmark.title,
        url: bookmark.url
      })
    )
    await this.queue.add(() =>
      browser.bookmarks.move(bookmark.id, {
        parentId: bookmark.parentId
      })
    )
  }

  async removeBookmark(bookmarkId) {
    Logger.log('(local)REMOVE', bookmarkId)
    await this.queue.add(() => browser.bookmarks.remove(bookmarkId))
  }

  async createFolder(parentId, title) {
    Logger.log('(local)CREATEFOLDER', title)
    const node = await this.queue.add(() =>
      browser.bookmarks.create({
        parentId,
        title
      })
    )
    return node.id
  }

  async orderFolder(id, order) {
    Logger.log('(local)ORDERFOLDER', { id, order })
    for (let index = 0; index < order.length; index++) {
      await browser.bookmarks.move(order[index].id, { index })
    }
  }

  async updateFolder(id, title) {
    Logger.log('(local)UPDATEFOLDER', title)
    await this.queue.add(() =>
      browser.bookmarks.update(id, {
        title
      })
    )
  }

  async moveFolder(id, parentId) {
    Logger.log('(local)MOVEFOLDER', { id, parentId })
    await this.queue.add(() => browser.bookmarks.move(id, { parentId }))
  }

  async removeFolder(id, force) {
    Logger.log('(local)REMOVEFOLDER', id)
    let [tree] = await browser.bookmarks.getSubTree(id)
    if (tree.children.length && !force) {
      Logger.log("Won't remove non-empty folder. Moving on.")
      return
    }
    await this.queue.add(() => browser.bookmarks.removeTree(id))
  }

  static async getPathFromLocalId(localId, ancestors, relativeToRoot) {
    ancestors = ancestors || (await LocalTree.getIdPathFromLocalId(localId))

    if (relativeToRoot) {
      ancestors = ancestors.slice(ancestors.indexOf(relativeToRoot) + 1)
    }

    return (
      await Promise.all(
        ancestors.map(async ancestor => {
          try {
            let bms = await browser.bookmarks.get(ancestor)
            let bm = bms[0]
            return bm.title.replace(/[/]/g, '\\/')
          } catch (e) {
            return 'Error!'
          }
        })
      )
    ).join('/')
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
