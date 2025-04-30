import CachingAdapter from './adapters/Caching'
import { IResource } from './interfaces/Resource'
import { Folder, ItemLocation, TItemLocation } from './Tree'

export default class CacheTree extends CachingAdapter implements IResource<typeof ItemLocation.LOCAL> {
  protected location: TItemLocation = ItemLocation.LOCAL

  constructor() {
    super({})
  }

  public setTree(tree: Folder<typeof ItemLocation.LOCAL>) {
    this.bookmarksCache = tree.clone(false)
    this.bookmarksCache.createIndex()
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