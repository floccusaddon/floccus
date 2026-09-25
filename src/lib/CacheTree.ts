import CachingAdapter from './adapters/Caching'
import { IResource } from './interfaces/Resource'
import ICacheStore from './interfaces/CacheStore'
import NullCacheStore from './NullCacheStore'
import { Bookmark, Folder, ItemLocation, ItemType, TItem, TItemLocation } from './Tree'
import { UnknownCreateTargetError } from '../errors/Error'
import Ordering from './interfaces/Ordering'

type TLocalItem = TItem<typeof ItemLocation.LOCAL>
type TLocalFolder = Folder<typeof ItemLocation.LOCAL>
type TLocalBookmark = Bookmark<typeof ItemLocation.LOCAL>

/**
 * Whether the server would take this bookmark -- see IAdapter#acceptsBookmark.
 * Applied both to serialized trees (where it only ever gets to see the plain
 * properties -- every implementation reads nothing but `url`) and to live ones.
 */
export type TBookmarkFilter = (bookmark: any) => boolean

/**
 * The highest numeric id anywhere in the given subtree, so that ids handed to
 * us from the outside aren't reissued by createFolder/createBookmark later.
 */
function maxNumericId(folder: Folder<TItemLocation>): number {
  let max = 0
  const walk = (f: Folder<TItemLocation>) => {
    const id = Number(f.id)
    if (Number.isFinite(id) && id > max) max = id
    for (const child of f.children) {
      const cid = Number(child.id)
      if (Number.isFinite(cid) && cid > max) max = cid
      if (child instanceof Folder) walk(child)
    }
  }
  walk(folder)
  return max
}

/**
 * Drop the bookmarks the server would refuse, in place.
 *
 * They were never on the server, so they must not be in a tree that is diffed
 * against one that has been filtered the same way -- otherwise every one of
 * them looks like a local creation, sync after sync.
 *
 * A folder that loses one loses its cached hash, and so does every folder above
 * it: a folder's hash covers its whole subtree, and a stale one would have the
 * next sync's scanner conclude that nothing below it has changed.
 *
 * Returns whether anything below this folder (itself included) was dropped.
 */
export function filterUnacceptedBookmarks(folder: Folder<TItemLocation>, accepts: TBookmarkFilter): boolean {
  let changed = false
  folder.children = folder.children.filter((child) => {
    if (child instanceof Folder) {
      changed = filterUnacceptedBookmarks(child, accepts) || changed
      return true
    }
    const accepted = accepts(child)
    changed = changed || !accepted
    return accepted
  })
  if (changed) {
    folder.invalidateHash()
  }
  return changed
}

/** #filterUnacceptedBookmarks, in the serialized shape */
function dropUnaccepted(folder: any, accepts: TBookmarkFilter): boolean {
  const children = folder.children || []
  let changed = false
  const kept = []
  for (const child of children) {
    if (child.type === ItemType.FOLDER) {
      changed = dropUnaccepted(child, accepts) || changed
      kept.push(child)
    } else if (accepts(child)) {
      kept.push(child)
    } else {
      changed = true
    }
  }
  if (kept.length !== children.length) {
    folder.children = kept
  }
  if (changed) {
    // What Folder#invalidateHash does, in the serialized shape
    folder.hashValue = {}
  }
  return changed
}

/**
 * A tree as the plain JSON a blob storage takes, stripped of the bookmarks
 * `accepts` refuses.
 *
 * One pass rather than copy + filter + serialize: here the copy *is* the JSON,
 * and the filtering runs over the plain objects afterwards, which allocates
 * nothing. Serializing the live tree rather than a copy is safe because
 * Folder#toJSON is synchronous throughout: nothing the sync does can interleave
 * with it, and unlike the old path this doesn't change the tree it walks.
 */
export function toStorageJSON(root: Folder<TItemLocation>, accepts: TBookmarkFilter = () => true): any {
  const json = root.toJSON() as any
  dropUnaccepted(json, accepts)
  return json
}

export default class CacheTree extends CachingAdapter implements IResource<typeof ItemLocation.LOCAL> {
  protected location: TItemLocation = ItemLocation.LOCAL

  /**
   * Where the tree is persisted. Every change is handed to it as it happens,
   * so that a persist costs what has changed rather than the whole tree -- see
   * ICacheStore. Without one the tree simply isn't persisted at all.
   */
  private store: ICacheStore

