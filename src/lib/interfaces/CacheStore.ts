import { Bookmark, Folder, ItemLocation, TItem } from '../Tree'
import type { TBookmarkFilter } from '../CacheTree'

type TLocalItem = TItem<typeof ItemLocation.LOCAL>
type TLocalFolder = Folder<typeof ItemLocation.LOCAL>
type TLocalBookmark = Bookmark<typeof ItemLocation.LOCAL>

/**
 * Where the sync cache -- the tree the last sync agreed on -- is kept.
 *
 * The cache used to be handed to the storage as one JSON blob on every progress
 * tick, which for a large account meant serializing and rewriting all of it
 * several times a minute. A store instead gets told what changed as it changes,
 * so that a persist costs what has happened since the last one.
 *
 * Everything but #load, #save and #clear only *records* a change; nothing
 * reaches storage until #save. That is deliberate: the cache has to move in
 * step with the mappings and the continuation, which are persisted on the
 * progress tick as well -- a cache that ran ahead of them would, after an
 * interrupt, claim items the mappings know nothing about.
 */
export default interface ICacheStore {
  /** The stored cache, or null if there is none */
  load(): Promise<TLocalFolder | null>

  /** Everything stored is replaced by this tree */
  setTree(root: TLocalFolder): Promise<void>

  createFolder(folder: TLocalFolder): void
  createBookmark(bookmark: TLocalBookmark): void
  /** `moved` says whether the item changed parents, i.e. its position is new */
  updateFolder(folder: TLocalFolder, moved: boolean): void
  updateBookmark(bookmark: TLocalBookmark, moved: boolean): void
  /** Takes the item as it still is in the tree, so its subtree can be collected */
  removeFolder(folder: TLocalFolder): void
  removeBookmark(bookmark: TLocalBookmark): void
  /** The folder's children have been reordered */
  orderFolder(folder: TLocalFolder): void
  /** `oldChildren` are the children the folder had before the import */
  importSubtree(oldChildren: TLocalItem[], folder: TLocalFolder): void

  /**
   * The hashes of these folders are gone. A stored hash that outlived its
   * folder's content would make the next sync believe nothing changed.
   */
  invalidateHashes(folderIds: (string | number)[]): void

  /**
   * Hand everything recorded so far to storage. `accepts` is the filter the
   * server would apply to a bookmark -- only a store that keeps the whole tree
   * as one blob needs it, see BrowserCacheStore.
   */
  save(root: TLocalFolder, accepts?: TBookmarkFilter): Promise<void>

  /** Throw the stored cache away */
  clear(): Promise<void>
}
