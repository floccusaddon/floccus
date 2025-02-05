import browser from '../browser-api'
import Logger from '../Logger'
import * as Tree from '../Tree'
import { IResource } from '../interfaces/Resource'
import PQueue from 'p-queue'
import Account from '../Account'
import { Bookmark, Folder, ItemLocation, ItemType } from '../Tree'
import Ordering from '../interfaces/Ordering'
import random from 'random'
import seedrandom from 'seedrandom'
import { isVivaldi } from './BrowserDetection'
import { LocalFolderNotFoundError } from '../../errors/Error'

let absoluteRoot: {id: string}

export default class BrowserTree implements IResource<typeof ItemLocation.LOCAL> {
  private readonly rootId: string
  private queue: PQueue<{ concurrency: 10 }>
  private storage: unknown
  private absoluteRoot: { id: string }
  private absoluteRootPromise: Promise<void>

  static readonly TITLE_BOOKMARKS_BAR: string = 'Bookmarks Bar'
  static readonly TITLE_OTHER_BOOKMARKS: string = 'Other Bookmarks'
  static readonly TITLE_BOOKMARKS_MENU: string = 'Bookmarks Menu'
  static readonly TITLE_MOBILE_BOOKMARKS: string = 'Mobile Bookmarks'
  static readonly TITLE_SEPARATOR_HORZ: string = '⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯'
  static readonly TITLE_SEPARATOR_VERT: string = ''

  constructor(storage:unknown, rootId:string) {
    this.rootId = rootId
    this.storage = storage
    this.queue = new PQueue({ concurrency: 10 })
    this.absoluteRootPromise = BrowserTree.getAbsoluteRootFolder().then(root => {
      this.absoluteRoot = root
    })
  }

