import { CachingResource, OrderFolderResource } from './interfaces/Resource'
import { Bookmark, Folder, ItemLocation } from './Tree'
import CacheTree from './CacheTree'
import Ordering from './interfaces/Ordering'

export default class CachingTreeWrapper implements OrderFolderResource<typeof ItemLocation.LOCAL>, CachingResource<typeof ItemLocation.LOCAL> {
  private innerTree: OrderFolderResource<typeof ItemLocation.LOCAL>
  private cacheTree: CacheTree

  constructor(innerTree: OrderFolderResource<typeof ItemLocation.LOCAL>) {
    this.innerTree = innerTree
    this.cacheTree = new CacheTree()
  }

  async getBookmarksTree(): Promise<Folder<typeof ItemLocation.LOCAL>> {
    const tree = await this.innerTree.getBookmarksTree()
    this.cacheTree.setTree(tree)
    return tree
  }

  async createBookmark(bookmark:Bookmark<typeof ItemLocation.LOCAL>): Promise<string|number> {
    const id = await this.innerTree.createBookmark(bookmark)
    const cacheId = await this.cacheTree.createBookmark(bookmark.copy(false))
    const cacheBookmark = this.cacheTree.bookmarksCache.findBookmark(cacheId)
    cacheBookmark.id = id
    cacheBookmark.parentId = bookmark.parentId
    this.cacheTree.bookmarksCache.createIndex()
    return id
  }

  async updateBookmark(bookmark:Bookmark<typeof ItemLocation.LOCAL>):Promise<void> {
    await this.innerTree.updateBookmark(bookmark)
    await this.cacheTree.updateBookmark(bookmark.copy(false))
  }

  async removeBookmark(bookmark:Bookmark<typeof ItemLocation.LOCAL>): Promise<void> {
    await this.innerTree.removeBookmark(bookmark)
    await this.cacheTree.removeBookmark(bookmark)
  }

  async createFolder(folder:Folder<typeof ItemLocation.LOCAL>): Promise<string|number> {
    const id = await this.innerTree.createFolder(folder)
    const cacheId = await this.cacheTree.createFolder(folder.copy(false))
    const cacheFolder = this.cacheTree.bookmarksCache.findFolder(cacheId)
    cacheFolder.id = id
    cacheFolder.parentId = folder.parentId
    this.cacheTree.bookmarksCache.createIndex()
    return id
  }

  async orderFolder(id:string|number, order:Ordering<typeof ItemLocation.LOCAL>): Promise<void> {
    await this.innerTree.orderFolder(id, order)
    await this.cacheTree.orderFolder(id, order)
  }

  async updateFolder(folder:Folder<typeof ItemLocation.LOCAL>): Promise<void> {
    await this.innerTree.updateFolder(folder)
    await this.cacheTree.updateFolder(folder.copy(false))
  }

  async removeFolder(folder:Folder<typeof ItemLocation.LOCAL>): Promise<void> {
    await this.innerTree.removeFolder(folder)
    await this.cacheTree.removeFolder(folder)
  }

  isAvailable(): Promise<boolean> {
    return this.innerTree.isAvailable()
  }

  async isUsingBrowserTabs() {
    return this.innerTree.isUsingBrowserTabs?.()
  }

  getCacheTree(): Promise<Folder<typeof ItemLocation.LOCAL>> {
    return this.cacheTree.getBookmarksTree()
  }
}