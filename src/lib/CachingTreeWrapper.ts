import { BulkImportResource, CachingResource, ICapabilities, IHashSettings, OrderFolderResource } from './interfaces/Resource'
import { Bookmark, Folder, ItemLocation } from './Tree'
import CacheTree from './CacheTree'
import Logger from './Logger'
import Ordering from './interfaces/Ordering'

export default class CachingTreeWrapper implements OrderFolderResource<typeof ItemLocation.LOCAL>, CachingResource<typeof ItemLocation.LOCAL> {
  private innerTree: OrderFolderResource<typeof ItemLocation.LOCAL>
  private cacheTree: CacheTree

  /**
   * Only set when the wrapped tree can bulk import. The sync strategy picks the
   * bulk path with `'bulkImportFolder' in resource` (see Default#executeCreate),
   * so declaring this unconditionally would have it bulk import into a tree
   * that has no such method -- while leaving it out entirely hides the
   * capability of the trees that do have it (NativeTree), which is what made
   * an initial sync create every single item one action at a time.
   */
  bulkImportFolder?: (id: string|number, folder: Folder<typeof ItemLocation.LOCAL>) => Promise<Folder<typeof ItemLocation.LOCAL>>

  constructor(innerTree: OrderFolderResource<typeof ItemLocation.LOCAL>) {
    this.innerTree = innerTree
    this.cacheTree = new CacheTree()
    if ('bulkImportFolder' in innerTree) {
      // The cast is what the guard above establishes; keep the two together
      const bulkInnerTree = innerTree as OrderFolderResource<typeof ItemLocation.LOCAL> & BulkImportResource<typeof ItemLocation.LOCAL>
      this.bulkImportFolder = (id, folder) => this.doBulkImportFolder(bulkInnerTree, id, folder)
    }
  }

  private async doBulkImportFolder(inner: BulkImportResource<typeof ItemLocation.LOCAL>, id: string|number, folder: Folder<typeof ItemLocation.LOCAL>): Promise<Folder<typeof ItemLocation.LOCAL>> {
    const imported = await inner.bulkImportFolder(id, folder)
    try {
      // The inner tree hands the subtree back stamped with the ids it allocated;
      // mirror it into the cache under those very ids, so that both sides keep
      // talking about the same items.
      this.cacheTree.importSubtree(id, imported)
    } catch (e) {
      // The import has already landed in the inner tree. Throwing here would send
      // the strategy down the per-child creation path (see Default#executeCreate,
      // where doneCalled is still false at this point) and re-create everything we
      // just imported, so leave the cache stale instead: the next sync's scanner
      // pairs the items up via the mappings the bulk import created.
      Logger.log('Failed to mirror bulk import into the sync cache: ' + e.message)
    }
    return imported
  }

  async getBookmarksTree(): Promise<Folder<typeof ItemLocation.LOCAL>> {
    const tree = await this.innerTree.getBookmarksTree()
    this.cacheTree.setTree(tree.copy(true))
    return tree
  }

  async setCacheTree(tree: Folder<typeof ItemLocation.LOCAL>) {
    this.cacheTree.setTree(tree.copy(true))
  }

  async createBookmark(bookmark:Bookmark<typeof ItemLocation.LOCAL>): Promise<string|number> {
    const id = await this.innerTree.createBookmark(bookmark)
    // In case the browser uses positive int IDs, we need to reset the highestId counter here
    // to avoid collisions with the cache tree's auto-generated IDs
    this.cacheTree.setHighestId(Number(id) || 0)
    const cacheId = await this.cacheTree.createBookmark(bookmark.copy(false))
    const cacheBookmark = this.cacheTree.bookmarksCache.findBookmark(cacheId)
    this.cacheTree.bookmarksCache.removeFromIndex(cacheBookmark)
    cacheBookmark.id = id
    cacheBookmark.parentId = bookmark.parentId
    cacheBookmark.createIndex()
    this.cacheTree.bookmarksCache.updateIndex(cacheBookmark)
    this.cacheTree.bookmarksCache.assertIndexConsistent('CachingTreeWrapper#createBookmark')
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
    // In case the browser uses positive int IDs, we need to reset the highestId counter here
    // to avoid collisions with the cache tree's auto-generated IDs
    this.cacheTree.setHighestId(Number(id) || 0)
    const cacheId = await this.cacheTree.createFolder(folder.copy(false))
    const cacheFolder = this.cacheTree.bookmarksCache.findFolder(cacheId)
    this.cacheTree.bookmarksCache.removeFromIndex(cacheFolder)
    cacheFolder.id = id
    cacheFolder.parentId = folder.parentId
    cacheFolder.createIndex()
    this.cacheTree.bookmarksCache.updateIndex(cacheFolder)
    this.cacheTree.bookmarksCache.assertIndexConsistent('CachingTreeWrapper#createFolder')
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
    // A fresh copy the caller owns, so it can filter it in place before
    // serializing it -- see CacheTree#snapshot for why it carries no index
    return Promise.resolve(this.cacheTree.snapshot())
  }

  getCapabilities(): Promise<ICapabilities> {
    return this.innerTree.getCapabilities()
  }

  setHashSettings(hashSettings: IHashSettings): void {
    this.innerTree.setHashSettings(hashSettings)
  }

  cancel(): void {
    this.innerTree.cancel()
  }

  isAtomic(): boolean {
    return this.innerTree.isAtomic()
  }
}