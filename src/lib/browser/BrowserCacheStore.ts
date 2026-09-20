import { Folder, ItemLocation } from '../Tree'
import ICacheStore from '../interfaces/CacheStore'
import IAccountStorage from '../interfaces/AccountStorage'
import { TBookmarkFilter, toStorageJSON } from '../CacheTree'

/**
 * The sync cache as one JSON blob in the extension's storage, which is what it
 * has always been in the browser.
 *
 * Nothing incremental to do here: the blob is rewritten whole on every persist,
 * so all the per-item methods are no-ops and #save serializes the tree it is
 * given. Unlike a SharedPreferences write on Android (see NativeCacheStore),
 * browser.storage takes a multi-megabyte value without holding up everything
 * else that is stored.
 *
 * Reads and writes go through the storage's own getCache/setCache rather than
 * straight to the entry, so that a caller which replaces those -- the sync
 * tests simulate a storage that can't persist by doing exactly that -- still
 * has the last word.
 */
export default class BrowserCacheStore implements ICacheStore {
  private readonly storage: IAccountStorage

  constructor(storage: IAccountStorage) {
    this.storage = storage
  }

  load(): Promise<Folder<typeof ItemLocation.LOCAL> | null> {
    return this.storage.getCache()
  }

  async setTree(): Promise<void> {
    // The tree is serialized as a whole in #save; nothing to record here
  }

  createFolder(): void {
    // see #setTree
  }

  createBookmark(): void {
    // see #setTree
  }

  updateFolder(): void {
    // see #setTree
  }

  updateBookmark(): void {
    // see #setTree
  }

  removeFolder(): void {
    // see #setTree
  }

  removeBookmark(): void {
    // see #setTree
  }

  orderFolder(): void {
    // see #setTree
  }

  importSubtree(): void {
    // see #setTree
  }

  invalidateHashes(): void {
    // The hashes are part of the serialized tree, so they go with it
  }

  async save(root: Folder<typeof ItemLocation.LOCAL>, accepts?: TBookmarkFilter): Promise<void> {
    await this.storage.setCache(toStorageJSON(root, accepts))
  }

  clear(): Promise<void> {
    return this.storage.deleteCache()
  }
}