  async getBookmarksTree():Promise<Folder<typeof ItemLocation.LOCAL>> {
    const isVivaldiBrowser = await isVivaldi()
    let tree
    try {
      [tree] = await browser.bookmarks.getSubTree(this.rootId)
    } catch (e) {
      throw new LocalFolderNotFoundError()
    }
    await this.absoluteRootPromise
    const allAccounts = await (await Account.getAccountClass()).getAllAccounts()

    const recurse = (node, parentId?, isOnToolbar?, rng?) => {
      
      if (
        allAccounts.some(
          acc => acc.getData().localRoot === node.id && String(node.id) !== String(this.rootId) && !acc.getData().nestedSync
        )
      ) {
        // This is the root folder of a different account and the user doesn't want nested sync
        return
      }
      let overrideTitle, isRoot, isToolbar
      if (node.parentId === this.absoluteRoot.id && !isVivaldiBrowser) {
        switch (node.id) {
          case '1': // Chrome
          case 'toolbar_____': // Firefox
            overrideTitle = BrowserTree.TITLE_BOOKMARKS_BAR
            isToolbar = true
            break
          case '2': // Chrome
          case 'unfiled_____': // Firefox
            overrideTitle = BrowserTree.TITLE_OTHER_BOOKMARKS
            break
          case 'menu________': // Firefox
            overrideTitle = BrowserTree.TITLE_BOOKMARKS_MENU
            break
          case 'mobile______': // Firefox
            overrideTitle = BrowserTree.TITLE_MOBILE_BOOKMARKS
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
              return recurse(child, node.id, isToolbar, rng)
            })
            .filter(child => !!child) // filter out `undefined` from nested accounts
        })
        folder.isRoot = isRoot
        return folder
      } else if (self.location.protocol === 'moz-extension:' && node.type === 'separator') {
        // Translate mozilla separators to floccus separators
        return new Tree.Bookmark({
          location: ItemLocation.LOCAL,
          id: node.id,
          parentId,
          title: isOnToolbar ? BrowserTree.TITLE_SEPARATOR_VERT : BrowserTree.TITLE_SEPARATOR_HORZ,
          // If you have more than a quarter million separators in one folder, call me
          // Floccus breaks down much earlier atm
          url: 'https://separator.floccus.org/' +
               (isOnToolbar ? 'vertical.html' : '') +
               `?id=${rng.int(0,1000000)}`,
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
    return recurse(tree) as Folder<typeof ItemLocation.LOCAL>
  }

  async createBookmark(bookmark:Bookmark<typeof ItemLocation.LOCAL>): Promise<string|number> {
    Logger.log('(local)CREATE', bookmark)
    if (bookmark.parentId === this.absoluteRoot.id) {
      Logger.log('This action affects the absolute root. Skipping.')
      return
    }
    try {
      if (self.location.protocol === 'moz-extension:' && new URL(bookmark.url).hostname === 'separator.floccus.org') {
        const node = await this.queue.add(async() => {
          Logger.log('(local)CREATE: executing create ', bookmark)
          return browser.bookmarks.create({
            parentId: bookmark.parentId.toString(),
            type: 'separator'
          })
        })
        return node.id
      }
      const node = await this.queue.add(async() => {
        Logger.log('(local)CREATE: executing create ', bookmark)
        return browser.bookmarks.create({
          parentId: bookmark.parentId.toString(),
          title: bookmark.title,
          url: bookmark.url
        })
      })
      return node.id
    } catch (e) {
      throw new Error('Could not create ' + bookmark.inspect() + ': ' + e.message)
    }
  }

  async updateBookmark(bookmark:Bookmark<typeof ItemLocation.LOCAL>):Promise<void> {
    Logger.log('(local)UPDATE', bookmark)
    if (bookmark.parentId === this.absoluteRoot.id) {
      Logger.log('This action affects the absolute root. Skipping.')
      return
    }
    try {
      if (self.location.protocol === 'moz-extension:' && new URL(bookmark.url).hostname === 'separator.floccus.org') {
        // noop
      } else {
        await this.queue.add(async() => {
          Logger.log('(local)UPDATE: executing update ', bookmark)
          return browser.bookmarks.update(bookmark.id, {
            title: bookmark.title,
            url: bookmark.url
          })
        })
      }
      await this.queue.add(async() => {
        Logger.log('(local)UPDATE: executing move ', bookmark)
        return browser.bookmarks.move(bookmark.id, {
          parentId: bookmark.parentId.toString()
        })
      })
    } catch (e) {
      throw new Error('Could not update ' + bookmark.inspect() + ': ' + e.message)
    }
  }

  async removeBookmark(bookmark:Bookmark<typeof ItemLocation.LOCAL>): Promise<void> {
    if (bookmark.parentId === this.absoluteRoot.id) {
      Logger.log('This action affects the absolute root. Skipping.')
      return
    }
    const bookmarkId = bookmark.id
    Logger.log('(local)REMOVE', bookmark)
    try {
      await this.queue.add(async() => {
        Logger.log('(local)REMOVE: executing remove ', bookmark)
        return browser.bookmarks.remove(bookmarkId)
      })
    } catch (e) {
      Logger.log('Could not remove ' + bookmark.inspect() + ': ' + e.message + '\n Moving on')
    }
  }

  async createFolder(folder:Folder<typeof ItemLocation.LOCAL>): Promise<string> {
    const {parentId, title} = folder
    Logger.log('(local)CREATEFOLDER', folder)
    if (folder.parentId === this.absoluteRoot.id) {
      Logger.log('This action affects the absolute root. Skipping.')
      return
    }
    try {
      const node = await this.queue.add(async() => {
        Logger.log('(local)CREATEFOLDER: executing create ', folder)
        return browser.bookmarks.create({
          parentId: parentId.toString(),
          title
        })
      })
      return node.id
    } catch (e) {
      throw new Error('Could not create ' + folder.inspect() + ': ' + e.message)
    }
  }

  async orderFolder(id:string|number, order:Ordering<typeof ItemLocation.LOCAL>) :Promise<void> {
    Logger.log('(local)ORDERFOLDER', { id, order })
    if (id === this.absoluteRoot.id) {
      Logger.log('This action affects the absolute root. Skipping.')
      return
    }
    const [realTree] = await browser.bookmarks.getSubTree(id)
    try {
      for (let index = 0; index < order.length; index++) {
        await browser.bookmarks.move(order[index].id, { parentId: id.toString(), index })
      }
    } catch (e) {
      throw new Error('Failed to reorder folder ' + id + ': ' + e.message)
    }
    // Move items not touched by sync back to where they were
    // Not perfect but good enough (Problem: [a,X,c] => insert(b,0) => [b, X, a, c])
    if (realTree.children.length !== order.length) {
      const untouchedChildren = realTree.children.map((child,i) => [i, child]).filter(([, child]) =>
        child.url
          ? !order.some(item => item.type === ItemType.BOOKMARK && String(item.id) === String(child.id))
          : !order.some(item => item.type === ItemType.FOLDER && String(item.id) === String(child.id))
      )
      try {
        Logger.log('Move untouched children back into place', {untouchedChildren: untouchedChildren.map(([i, item]) => [i, item.id])})
        for (const [index, child] of untouchedChildren) {
          await browser.bookmarks.move(child.id, { parentId: id.toString(), index})
        }
      } catch (e) {
        throw new Error('Failed to reorder folder ' + id + ': ' + e.message)
      }
    }
  }

  async updateFolder(folder:Folder<typeof ItemLocation.LOCAL>):Promise<void> {
    const {id, title, parentId} = folder
    Logger.log('(local)UPDATEFOLDER', folder)
    if (folder.parentId === this.absoluteRoot.id) {
      Logger.log('This action affects a root folder. Skipping.')
      return
    }
    if (folder.isRoot) {
      Logger.log('This is the absolute root folder. Skip.')
      return
    }
    try {
      await this.queue.add(async() => {
        Logger.log('(local)UPDATEFOLDER: executing update ', folder)
        return browser.bookmarks.update(id.toString(), {
          title
        })
      })
    } catch (e) {
      throw new Error('Failed to rename folder ' + id + ': ' + e.message)
    }
    const oldFolder = (await browser.bookmarks.getSubTree(id))[0]
    if (Folder.hydrate(oldFolder).findFolder(parentId)) {
      throw new Error('Detected creation of folder loop. Moving ' + id + ' into its descendant ' + parentId)
    }
    try {
      await this.queue.add(async() => {
        Logger.log('(local)CREATEFOLDER: executing move ', folder)
        return browser.bookmarks.move(id.toString(), { parentId })
      })
    } catch (e) {
      throw new Error('Failed to move folder ' + id + ': ' + e.message)
    }
  }

  async removeFolder(folder:Folder<typeof ItemLocation.LOCAL>):Promise<void> {
    const id = folder.id
    Logger.log('(local)REMOVEFOLDER', id)
    if (folder.parentId === this.absoluteRoot.id) {
      Logger.log('This action affects a root folder. Skipping.')
      return
    }
    if (folder.isRoot) {
      Logger.log('This is the root folder. Skip.')
      return
    }
    try {
      await this.queue.add(async() => {
        Logger.log('(local)REMOVEFOLDER: executing remove ', folder)
        return browser.bookmarks.removeTree(id.toString())
      })
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
      try {
        // chromium
        absoluteRoot = (await browser.bookmarks.get('0'))[0]
      } catch (e) {
        try {
          // firefox
          absoluteRoot = (await browser.bookmarks.get('root________'))[0]
        } catch (e) {
          // any other browser
          absoluteRoot = (await browser.bookmarks.getTree())[0]
          // eslint-disable-next-line @typescript-eslint/ban-ts-comment
          // @ts-ignore
          delete absoluteRoot.children
        }
      }
    }
    return absoluteRoot
  }

  isAvailable(): Promise<boolean> {
    return Promise.resolve(true)
  }
}
