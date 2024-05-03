import { Bookmark, Folder, TItem } from '../Tree'
import Ordering from './Ordering'

export interface IResource {
  getBookmarksTree(loadAll?: boolean):Promise<Folder>
  createBookmark(bookmark: Bookmark):Promise<string|number>
  updateBookmark(bookmark: Bookmark):Promise<void>
  removeBookmark(bookmark:Bookmark):Promise<void>

  createFolder(folder:Folder):Promise<string|number>
  updateFolder(folder:Folder):Promise<void>
  removeFolder(folder:Folder):Promise<void>
  isAvailable():Promise<boolean>
}

export interface BulkImportResource extends IResource {
  bulkImportFolder(id: number|string, folder:Folder):Promise<Folder>
}

export interface LoadFolderChildrenResource extends IResource {
  loadFolderChildren(id: number|string, all?: boolean):Promise<TItem[]>
}

export interface OrderFolderResource extends IResource {
  orderFolder(id: number|string, order:Ordering):Promise<void>
}

export type TLocalTree = IResource & OrderFolderResource

type TResource = IResource|BulkImportResource|LoadFolderChildrenResource|OrderFolderResource
export default TResource
