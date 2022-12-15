import browser from './browser-api'
import Logger from './Logger'
import { IResource } from './interfaces/Resource'
import PQueue from 'p-queue'
import { Bookmark, Folder, ItemLocation } from './Tree'
import Ordering from './interfaces/Ordering'
import uniq from 'lodash/uniq'

export default class LocalTabs implements IResource {
  private queue: PQueue<{ concurrency: 10 }>
  private storage: unknown

  constructor(storage:unknown) {
    this.storage = storage
    this.queue = new PQueue({ concurrency: 10 })
  }

  async getBookmarksTree():Promise<Folder> {
    const tabs = await browser.tabs.query({
      windowType: 'normal' // no devtools or panels or popups
    })

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

  async createBookmark(bookmark:Bookmark): Promise<string|number> {
    Logger.log('(tabs)CREATE', bookmark)
    if (bookmark.parentId === 'tabs') {
      Logger.log('Parent is "tabs", ignoring this one.')
      return
    }
    const node = await this.queue.add(() =>
      browser.tabs.create({
        windowId: typeof bookmark.parentId === 'string' ? parseInt(bookmark.parentId) : bookmark.parentId,
        url: bookmark.url,
        // Only firefox allows discarded prop
        ...(typeof browser.BookmarkTreeNodeType !== 'undefined' && { discarded: true })
      })
    )
    return node.id
  }

  async updateBookmark(bookmark:Bookmark):Promise<void> {
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
  }

  async removeBookmark(bookmark:Bookmark): Promise<void> {
    const bookmarkId = bookmark.id
    Logger.log('(tabs)REMOVE', bookmark)
    if (bookmark.parentId === 'tabs') {
      Logger.log('Parent is "tabs", ignoring this one.')
      return
    }
    await this.queue.add(() => browser.tabs.remove(bookmarkId))
  }

  async createFolder(folder:Folder): Promise<number> {
    Logger.log('(tabs)CREATEFOLDER', folder)
    const node = await this.queue.add(() =>
      browser.windows.create()
    )
    return node.id
  }

  async orderFolder(id:string|number, order:Ordering):Promise<void> {
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
        !order.some(item => tab.id === item.id)
      )
      try {
        for (const [index, child] of untouchedChildren) {
          await browser.tabs.move(child.id, {index})
        }
      } catch (e) {
        throw new Error('Failed to reorder folder ' + id + ': ' + e.message)
      }
    }
  }

  async updateFolder(folder:Folder):Promise<void> {
    Logger.log('(tabs)UPDATEFOLDER (noop)', folder)
  }

  async removeFolder(folder:Folder):Promise<void> {
    const id = folder.id
    Logger.log('(tabs)REMOVEFOLDER', id)
    await this.queue.add(() => browser.tabs.remove(id))
  }
}
