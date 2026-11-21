import * as Tree from '../Tree'
import { Bookmark, Folder, ItemLocation, TItemLocation } from '../Tree'
import Logger from '../Logger'
import Adapter from '../interfaces/Adapter'

import Ordering from '../interfaces/Ordering'
import {
  UnknownBookmarkUpdateError,
  UnknownCreateTargetError, UnknownFolderOrderError, UnknownFolderUpdateError,
  UnknownMoveOriginError,
  UnknownMoveTargetError
} from '../../errors/Error'
import { BulkImportResource, ICapabilities, IHashSettings } from '../interfaces/Resource'
import { isTest } from '../isTest'

interface IOrderableItem {
  type: string
  id: string | number
}

function itemKey(item: IOrderableItem): string {
  return item.type + ':' + item.id
}

/**
 * The children `order` asks for, in that order, with the children it does not
 * name put back at the indices they have now.
 *
 * An order action routinely names only part of a folder: it comes from a scan
 * of one side, so it says nothing about items that side doesn't have yet, and
 * the items that were removed or moved away in the same sync are taken out of
 * it. The target must not sort the rest to the end for that; they stay where
 * they are, which is also what BrowserTree does with the tabs it doesn't touch.
 * `canOrder` leaves children alone that this folder cannot order, e.g. ones
 * whose parentId says they belong somewhere else.
 *
 * The result is a new array; `children` itself is not modified.
 */
export function applyOrdering<T extends IOrderableItem>(
  children: T[],
  order: IOrderableItem[],
  canOrder: (child: T) => boolean = () => true
): T[] {
  const byKey = new Map<string, T>()
  for (const child of children) {
    const key = itemKey(child)
    if (!byKey.has(key)) {
      byKey.set(key, child)
    }
  }

  const placed = new Set<T>()
  const taken = new Set<string>()
  const ordered: T[] = []
  for (const item of order) {
    const key = itemKey(item)
    if (taken.has(key)) {
      continue
    }
    const child = byKey.get(key)
    if (!child || !canOrder(child)) {
      Logger.log('ORDERFOLDER: skipping item ', item)
      continue
    }
    taken.add(key)
    placed.add(child)
    ordered.push(child)
  }

  children.forEach((child, index) => {
    if (placed.has(child)) {
      return
    }
    ordered.splice(Math.min(index, ordered.length), 0, child)
  })
  return ordered
}

/**
 * Whether two child lists amount to the very same order (by type and id).
 */
export function sameOrdering(a: IOrderableItem[], b: IOrderableItem[]): boolean {
  if (a.length !== b.length) {
    return false
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i].type !== b[i].type || String(a[i].id) !== String(b[i].id)) {
      return false
    }
  }
  return true
}

export default class CachingAdapter implements Adapter, BulkImportResource<TItemLocation> {
  protected highestId: number
  public bookmarksCache: Folder<TItemLocation>
  protected server: any
  protected location: TItemLocation
  protected hashSettings: IHashSettings

  constructor(server: any) {
    this.location = ItemLocation.SERVER
    this.resetCache()
  }

  resetCache() {
    this.highestId = 0
    this.bookmarksCache = new Folder({ id: 0, title: 'root', location: this.location })
  }

  /**
   * Drop the cached hashes of a folder and of all its ancestors.
   *
   * A folder's hash covers its whole subtree, so every change below it makes
   * the hashes along the path to the root stale. In-memory that used to be
   * harmless, because every consumer got a freshly copied, hash-less tree --
   * but NativeTree and the sync cache persist their hashes now, and a stale one
   * makes the scanner conclude that nothing changed at all.
   */
  protected invalidateHashes(folderId: string|number|null|undefined): void {
    if (typeof folderId === 'undefined' || folderId === null) {
      return
    }
    const invalidated = this.bookmarksCache.invalidateHashUpwards(folderId)
    if (invalidated.length) {
      this.onHashesInvalidated(invalidated)
    }
  }

