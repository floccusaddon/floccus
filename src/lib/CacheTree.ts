import CachingAdapter from './adapters/Caching'
import { IResource } from './interfaces/Resource'
import { Folder, ItemLocation, TItemLocation } from './Tree'
import { UnknownCreateTargetError } from '../errors/Error'

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

  constructor() {
    super({})
    this.resetCache()
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
    this.bookmarksCache.assertIndexConsistent('importSubtree')
    // Don't reissue the ids we just adopted
    this.setHighestId(maxNumericId(imported))
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
