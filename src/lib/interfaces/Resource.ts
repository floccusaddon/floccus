import { Bookmark, Folder, ItemLocation, TItem, TItemLocation } from '../Tree'
import Ordering from './Ordering'

export interface IResource<L extends TItemLocation> {
  getBookmarksTree(loadAll?: boolean):Promise<Folder<L>>
  createBookmark(bookmark: Bookmark<L>):Promise<string|number>
  updateBookmark(bookmark: Bookmark<L>):Promise<void>
  removeBookmark(bookmark:Bookmark<L>):Promise<void>

  createFolder(folder:Folder<L>):Promise<string|number>
  updateFolder(folder:Folder<L>):Promise<void>
  removeFolder(folder:Folder<L>):Promise<void>
  isAvailable():Promise<boolean>
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