  /**
   * The mutation count that is in storage, so that an unchanged cache isn't
   * serialized and written all over again.
   *
   * -1 until the first persist of this instance: whatever storage holds was put
   * there by an earlier sync and says nothing about the tree we have here, so we
   * start out dirty.
   */
  private persistedMutations = -1

  constructor(store: ICacheStore = new NullCacheStore()) {
    super({})
    this.store = store
    this.resetCache()
  }

  /** Whether anything has changed since the last #markPersisted */
  public isDirty(): boolean {
    return this.getMutationCount() !== this.persistedMutations
  }

  /**
   * Take note that this revision of the tree is in storage. Pass the revision
   * read *before* serializing: a mutation that lands while the write is in
   * flight leaves the cache dirty for the next tick, as it must.
   */
  public markPersisted(mutations: number): void {
    this.persistedMutations = mutations
  }

  /**
   * Hand everything that has happened since the last time to the store.
   *
   * `accepts` only matters to a store that keeps the tree as one blob, which
   * has to strip the bookmarks the server would refuse as it serializes; a row
   * store keeps the tree as it is and leaves that to the load (see
   * #filterUnacceptedBookmarks).
   */
  public save(accepts?: TBookmarkFilter): Promise<void> {
    return this.store.save(this.bookmarksCache as TLocalFolder, accepts)
  }

  public async setTree(tree: TLocalFolder): Promise<void> {
    // Keep the folder hashes: they are persisted with the cache and let the
    // next sync skip hashing the subtrees that didn't change
    this.bookmarksCache = tree.clone(true)
    this.bookmarksCache.createIndex()
    // Reseed highestId from the tree so subsequent createFolder/createBookmark
    // don't reissue ids that collide with items already in the tree. A collision
    // is recoverable in the final index (root.createIndex rebuilds everything),
    // but in the window after cache.createFolder and before the CachingTreeWrapper renames
    // the new folder to the inner-tree id, bookmarksCache.findFolder(cacheId) can
    // resolve to the wrong folder if the colliding existing folder is visited
    // later in the depth-first walk and overwrites the new folder's index slot.
    this.highestId = maxNumericId(this.bookmarksCache)
    this.mutated()
    await this.store.setTree(this.bookmarksCache as TLocalFolder)
  }

  /**
   * Splice a subtree in the way bulkImportFolder does, except that the items
   * keep the ids they arrive with instead of being issued ids of our own.
   *
   * This is what CachingTreeWrapper mirrors a bulk import with: the live tree
   * has already allocated the ids, and the cache has to talk about the very
   * same items for the next sync's scanner to pair them up.
   */
  public importSubtree(id: string|number, imported: Folder<TItemLocation>): void {
    const foundFolder = this.bookmarksCache.findFolder(id)
    if (!foundFolder) {
      throw new UnknownCreateTargetError()
    }
    // The live tree keeps the subtree it handed out, so take a copy of our own
    const children = imported.copy(false).children
    // Keep the parentId identical to the parent's own id, including its type
    children.forEach((child) => { child.parentId = foundFolder.id })
    const oldChildren = foundFolder.children
    foundFolder.children = children
    // The replaced children have to leave the index of every folder above,
    // which still lists them, before the imported ones are added
    oldChildren.forEach((child) => this.bookmarksCache.removeFromIndex(child))
    foundFolder.createIndex()
    this.bookmarksCache.updateIndex(foundFolder)
    this.invalidateHashes(foundFolder.id)
    this.endMutation('importSubtree')
    // Don't reissue the ids we just adopted
    this.setHighestId(maxNumericId(imported))
    this.store.importSubtree(oldChildren as TLocalItem[], foundFolder as TLocalFolder)
  }

  /**
   * Create the bookmark under the id the live tree has just allocated for it.
   *
   * The plain createBookmark() issues an id of its own, which the caller then
   * had to rename -- and a store that had already been told about the creation
   * would have to be told about the rename as well. Both sides have to talk
   * about the same item for the next sync's scanner to pair them up, so the
   * renaming happens here, before anyone hears of the item.
   */
  public async createBookmarkAs(bookmark: TLocalBookmark, id: string|number): Promise<void> {
    // In case the browser uses positive int IDs, we need to reset the highestId counter here
    // to avoid collisions with the cache tree's auto-generated IDs
    this.setHighestId(Number(id) || 0)
    const cacheId = await super.createBookmark(bookmark)
    const cached = this.bookmarksCache.findBookmark(cacheId) as TLocalBookmark
    this.bookmarksCache.removeFromIndex(cached)
    cached.id = id
    cached.parentId = bookmark.parentId
    cached.createIndex()
    this.bookmarksCache.updateIndex(cached)
    this.bookmarksCache.assertIndexConsistent('CacheTree#createBookmarkAs')
    // The id we just wrote into the cache is part of the tree's contents, so it
    // counts as a change of its own
    this.mutated()
    this.store.createBookmark(cached)
  }