  /**
   * Called with the ids of the folders whose hashes were just dropped, so that
   * subclasses which store their hashes can drop them there as well.
   */
  // eslint-disable-next-line @typescript-eslint/no-empty-function,@typescript-eslint/no-unused-vars
  protected onHashesInvalidated(folderIds: (string|number)[]): void { }

  /**
   * How often the cached tree has been changed.
   *
   * Lets a consumer tell whether anything has happened since it last looked --
   * Account#progressCallback skips persisting a cache that hasn't changed, which
   * for a large account saves a multi-megabyte serialization and storage write
   * on every quiet tick.
   */
  private mutations = 0

  public getMutationCount(): number {
    return this.mutations
  }

  /**
   * Take note that the cached tree was changed. Deliberately separate from the
   * index check below: the two don't belong at the same call sites. Every path
   * that changes anything has to be counted, while the check may only run where
   * structure and index have settled -- and it rebuilds the index as it goes,
   * so adding call sites for it would change behaviour under its flag.
   */
  protected mutated(): void {
    this.mutations++
  }

  /**
   * A no-op unless FLOCCUS_VERIFY_INDEX=true, where it cross-checks the
   * incrementally maintained index against a full rebuild.
   */
  private verifyIndex(operation: string): void {
    this.bookmarksCache.assertIndexConsistent(operation)
  }

  /**
   * The end of a mutation that changed the structure of the tree: it counts as
   * a change, and this is where structure and index have to agree again.
   */
  protected endMutation(operation: string): void {
    this.mutated()
    this.verifyIndex(operation)
  }

  getLabel():string {
    const data = this.getData()
    return data.label || data.username + '@' + new URL(data.url).hostname
  }

  async getBookmarksTree(): Promise<Folder<TItemLocation>> {
    return this.bookmarksCache.copy()
  }

  acceptsBookmark(bm:Bookmark<TItemLocation>):boolean {
    if (bm.url === 'data:') {
      return false
    }
    try {
      let schemes = [
        'https:',
        'http:',
        'ftp:',
        'data:',
        'javascript:',
        'file:',
        'chrome:',
        'edge:',
      ]

      if (!isTest) {
        schemes = schemes.concat([
          'chrome-extension:',
          'moz-extension:',
          'about:'
        ])
      }

      const protocol = new URL(bm.url).protocol
      // Custom protocol handlers, registered by web pages (web+) or by
      // extensions (ext+, e.g. Firefox Multi-Account Containers, #2428)
      return schemes.includes(protocol) || /^(web|ext)\+[a-z]+:$/.test(protocol)
    } catch (e) {
      return false
    }
  }

  async createBookmark(bm:Bookmark<TItemLocation>):Promise<string|number> {
    Logger.log('CREATE', bm)
    bm = bm.restampTree(true, this.location)
    bm.id = ++this.highestId
    const foundFolder = this.bookmarksCache.findFolder(bm.parentId)
    if (!foundFolder) {
      throw new UnknownCreateTargetError()
    }
    foundFolder.children.push(bm)
    this.bookmarksCache.updateIndex(bm)
    this.invalidateHashes(foundFolder.id)
    this.endMutation('createBookmark')
    return bm.id
  }

