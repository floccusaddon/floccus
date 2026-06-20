import CachingAdapter from './adapters/Caching'
import { IResource } from './interfaces/Resource'
import { Folder, ItemLocation, TItemLocation } from './Tree'

export default class CacheTree extends CachingAdapter implements IResource<typeof ItemLocation.LOCAL> {
  protected location: TItemLocation = ItemLocation.LOCAL

  constructor() {
    super({})
    this.resetCache()
  }

  public setTree(tree: Folder<typeof ItemLocation.LOCAL>) {
    this.bookmarksCache = tree.clone(false)
    this.bookmarksCache.createIndex()
    // Reseed highestId from the tree so subsequent createFolder/createBookmark
    // don't reissue ids that collide with items already in the tree. A collision
    // is recoverable in the final index (root.createIndex rebuilds everything),
    // but in the window after cache.createFolder and before the CachingTreeWrapper renames
    // the new folder to the inner-tree id, bookmarksCache.findFolder(cacheId) can
    // resolve to the wrong folder if the colliding existing folder is visited
    // later in the depth-first walk and overwrites the new folder's index slot.
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
    walk(this.bookmarksCache)
    this.highestId = max
  }

  async getBookmarksTree(): Promise<Folder<typeof ItemLocation.LOCAL>> {
    const tree = await super.getBookmarksTree()
    tree.createIndex()
    return tree as Folder<typeof ItemLocation.LOCAL>
  }

  isAvailable(): Promise<boolean> {
    return Promise.resolve(true)
  }
}