  /** #createBookmarkAs, for folders */
  public async createFolderAs(folder: TLocalFolder, id: string|number): Promise<void> {
    this.setHighestId(Number(id) || 0)
    const cacheId = await super.createFolder(folder)
    const cached = this.bookmarksCache.findFolder(cacheId) as TLocalFolder
    this.bookmarksCache.removeFromIndex(cached)
    cached.id = id
    cached.parentId = folder.parentId
    cached.createIndex()
    this.bookmarksCache.updateIndex(cached)
    this.bookmarksCache.assertIndexConsistent('CacheTree#createFolderAs')
    this.mutated()
    this.store.createFolder(cached)
  }

  async updateBookmark(bookmark: TLocalBookmark): Promise<void> {
    const current = this.bookmarksCache.findBookmark(bookmark.id)
    const oldParentId = current && current.parentId
    await super.updateBookmark(bookmark)
    const updated = this.bookmarksCache.findBookmark(bookmark.id) as TLocalBookmark
    this.store.updateBookmark(updated, String(oldParentId) !== String(updated.parentId))
  }

  async updateFolder(folder: TLocalFolder): Promise<void> {
    const current = this.bookmarksCache.findFolder(folder.id)
    const oldParentId = current && current.parentId
    await super.updateFolder(folder)
    const updated = this.bookmarksCache.findFolder(folder.id) as TLocalFolder
    this.store.updateFolder(updated, String(oldParentId) !== String(updated.parentId))
  }

  async removeBookmark(bookmark: TLocalBookmark): Promise<void> {
    await super.removeBookmark(bookmark)
    this.store.removeBookmark(bookmark)
  }

  async removeFolder(folder: TLocalFolder): Promise<void> {
    // Collect the rows to delete while the subtree is still in the cache
    const oldFolder = this.bookmarksCache.findFolder(folder.id) as TLocalFolder
    await super.removeFolder(folder)
    // Removing the root folder (or an unknown one) leaves the cache untouched,
    // and then the rows must stay as they are, too
    if (oldFolder && !this.bookmarksCache.findFolder(folder.id)) {
      this.store.removeFolder(oldFolder)
    }
  }

  async orderFolder(id: string|number, order: Ordering<typeof ItemLocation.LOCAL>): Promise<void> {
    await super.orderFolder(id, order)
    this.store.orderFolder(this.bookmarksCache.findFolder(id) as TLocalFolder)
  }

  /**
   * A stored hash that outlived its folder's content would make the next sync
   * believe that nothing below it changed, so it has to go the moment the
   * in-memory one does.
   */
  protected onHashesInvalidated(folderIds: (string|number)[]): void {
    this.store.invalidateHashes(folderIds)
  }

  /**
   * A private copy of the cached tree for the caller to filter and serialize.
   *
   * Unlike getBookmarksTree() this builds no index: the callers (the cache
   * persist in Account#sync) only walk children, and an index rebuild is a
   * whole extra pass over the tree -- on every progress tick, for a tree that
   * can hold every bookmark of the account. Folder#findFolder/#findBookmark
   * fall back to a traversal when there is no index, so a caller that does need
   * one can still ask for it with createIndex().
   */
  public snapshot(): TLocalFolder {
    return this.bookmarksCache.copy(true) as TLocalFolder
  }

  /** The cached tree as the plain JSON a blob storage takes */
  public toStorageJSON(accepts?: TBookmarkFilter): any {
    return toStorageJSON(this.bookmarksCache, accepts)
  }

  async getBookmarksTree(): Promise<TLocalFolder> {
    const tree = this.bookmarksCache.copy(true) as TLocalFolder
    tree.createIndex()
    return tree
  }

  isAvailable(): Promise<boolean> {
    return Promise.resolve(true)
  }

  setHighestId(id: number) {
    this.highestId = Math.max(this.highestId, id)
  }
}
