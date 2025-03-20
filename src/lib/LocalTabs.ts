import browser from './browser-api'
import Logger from './Logger'
import { OrderFolderResource } from './interfaces/Resource'
import PQueue from 'p-queue'
import { Bookmark, Folder, ItemLocation } from './Tree'
import Ordering from './interfaces/Ordering'
import uniq from 'lodash/uniq'

export default class LocalTabs implements OrderFolderResource<typeof ItemLocation.LOCAL> {
  private queue: PQueue<{ concurrency: 10 }>
  private storage: unknown

  constructor(storage:unknown) {
    this.storage = storage
    this.queue = new PQueue({ concurrency: 10 })
  }

  async getBookmarksTree():Promise<Folder<typeof ItemLocation.LOCAL>> {
    let tabs = await browser.tabs.query({
      windowType: 'normal' // no devtools or panels or popups
    })
    tabs = tabs.filter(tab => !tab.incognito)

    return new Folder({
      title: '',
      id: 'tabs',
      location: ItemLocation.LOCAL,
      children: uniq(tabs.map(t => t.windowId)).map((windowId, i) => {
        return new Folder({
          title: 'Window ' + i,
          id: windowId,
          parentId: 'tabs',
          location: ItemLocation.LOCAL,
          children: tabs
            .filter(t => t.windowId === windowId)
            .sort((t1,t2) => t1.index - t2.index)
            .map(t => new Bookmark({
              id: t.id,
              title: t.title,
              url: t.url,
              parentId: windowId,
              location: ItemLocation.LOCAL,
            }))
        })
      })
    })
  }

  async createBookmark(bookmark:Bookmark<typeof ItemLocation.LOCAL>): Promise<string|number> {
    Logger.log('(tabs)CREATE', bookmark)
    if (bookmark.parentId === 'tabs') {
      Logger.log('Parent is "tabs", ignoring this one.')
      return
    }
    if (self.location.protocol === 'moz-extension:' && new URL(bookmark.url).protocol === 'file:') {
      Logger.log('URL is a file URL and we are on firefox, ignoring this one.')
      return
    }
    const node = await this.queue.add(() =>
      browser.tabs.create({
        windowId: typeof bookmark.parentId === 'string' ? parseInt(bookmark.parentId) : bookmark.parentId,
        url: bookmark.url,
        // Only firefox allows discarded prop
        ...(typeof browser.BookmarkTreeNodeType !== 'undefined' && { discarded: true }),
        active: false,
      })
    )
    await awaitTabsUpdated()
    return node.id
  }

  async updateBookmark(bookmark:Bookmark<typeof ItemLocation.LOCAL>):Promise<void> {
    Logger.log('(tabs)UPDATE', bookmark)
    if (bookmark.parentId === 'tabs') {
      Logger.log('Parent is "tabs", ignoring this one.')
      return
    }
    await this.queue.add(() =>
      browser.tabs.update(bookmark.id, {
        url: bookmark.url
      })
    )
    await this.queue.add(() =>
      browser.tabs.move(bookmark.id, {
        windowId: bookmark.parentId,
        index: -1 // last
      })
    )
    await awaitTabsUpdated()
  }

  async removeBookmark(bookmark:Bookmark<typeof ItemLocation.LOCAL>): Promise<void> {
    const bookmarkId = bookmark.id
    Logger.log('(tabs)REMOVE', bookmark)
    if (bookmark.parentId === 'tabs') {
      Logger.log('Parent is "tabs", ignoring this one.')
      return
    }
    await this.queue.add(() => browser.tabs.remove(bookmarkId))
    await awaitTabsUpdated()
  }

  async createFolder(folder:Folder<typeof ItemLocation.LOCAL>): Promise<number> {
    Logger.log('(tabs)CREATEFOLDER', folder)
    const node = await this.queue.add(() =>
      browser.windows.create()
    )
    return node.id
  }

  async orderFolder(id:string|number, order:Ordering<typeof ItemLocation.LOCAL>):Promise<void> {
    Logger.log('(tabs)ORDERFOLDER', { id, order })
    const originalTabs = await browser.tabs.query({
      windowId: id
    })
    try {
      for (let index = 0; index < order.length; index++) {
        await browser.tabs.move(order[index].id, { index })
      }
    } catch (e) {
      throw new Error('Failed to reorder folder ' + id + ': ' + e.message)
    }
    // Move items not touched by sync back to where they were
    // Not perfect but good enough (Problem: [a,X,c] => insert(b,0) => [b, X, a, c])
    if (originalTabs.length !== order.length) {
      const untouchedChildren = originalTabs.map((tab, i) => [i, tab]).filter(([, tab]) =>
        !order.some(item => String(tab.id) === String(item.id))
      )
      try {
        for (const [index, child] of untouchedChildren) {
          await browser.tabs.move(child.id, {index})
        }
      } catch (e) {
        throw new Error('Failed to reorder folder ' + id + ': ' + e.message)
      }
    }
    await awaitTabsUpdated()
  }

  async updateFolder(folder:Folder<typeof ItemLocation.LOCAL>):Promise<void> {
    Logger.log('(tabs)UPDATEFOLDER (noop)', folder)
  }

  async removeFolder(folder:Folder<typeof ItemLocation.LOCAL>):Promise<void> {
    const id = folder.id
    Logger.log('(tabs)REMOVEFOLDER', id)
    await this.queue.add(() => browser.window.remove(id))
  }

  async isAvailable(): Promise<boolean> {
    const tabs = await browser.tabs.query({
      windowType: 'normal' // no devtools or panels or popups
    })
    return Boolean(tabs.length)
  }
}

function awaitTabsUpdated() {
  return Promise.race([
    new Promise<void>(resolve => {
      browser.tabs.onUpdated.addListener(function listener() {
        browser.tabs.onUpdated.removeListener(listener)
        setTimeout(() => resolve(), 100)
      })
    }),
    new Promise(resolve => setTimeout(resolve, 300))
  ])
}
