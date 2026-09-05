import { Bookmark, Folder, ItemLocation, TItem, TItemLocation } from '../Tree'
import Ordering from './Ordering'

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
  isUsingBrowserTabs?: () => Promise<boolean>
  cancel():void
}

export interface CachingResource <L extends TItemLocation> extends IResource<L> {
  getCacheTree():Promise<Folder<L>>
  setCacheTree(folder:Folder<L>):Promise<void>
}

export interface BulkImportResource<L extends TItemLocation> extends IResource<L> {
  bulkImportFolder(id: number|string, folder:Folder<L>):Promise<Folder<L>>
}

export interface LoadFolderChildrenResource<L extends TItemLocation> extends IResource<L> {
  loadFolderChildren(id: number|string, all?: boolean):Promise<TItem<L>[]>
}

export interface OrderFolderResource<L extends TItemLocation> extends IResource<L> {
  orderFolder(id: number|string, order:Ordering<L>):Promise<void>
}

export interface ClickCountResource<L extends TItemLocation> extends IResource<L> {
  countClick(url:string):Promise<void>
}

export type TLocalTree = IResource<typeof ItemLocation.LOCAL> & OrderFolderResource<typeof ItemLocation.LOCAL>

type TResource<L extends TItemLocation> = IResource<L>|BulkImportResource<L>|LoadFolderChildrenResource<L>|OrderFolderResource<L>
export default TResource