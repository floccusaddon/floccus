import browser from './browser-api'
import Logger from './Logger'
import * as Tree from './Tree'
import { IResource } from './interfaces/Resource'
import PQueue from 'p-queue'
import Account from './Account'
import { Bookmark, Folder, ItemLocation } from './Tree'
import Ordering from './interfaces/Ordering'

export default class LocalTree implements IResource {
  private readonly rootId: string
  private queue: PQueue<{ concurrency: 10 }>
  private storage: unknown

  constructor(storage:unknown, rootId:string) {
    this.rootId = rootId
    this.storage = storage
    this.queue = new PQueue({ concurrency: 10 })
  }

  async getBookmarksTree():Promise<Folder> {
    const [rootTree] = await browser.bookmarks.getTree() // XXX: Kinda inefficient, but well.
    const [tree] = await browser.bookmarks.getSubTree(this.rootId)
    const allAccounts = await Account.getAllAccounts()

    const recurse = (node, parentId?) => {
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
        const folder = new Tree.Folder({
          location: ItemLocation.LOCAL,
          id: node.id,
          parentId,
          title: parentId ? overrideTitle || node.title : undefined,
          children: node.children
            .map(child => recurse(child, node.id))
            .filter(child => !!child) // filter out `undefined` from nested accounts
        })
        folder.isRoot = isRoot
        return folder
      } else {
        return new Tree.Bookmark({
          location: ItemLocation.LOCAL,
          id: node.id,
          parentId,
          title: node.title,
          url: node.url
        })
      }
    }
    return recurse(tree) as Folder
  }

  async createBookmark(bookmark:Bookmark): Promise<string|number> {
    Logger.log('(local)CREATE', bookmark)
    try {
      const node = await this.queue.add(() =>
        browser.bookmarks.create({
          parentId: bookmark.parentId,
          title: bookmark.title,
          url: bookmark.url
        })
      )
      return node.id
    } catch (e) {
      throw new Error('Could not create ' + bookmark.inspect() + ': ' + e.message)
    }
  }

  async updateBookmark(bookmark:Bookmark):Promise<void> {
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

  async removeBookmark(bookmark:Bookmark): Promise<void> {
    const bookmarkId = bookmark.id
    Logger.log('(local)REMOVE', bookmark)
    try {
      await this.queue.add(() => browser.bookmarks.remove(bookmarkId))
    } catch (e) {
      throw new Error('Could not remove ' + bookmark.inspect() + ': ' + e.message)
    }
  }

  async createFolder(folder:Folder): Promise<string> {
    const {parentId, title} = folder
    Logger.log('(local)CREATEFOLDER', folder)
    try {
      const node = await this.queue.add(() =>
        browser.bookmarks.create({
          parentId,
          title
        })
      )
      return node.id
    } catch (e) {
      throw new Error('Could not create ' + folder.inspect() + ': ' + e.message)
    }
  }

  async orderFolder(id:string|number, order:Ordering) :Promise<void> {
    Logger.log('(local)ORDERFOLDER', { id, order })
    for (let index = 0; index < order.length; index++) {
      await browser.bookmarks.move(order[index].id, { index })
    }
  }

  async updateFolder(folder:Folder):Promise<void> {
    const {id, title, parentId} = folder
    Logger.log('(local)UPDATEFOLDER', folder)
    if (folder.isRoot) {
      Logger.log('This is a root folder. Skip.')
      return
    }
    await this.queue.add(() =>
      browser.bookmarks.update(id, {
        title
      })
    )
    const oldFolder = (await browser.bookmarks.getSubTree(id))[0]
    if (Folder.hydrate(oldFolder).findFolder(parentId)) {
      throw new Error('Detected creation of folder loop. Moving ' + id + ' into its descendant ' + parentId)
    }
    await this.queue.add(() => browser.bookmarks.move(id, { parentId }))
  }

  async removeFolder(folder:Folder):Promise<void> {
    const id = folder.id
    Logger.log('(local)REMOVEFOLDER', id)
    if (folder.isRoot) {
      Logger.log('This is a root folder. Skip.')
      return
    }
    try {
      await this.queue.add(() => browser.bookmarks.removeTree(id))
    } catch (e) {
      throw new Error('Could not remove ' + folder.inspect() + ': ' + e.message)
    }
  }

  static async getPathFromLocalId(localId:string, ancestors:string[], relativeToRoot?:string):Promise<string> {
    if (localId === 'tabs') {
      return browser.i18n.getMessage('LabelTabs')
    }
    try {
      ancestors = ancestors || (await LocalTree.getIdPathFromLocalId(localId))

      if (relativeToRoot) {
        ancestors = ancestors.slice(ancestors.indexOf(relativeToRoot) + 1)
      }

      return (
        await Promise.all(
          ancestors.map(async ancestor => {
            try {
              const bms = await browser.bookmarks.get(ancestor)
              const bm = bms[0]
              return bm.title.replace(/[/]/g, '\\/')
            } catch (e) {
              return 'Error!'
            }
          })
        )
      ).join('/')
    } catch (e) {
      return browser.i18n.getMessage('LabelFolderNotFound')
    }
  }

  static async getIdPathFromLocalId(localId:string|null, path:string[] = []):Promise<string[]> {
    if (!localId) {
      return path
    }
    path.unshift(localId)
    const bms = await browser.bookmarks.get(localId)
    const bm = bms[0]
    if (bm.parentId === localId) {
      return path // might be that the root is circular
    }
    return this.getIdPathFromLocalId(bm.parentId, path)
  }

  static async getAbsoluteRootFolder() {
    return (await browser.bookmarks.getTree())[0]
  }
}
