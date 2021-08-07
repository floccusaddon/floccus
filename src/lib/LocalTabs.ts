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
      children: uniq(tabs.map(t => t.windowId)).map(id => id as number).map(windowId => {
        return new Folder({
          title: '',
          id: windowId,
          parentId: 'tabs',
          location: ItemLocation.LOCAL,
          children: tabs.filter(t => t.windowId === windowId).sort(t => t.index).map(t => new Bookmark({
            id: t.id,
            title: '',
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
    const node = await this.queue.add(() =>
      browser.tabs.create({
        windowId: bookmark.parentId,
        url: bookmark.url,
        discarded: true
      })
    )
    return node.id
  }

  async updateBookmark(bookmark:Bookmark):Promise<void> {
    Logger.log('(tabs)UPDATE', bookmark)
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
    await this.queue.add(() => browser.tabs.remove(bookmarkId))
  }

  async createFolder(folder:Folder): Promise<string> {
    Logger.log('(tabs)CREATEFOLDER', folder)
    if (folder.parentId !== 'tabs') {
      // Don't go deeper than one level.
      return '0'
    }
    const node = await this.queue.add(() =>
      browser.windows.create()
    )
    return node.id
  }

  async orderFolder(id:string|number, order:Ordering):Promise<void> {
    Logger.log('(tabs)ORDERFOLDER (noop)', { id, order })
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