  async updateBookmark(newBm: Bookmark<TItemLocation>): Promise<void> {
    Logger.log('UPDATE', newBm)
    const foundBookmark = this.bookmarksCache.findBookmark(newBm.id)
    if (!foundBookmark) {
      throw new UnknownBookmarkUpdateError()
    }
    foundBookmark.url = newBm.url
    foundBookmark.title = newBm.title
    // `undefined` means the caller doesn't know about tags (e.g. it came from a
    // resource that doesn't support them) -- don't take that as "no tags".
    if (typeof newBm.tags !== 'undefined') {
      foundBookmark.tags = newBm.tags.slice()
    }
    foundBookmark.invalidateHash()
    this.invalidateHashes(foundBookmark.parentId)
    if (String(foundBookmark.parentId) === String(newBm.parentId)) {
      // The title and the url are changed above, so this is a change of the
      // tree like any other and has to be counted -- but nothing structural
      // happened, so there is no index to check
      this.mutated()
      return
    }
    const foundOldFolder = this.bookmarksCache.findFolder(
      foundBookmark.parentId
    )
    if (!foundOldFolder) {
      throw new UnknownMoveOriginError()
    }
    const foundNewFolder = this.bookmarksCache.findFolder(newBm.parentId)
    if (!foundNewFolder) {
      throw new UnknownMoveTargetError()
    }
    if (foundOldFolder.id !== foundNewFolder.id) {
      foundOldFolder.children.splice(
        foundOldFolder.children.indexOf(foundBookmark),
        1
      )
      this.bookmarksCache.removeFromIndex(foundBookmark)
      foundNewFolder.children.push(foundBookmark)
      foundBookmark.parentId = newBm.parentId
      this.bookmarksCache.updateIndex(foundBookmark)
      this.invalidateHashes(foundNewFolder.id)
    }
    this.endMutation('updateBookmark')
  }

  async removeBookmark(bookmark:Bookmark<TItemLocation>): Promise<void> {
    Logger.log('REMOVE', { bookmark })
    const id = bookmark.id
    const foundBookmark = this.bookmarksCache.findBookmark(id)
    if (!foundBookmark) {
      return
    }
    const foundOldFolder = this.bookmarksCache.findFolder(
      foundBookmark.parentId
    )
    if (!foundOldFolder) {
      return
    }
    foundOldFolder.children.splice(
      foundOldFolder.children.indexOf(foundBookmark),
      1
    )
    this.bookmarksCache.removeFromIndex(foundBookmark)
    this.invalidateHashes(foundOldFolder.id)
    this.endMutation('removeBookmark')
  }

  async createFolder(folder:Folder<TItemLocation>): Promise<string|number> {
    Logger.log('CREATEFOLDER', { folder })
    const newFolder = new Tree.Folder({ id: ++this.highestId, parentId: folder.parentId, title: folder.title, location: this.location })
    const foundParentFolder = this.bookmarksCache.findFolder(newFolder.parentId)
    if (!foundParentFolder) {
      throw new UnknownCreateTargetError()
    }
    foundParentFolder.children.push(newFolder)
    this.bookmarksCache.updateIndex(newFolder)
    this.invalidateHashes(foundParentFolder.id)
    this.endMutation('createFolder')
    return newFolder.id
  }

  async updateFolder(folder:Folder<TItemLocation>): Promise<void> {
    Logger.log('UPDATEFOLDER', { folder })
    const id = folder.id
    const oldFolder = this.bookmarksCache.findFolder(id)
    if (!oldFolder) {
      throw new UnknownFolderUpdateError()
    }

    const foundOldParentFolder = this.bookmarksCache.findFolder(oldFolder.parentId)
    if (!foundOldParentFolder) {
      throw new UnknownMoveOriginError()
    }
    const foundNewParentFolder = this.bookmarksCache.findFolder(folder.parentId)
    if (!foundNewParentFolder) {
      throw new UnknownMoveTargetError()
    }
    if (oldFolder.findFolder(foundNewParentFolder.id)) {
      throw new Error('Detected creation of folder loop: Moving ' + id + ' to ' + folder.parentId + ', but it already contains the new parent node')
    }
    oldFolder.title = folder.title
    // Start at the folder itself: its title is part of its own hash
    this.invalidateHashes(oldFolder.id)
    if (foundOldParentFolder.id !== foundNewParentFolder.id) {
      foundOldParentFolder.children.splice(
        foundOldParentFolder.children.indexOf(oldFolder),
        1
      )
      foundNewParentFolder.children.push(oldFolder)
      this.bookmarksCache.removeFromIndex(oldFolder)
      oldFolder.parentId = folder.parentId
      this.bookmarksCache.updateIndex(oldFolder)
      this.invalidateHashes(foundNewParentFolder.id)
    }
    this.endMutation('updateFolder')
  }

