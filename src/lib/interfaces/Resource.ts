import { Bookmark, Folder, ItemLocation, TItem, TItemLocation, TItemType } from '../Tree'
import Ordering from './Ordering'
import type { TBookmarkFilter } from '../CacheTree'

export type THashFunction = 'sha256' | 'murmur3' | 'xxhash3'

export interface ICapabilities {
  preserveOrder: boolean,
  hashFn: THashFunction[],
  /**
   * Whether this resource can store and return a bookmark's `tags`.
   * Tags are only synced if *both* resources of a sync say yes -- otherwise
   * the side that does support them keeps its tags untouched.
   */
  supportsTags: boolean,
}

export interface IHashSettings {
  preserveOrder: boolean,
  hashFn: THashFunction,
  /**
   * Negotiated from both resources' `supportsTags`. When true, tags take part
   * in hashing (so that tag-only changes propagate up folder hashes) and are
   * compared and written by the sync.
   */
  syncTags?: boolean,
}

export interface IResource<L extends TItemLocation> {
  setHashSettings(hashSettings: IHashSettings):void
  getBookmarksTree(loadAll?: boolean):Promise<Folder<L>>
  createBookmark(bookmark: Bookmark<L>):Promise<string|number>
  updateBookmark(bookmark: Bookmark<L>):Promise<void>
  removeBookmark(bookmark:Bookmark<L>):Promise<void>

  createFolder(folder:Folder<L>):Promise<string|number>
  updateFolder(folder:Folder<L>):Promise<void>
  removeFolder(folder:Folder<L>):Promise<void>
  isAvailable():Promise<boolean>
  getCapabilities():Promise<ICapabilities>
  isAtomic():boolean
  /**
   * Whether `createBookmark`/`createFolder` put a new item at the end of its
   * parent's children, and a move into a folder does the same.
   *
   * The scanner uses this to decide whether a single item that is last in the
   * source tree needs a REORDER: an appending target already puts it there,
   * a prepending one (Linkwarden puts links on top) would silently undo the
   * user's order. Absent means "may prepend", so a single appended item is
   * reordered; resources that do append set it to true.
   */
  createsAtEnd?: boolean
  isUsingBrowserTabs?: () => Promise<boolean>
  cancel():void
}

export interface CachingResource <L extends TItemLocation> extends IResource<L> {
  getCacheTree():Promise<Folder<L>>
  setCacheTree(folder:Folder<L>):Promise<void>
  /**
   * The cached tree as the plain JSON the storage takes, already stripped of the
   * bookmarks `accepts` refuses. One pass, unlike getCacheTree() + filter +
   * serialize -- see CacheTree#toStorageJSON.
   */
  // eslint-disable-next-line no-use-before-define
  getCacheTreeJSON(accepts?: TBookmarkFilter):any
  /**
   * Hand everything that has changed since the last time to the cache store.
   * `accepts` is only read by a store that keeps the cache as one blob rather
   * than as rows -- see ICacheStore.
   */
  // eslint-disable-next-line no-use-before-define
  saveCache(accepts?: TBookmarkFilter):Promise<void>
  /** How often the cached tree has been changed, see CachingAdapter */
  getCacheRevision():number
  /** Whether it has changed since the last markCachePersisted */
  isCacheDirty():boolean
  /**
   * Take note that this revision is in storage. Pass the revision read *before*
   * serializing, so that a change landing during the write leaves it dirty.
   */
  markCachePersisted(revision: number):void
}

export interface BulkImportResource<L extends TItemLocation> extends IResource<L> {
  bulkImportFolder(id: number|string, folder:Folder<L>):Promise<Folder<L>>
  /**
   * Whether bulkImportFolder *adds* the given children to the folder rather
   * than replacing whatever it held. Only such a resource may be handed a
   * subtree in several chunks (see Default#executeCreate) -- a resource that
   * replaces would keep nothing but the last chunk.
   *
   * CachingAdapter and everything built on it (NativeTree, and the
   * CachingTreeWrapper around it) replaces, so this stays off there.
   */
  bulkImportAppendsChildren?: boolean
}

export interface LoadFolderChildrenResource<L extends TItemLocation> extends IResource<L> {
  loadFolderChildren(id: number|string, all?: boolean):Promise<TItem<L>[]>
}

export interface OrderFolderResource<L extends TItemLocation> extends IResource<L> {
  /**
   * Put the folder's children in the given order.
   *
   * Returns `false` when the resource can tell that the order already was the
   * requested one and nothing was changed -- a reorder action routinely turns
   * out to be a no-op, and a caller that commits after reordering (see
   * Default#executeServerReorders) must not write for one. Resources that
   * cannot tell return nothing, which counts as "may have changed".
   */
  orderFolder(id: number|string, order:Ordering<L>):Promise<boolean|void>
}

export interface ClickCountResource<L extends TItemLocation> extends IResource<L> {
  countClick(url:string):Promise<void>
}

/**
 * An item a server's history records as deleted, identified as closely as the
 * history allows. See src/lib/Tombstones.ts for how the identity is matched.
 */
export interface ITombstone {
  type: TItemType
  /** The server id the item had, which a client's mappings translate to its local item */
  id?: string | number | null
  /** A folder's title, for a client that has no mapping for it */
  title?: string
  /** A bookmark's url, for a client that has no mapping for it */
  url?: string
  /** Folder titles from the root down to the deleted item's parent */
  parentPath: string[]
}

export interface TombstoneResource<L extends TItemLocation> extends IResource<L> {
  /**
   * The items the server history records as deleted between `revision` -- the
   * revision a previous sync left behind (see IAccountData#lastServerRevision)
   * -- and the revision this sync reads.
   *
   * History-derived on purpose: a client whose cache was lost has no other way
   * of telling a deletion from an item it has never seen, and would recreate
   * everything another client deleted. The items must be identified by what the
   * history still knows about them (see ITombstone); an empty result when the
   * revision is not in the local history is expected -- in doubt, record no
   * deletion.
   */
  getTombstonesSince(revision: string): Promise<ITombstone[]>
}

export type TLocalTree = IResource<typeof ItemLocation.LOCAL> & OrderFolderResource<typeof ItemLocation.LOCAL>

type TResource<L extends TItemLocation> = IResource<L>|BulkImportResource<L>|LoadFolderChildrenResource<L>|OrderFolderResource<L>|TombstoneResource<L>
export default TResource