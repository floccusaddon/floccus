import browser from '../browser-api'
import Logger from '../Logger'
import * as Tree from '../Tree'
import { IResource } from '../interfaces/Resource'
import PQueue from 'p-queue'
import Account from '../Account'
import { Bookmark, Folder, ItemLocation, ItemType } from '../Tree'
import Ordering from '../interfaces/Ordering'
import url from 'url'
import random from 'random'
import seedrandom from 'seedrandom'

let absoluteRoot: {id: string}

export default class BrowserTree implements IResource {
  private readonly rootId: string
  private queue: PQueue<{ concurrency: 10 }>
  private storage: unknown
  private absoluteRoot: { id: string }
  private absoluteRootPromise: Promise<void>

  constructor(storage:unknown, rootId:string) {
    this.rootId = rootId
    this.storage = storage
    this.queue = new PQueue({ concurrency: 10 })
    this.absoluteRootPromise = BrowserTree.getAbsoluteRootFolder().then(root => {
      this.absoluteRoot = root
    })
  }

  async getBookmarksTree():Promise<Folder> {
    const [tree] = await browser.bookmarks.getSubTree(this.rootId)
    await this.absoluteRootPromise
    const allAccounts = await (await Account.getAccountClass()).getAllAccounts()

    const recurse = (node, parentId?, rng?) => {
      if (
        allAccounts.some(
          acc => acc.getData().localRoot === node.id && node.id !== this.rootId && !acc.getData().nestedSync
        )
      ) {
        // This is the root folder of a different account and the user doesn't want nested sync
        return
      }
      let overrideTitle, isRoot
      if (node.parentId === this.absoluteRoot.id) {
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
          case 'mobile______': // Firefox
            overrideTitle = 'Mobile Bookmarks'
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
      if (node.id === this.absoluteRoot.id) {
        isRoot = true
      }
      if (node.children) {
        // seeded pseudo random number generator for separator IDs
        // We use this because we want IDs that are (largely) collision-free even
        // between folders and still consistent across browsers
        const rng = random.clone(seedrandom(node.title))
        const folder = new Tree.Folder({
          location: ItemLocation.LOCAL,
          id: node.id,
          parentId,
          title: parentId ? overrideTitle || node.title : undefined,
          children: node.children
            .map((child) => {
              return recurse(child, node.id, rng)
            })
            .filter(child => !!child) // filter out `undefined` from nested accounts
        })
        folder.isRoot = isRoot
        return folder
      } else if (window.location.protocol === 'moz-extension:' && node.type === 'separator') {
        // Translate mozilla separators to floccus separators
        return new Tree.Bookmark({
          location: ItemLocation.LOCAL,
          id: node.id,
          parentId,
          title: '-----',
          // If you have more than a quarter million separators in one folder, call me
          // Floccus breaks down much earlier atm
          url: `https://separator.floccus.org/?id=${rng.int(0,1000000)}`,
        })
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
    if (bookmark.parentId === this.absoluteRoot.id) {
      Logger.log('This action affects the absolute root. Skipping.')
      return
    }
    try {
      if (window.location.protocol === 'moz-extension:' && url.parse(bookmark.url).hostname === 'separator.floccus.org') {
        const node = await this.queue.add(() =>
          browser.bookmarks.create({
            parentId: bookmark.parentId,
            type: 'separator'
          })
        )
        return node.id
      }
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
    if (bookmark.parentId === this.absoluteRoot.id) {
      Logger.log('This action affects the absolute root. Skipping.')
      return
    }
    try {
      if (window.location.protocol === 'moz-extension:' && url.parse(bookmark.url).hostname === 'separator.floccus.org') {
        // noop
      } else {
        await this.queue.add(() =>
          browser.bookmarks.update(bookmark.id, {
            title: bookmark.title,
            url: bookmark.url
          })
        )
      }
      await this.queue.add(() =>
        browser.bookmarks.move(bookmark.id, {
          parentId: bookmark.parentId
        })
      )
    } catch (e) {
      throw new Error('Could not update ' + bookmark.inspect() + ': ' + e.message)
    }
  }

  async removeBookmark(bookmark:Bookmark): Promise<void> {
    if (bookmark.parentId === this.absoluteRoot.id) {
      Logger.log('This action affects the absolute root. Skipping.')
      return
    }
    const bookmarkId = bookmark.id
    Logger.log('(local)REMOVE', bookmark)
    try {
      await this.queue.add(() => browser.bookmarks.remove(bookmarkId))
    } catch (e) {
      Logger.log('Could not remove ' + bookmark.inspect() + ': ' + e.message + '\n Moving on')
    }
  }

  async createFolder(folder:Folder): Promise<string> {
    const {parentId, title} = folder
    Logger.log('(local)CREATEFOLDER', folder)
    if (folder.parentId === this.absoluteRoot.id) {
      Logger.log('This action affects the absolute root. Skipping.')
      return
    }
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
    if (id === this.absoluteRoot.id) {
      Logger.log('This action affects the absolute root. Skipping.')
      return
    }
    const [realTree] = await browser.bookmarks.getSubTree(id)
    try {
      for (let index = 0; index < order.length; index++) {
        await browser.bookmarks.move(order[index].id, { index })
      }
    } catch (e) {
      throw new Error('Failed to reorder folder ' + id + ': ' + e.message)
    }
    // Move items not touched by sync back to where they were
    // Not perfect but good enough (Problem: [a,X,c] => insert(b,0) => [b, X, a, c])
    if (realTree.children.length !== order.length) {
      const untouchedChildren = realTree.children.map((child,i) => [i, child]).filter(([, child]) =>
        child.url
          ? !order.some(item => item.type === ItemType.BOOKMARK && item.id === child.id)
          : !order.some(item => item.type === ItemType.FOLDER && item.id === child.id)
      )
      try {
        Logger.log('Move untouched children back into place', {untouchedChildren: untouchedChildren.map(([i, item]) => [i, item.id])})
        for (const [index, child] of untouchedChildren) {
          await browser.bookmarks.move(child.id, {index})
        }
      } catch (e) {
        throw new Error('Failed to reorder folder ' + id + ': ' + e.message)
      }
    }
  }

  async updateFolder(folder:Folder):Promise<void> {
    const {id, title, parentId} = folder
    Logger.log('(local)UPDATEFOLDER', folder)
    if (folder.parentId === this.absoluteRoot.id) {
      Logger.log('This action affects the absolute root. Skipping.')
      return
    }
    if (folder.isRoot) {
      Logger.log('This is a root folder. Skip.')
      return
    }
    try {
      await this.queue.add(() =>
        browser.bookmarks.update(id, {
          title
        })
      )
    } catch (e) {
      throw new Error('Failed to rename folder ' + id + ': ' + e.message)
    }
    const oldFolder = (await browser.bookmarks.getSubTree(id))[0]
    if (Folder.hydrate(oldFolder).findFolder(parentId)) {
      throw new Error('Detected creation of folder loop. Moving ' + id + ' into its descendant ' + parentId)
    }
    try {
      await this.queue.add(() => browser.bookmarks.move(id, { parentId }))
    } catch (e) {
      throw new Error('Failed to move folder ' + id + ': ' + e.message)
    }
  }

  async removeFolder(folder:Folder):Promise<void> {
    const id = folder.id
    Logger.log('(local)REMOVEFOLDER', id)
    if (folder.parentId === this.absoluteRoot.id) {
      Logger.log('This action affects the absolute root. Skipping.')
      return
    }
    if (folder.isRoot) {
      Logger.log('This is a root folder. Skip.')
      return
    }
    try {
      await this.queue.add(() => browser.bookmarks.removeTree(id))
    } catch (e) {
      Logger.log('Could not remove ' + folder.inspect() + ': ' + e.message + '\n Moving on.')
    }
  }

  static async getPathFromLocalId(localId:string, ancestors?:string[], relativeToRoot?:string):Promise<string> {
    if (localId === 'tabs') {
      return browser.i18n.getMessage('LabelTabs')
    }
    try {
      ancestors = ancestors || (await BrowserTree.getIdPathFromLocalId(localId))

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
    if (typeof localId === 'undefined') {
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
    if (!absoluteRoot) {
      absoluteRoot = (await browser.bookmarks.getTree())[0]
    }
    return absoluteRoot
  }
}