  async orderFolder(id:string|number, order:Ordering<TItemLocation>):Promise<boolean> {
    Logger.log('ORDERFOLDER', { id, order })

    const folder = this.bookmarksCache.findFolder(id)
    if (!folder) {
      throw new UnknownFolderOrderError()
    }
    const newChildren = applyOrdering(
      folder.children,
      order,
      (child) => String(child.parentId) === String(folder.id)
    )
    if (sameOrdering(folder.children, newChildren)) {
      // The order names the children in the order they already have, or only
      // items this folder doesn't hold. Nothing was reordered: counting this as
      // a mutation would drop hashes and persist the tree again, and the
      // reorder stage would hash the whole tree for a commit that has nothing
      // to write.
      return false
    }
    folder.children = newChildren
    this.invalidateHashes(folder.id)
    this.endMutation('orderFolder')
    return true
  }

  async removeFolder(folder:Folder<TItemLocation>):Promise<void> {
    Logger.log('REMOVEFOLDER', { folder })
    const id = folder.id
    const oldFolder = this.bookmarksCache.findFolder(id)
    if (!oldFolder) {
      return
    }
    // root folder doesn't have a parent, yo!
    const foundOldFolder = this.bookmarksCache.findFolder(oldFolder.parentId)
    if (!foundOldFolder) {
      return
    }
    foundOldFolder.children.splice(foundOldFolder.children.indexOf(oldFolder), 1)
    this.bookmarksCache.removeFromIndex(oldFolder)
    this.invalidateHashes(foundOldFolder.id)
    this.endMutation('removeFolder')
  }

  async bulkImportFolder(id:string|number, folder:Folder<TItemLocation>):Promise<Folder<TItemLocation>> {
    Logger.log('BULKIMPORT', { id, folder })
    const foundFolder = this.bookmarksCache.findFolder(id)
    if (!foundFolder) {
      throw new UnknownCreateTargetError()
    }
    // clone and adjust ids
    const imported = folder.restampTree(true, this.location)
    imported.id = id
    await imported.traverse(async(item, parentFolder) => {
      item.id = ++this.highestId
      item.parentId = parentFolder.id
    })
    // insert into tree
    const oldChildren = foundFolder.children
    foundFolder.children = imported.children
    // The replaced children have to leave the index of every folder above,
    // which still lists them, before the imported ones are added
    oldChildren.forEach((child) => this.bookmarksCache.removeFromIndex(child))
    // good as new
    foundFolder.createIndex()
    this.bookmarksCache.updateIndex(foundFolder)
    this.invalidateHashes(foundFolder.id)
    this.endMutation('bulkImportFolder')
    return imported
  }

  setData(data:any):void {
    this.server = { ...data }
  }

  getData():any {
    return { ...this.server }
  }

  // eslint-disable-next-line @typescript-eslint/no-empty-function,@typescript-eslint/no-unused-vars
  async onSyncStart(needLock = true):Promise<void|boolean> { }

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  async onSyncFail():Promise<void> { }

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  async onSyncComplete():Promise<void> { }

  cancel() {
    // noop
  }

  isAvailable(): Promise<boolean> {
    return Promise.resolve(true)
  }

  isAtomic(): boolean {
    return true
  }

  async getCapabilities(): Promise<ICapabilities> {
    return {
      preserveOrder: true,
      hashFn: ['xxhash3', 'murmur3', 'sha256'],
      // The in-memory tree could hold tags just fine, but the file-based
      // adapters built on top of it serialize through formats that drop them,
      // so subclasses opt in explicitly.
      supportsTags: false,
    }
  }

  setHashSettings(hashSettings: IHashSettings): void {
    this.hashSettings = hashSettings
  }
}
