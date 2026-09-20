import CachingAdapter from './adapters/Caching'
import { IResource } from './interfaces/Resource'
import { Folder, ItemLocation, ItemType, TItemLocation } from './Tree'
import { UnknownCreateTargetError } from '../errors/Error'

/**
 * Whether the server would take this bookmark -- see IAdapter#acceptsBookmark.
 * Applied to the serialized tree rather than to items, so this only ever gets
 * to see the plain properties (every implementation reads nothing but `url`).
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

export default class CacheTree extends CachingAdapter implements IResource<typeof ItemLocation.LOCAL> {
  protected location: TItemLocation = ItemLocation.LOCAL

  /**
   * The mutation count that is in storage, so that an unchanged cache isn't
   * serialized and written all over again.
   *
   * -1 until the first persist of this instance: whatever storage holds was put
   * there by an earlier sync and says nothing about the tree we have here, so we
   * start out dirty.
   */
  private persistedMutations = -1

  constructor() {
    super({})
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
   * Take note that the tree was changed from the outside -- CachingTreeWrapper
   * rewrites the ids of what it has just created directly in bookmarksCache.
   * Those callers check the index themselves.
   */
  public markChanged(): void {
    this.mutated()
  }

  public setTree(tree: Folder<typeof ItemLocation.LOCAL>) {
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
  public snapshot(): Folder<typeof ItemLocation.LOCAL> {
    return this.bookmarksCache.copy(true) as Folder<typeof ItemLocation.LOCAL>
  }

  /**
   * The cached tree as the plain JSON the storage takes.
   *
   * The progress tick used to take a Folder copy of the whole tree (#snapshot),
   * filter that, and then have the copy serialized -- two full allocating walks
   * of a tree that can hold every bookmark of the account, repeated throughout
   * the sync. Here the copy *is* the JSON, and the filtering runs over the plain
   * objects afterwards, which allocates nothing.
   *
   * Serializing the live tree rather than a copy is safe because Folder#toJSON
   * is synchronous throughout: nothing the sync does can interleave with it, and
   * unlike the old path this doesn't change the tree it walks.
   *
   * `accepts` drops the bookmarks the server would refuse. A folder that loses
   * one loses its cached hash, and so does every folder above it -- a folder's
   * hash covers its whole subtree, and a stale one would have the next sync's
   * scanner conclude that nothing below it has changed.
   */
  public toStorageJSON(accepts: TBookmarkFilter = () => true): any {
    const json = this.bookmarksCache.toJSON() as any
    CacheTree.dropUnaccepted(json, accepts)
    return json
  }

  /** Returns whether anything below this folder (itself included) was dropped */
  private static dropUnaccepted(folder: any, accepts: TBookmarkFilter): boolean {
    const children = folder.children || []
    let changed = false
    const kept = []
    for (const child of children) {
      if (child.type === ItemType.FOLDER) {
        changed = CacheTree.dropUnaccepted(child, accepts) || changed
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

  async getBookmarksTree(): Promise<Folder<typeof ItemLocation.LOCAL>> {
    const tree = this.bookmarksCache.copy(true) as Folder<typeof ItemLocation.LOCAL>
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
