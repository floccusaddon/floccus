import { Folder, ItemLocation } from './Tree'
import ICacheStore from './interfaces/CacheStore'

/**
 * A cache store that keeps nothing.
 *
 * What a CacheTree gets when nobody handed it a store: the tree is then only
 * ever used in memory (the tests do this), and a sync that runs against it
 * simply starts from an empty cache the next time around.
 */
export default class NullCacheStore implements ICacheStore {
  async load(): Promise<Folder<typeof ItemLocation.LOCAL> | null> {
    return null
  }

  async setTree(): Promise<void> {
    // no-op
  }

  createFolder(): void {
    // no-op
  }

  createBookmark(): void {
    // no-op
  }

  updateFolder(): void {
    // no-op
  }

  updateBookmark(): void {
    // no-op
  }

  removeFolder(): void {
    // no-op
  }

  removeBookmark(): void {
    // no-op
  }

  orderFolder(): void {
    // no-op
  }

  importSubtree(): void {
    // no-op
  }

  invalidateHashes(): void {
    // no-op
  }

  async save(): Promise<void> {
    // no-op
  }

  async clear(): Promise<void> {
    // no-op
  }
}
