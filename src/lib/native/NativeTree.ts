import { Bookmark, Folder, ItemLocation, TItem } from '../Tree'
import Ordering from '../interfaces/Ordering'
import CachingAdapter from '../adapters/Caching'
import IAccountStorage from '../interfaces/AccountStorage'
import { BulkImportResource, ICapabilities, IHashSettings } from '../interfaces/Resource'
import NativeTreeStore from './NativeTreeStore'

export default class NativeTree extends CachingAdapter implements BulkImportResource<typeof ItemLocation.LOCAL> {
  private storage: IAccountStorage
  private readonly accountId: string
  private readonly store: NativeTreeStore
  private loaded = false

  constructor(storage:IAccountStorage) {
    super({})
    this.location = ItemLocation.LOCAL
    this.storage = storage
    this.accountId = this.storage.accountId
    this.store = new NativeTreeStore(this.accountId)
    this.resetCache()
  }

  async load():Promise<boolean> {
    const stored = await this.store.load()
    if (!stored) {
      await this.store.initialize(this.bookmarksCache as Folder<typeof ItemLocation.LOCAL>, this.highestId)
      this.loaded = true
      return false
    }

    // Make sure we use xxhash3 if we have to calculate hash for this
    const hashSettings: IHashSettings = {
      preserveOrder: true,
      hashFn: 'xxhash3',
    }
    let oldHash
    if (this.loaded && this.bookmarksCache) {
      oldHash = await this.bookmarksCache.cloneWithLocation(false, this.location).hash(hashSettings)
    }
    this.bookmarksCache = stored.root
    this.highestId = stored.highestId
    if (oldHash && this.loaded) {
      const newHash = await this.bookmarksCache.hash(hashSettings)
      return oldHash !== newHash
    } else {
      this.loaded = true
      return false
    }
  }

  /**
   * Every change is written to the database as it happens, so all that's left
   * to do here is to wait for the writes still in flight.
   */
  async save():Promise<void> {
    await this.store.flush()
  }

  async saveImmediately(): Promise<void> {
    await this.save()
  }

  async getBookmarksTree(): Promise<Folder<typeof ItemLocation.LOCAL>> {
    const tree = await super.getBookmarksTree()
    tree.createIndex()
    return tree as Folder<typeof ItemLocation.LOCAL>
  }

  async createBookmark(bookmark:Bookmark<typeof ItemLocation.LOCAL>): Promise<string|number> {
    const id = await super.createBookmark(bookmark)
    await this.store.createBookmark(this.bookmarksCache.findBookmark(id) as Bookmark<typeof ItemLocation.LOCAL>, this.highestId)
    return id
  }

  async updateBookmark(bookmark:Bookmark<typeof ItemLocation.LOCAL>):Promise<void> {
    // This is a quickfix so we can pass url and title as undefined in the benchmark tests
    const currentBookmark = this.bookmarksCache.findBookmark(bookmark.id)
    const nextBookmark = currentBookmark
      ? new Bookmark({
        ...currentBookmark.toJSON(),
        ...bookmark.toJSON(),
        id:
          typeof bookmark.id === 'undefined'
            ? currentBookmark.id
            : bookmark.id,
        title:
          typeof bookmark.title === 'undefined'
            ? currentBookmark.title
            : bookmark.title,
        url:
          typeof bookmark.url === 'undefined'
            ? currentBookmark.url
            : bookmark.url,
        parentId:
          typeof bookmark.parentId === 'undefined'
            ? currentBookmark.parentId
            : bookmark.parentId,
        tags:
          typeof bookmark.tags === 'undefined'
            ? currentBookmark.tags
            : bookmark.tags,
        location: this.location,
      })
      : bookmark

    const oldParentId = currentBookmark && currentBookmark.parentId

    await super.updateBookmark(nextBookmark)

    const updated = this.bookmarksCache.findBookmark(nextBookmark.id) as Bookmark<typeof ItemLocation.LOCAL>
    await this.store.updateBookmark(updated, String(oldParentId) !== String(updated.parentId))
  }

  async removeBookmark(bookmark:Bookmark<typeof ItemLocation.LOCAL>): Promise<void> {
    await super.removeBookmark(bookmark)
    await this.store.removeBookmark(bookmark)
  }

  async createFolder(folder:Folder<typeof ItemLocation.LOCAL>): Promise<string|number> {
    const id = await super.createFolder(folder)
    await this.store.createFolder(this.bookmarksCache.findFolder(id) as Folder<typeof ItemLocation.LOCAL>, this.highestId)
    return id
  }

  async orderFolder(id:string|number, order:Ordering<typeof ItemLocation.LOCAL>) :Promise<void> {
    await super.orderFolder(id, order)
    await this.store.orderFolder(this.bookmarksCache.findFolder(id) as Folder<typeof ItemLocation.LOCAL>)
  }

  async updateFolder(folder:Folder<typeof ItemLocation.LOCAL>):Promise<void> {
    const oldFolder = this.bookmarksCache.findFolder(folder.id)
    const oldParentId = oldFolder && oldFolder.parentId

    await super.updateFolder(folder)

    const updated = this.bookmarksCache.findFolder(folder.id) as Folder<typeof ItemLocation.LOCAL>
    await this.store.updateFolder(updated, String(oldParentId) !== String(updated.parentId))
  }

  async removeFolder(folder:Folder<typeof ItemLocation.LOCAL>):Promise<void> {
    // Collect the rows to delete while the subtree is still in the cache
    const oldFolder = this.bookmarksCache.findFolder(folder.id) as Folder<typeof ItemLocation.LOCAL>
    await super.removeFolder(folder)
    // Removing the root folder (or an unknown one) leaves the cache untouched,
    // and then the rows must stay as they are, too
    if (oldFolder && !this.bookmarksCache.findFolder(folder.id)) {
      await this.store.removeFolder(oldFolder)
    }
  }

  async bulkImportFolder(id: number|string, folder:Folder<typeof ItemLocation.LOCAL>):Promise<Folder<typeof ItemLocation.LOCAL>> {
    const oldFolder = this.bookmarksCache.findFolder(id)
    const oldChildren = (oldFolder ? oldFolder.children.slice() : []) as TItem<typeof ItemLocation.LOCAL>[]

    const imported = await super.bulkImportFolder(id, folder) as Folder<typeof ItemLocation.LOCAL>

    await this.store.bulkImport(
      oldChildren,
      this.bookmarksCache.findFolder(id) as Folder<typeof ItemLocation.LOCAL>,
      this.highestId
    )
    return imported
  }

  isAvailable(): Promise<boolean> {
    return Promise.resolve(true)
  }

  isAtomic(): boolean {
    return false
  }

  async getCapabilities(): Promise<ICapabilities> {
    return {
      ...(await super.getCapabilities()),
      // Our own tree stores whatever we put into it, tags included
      supportsTags: true,
    }
  }
}
