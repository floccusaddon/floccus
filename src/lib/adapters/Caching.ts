import * as Tree from '../Tree'
import { Bookmark, Folder, ItemLocation, TItemLocation } from '../Tree'
import Logger from '../Logger'
import Adapter from '../interfaces/Adapter'
import difference from 'lodash/difference'

import Ordering from '../interfaces/Ordering'
import {
  UnknownBookmarkUpdateError,
  UnknownCreateTargetError, UnknownFolderItemOrderError, UnknownFolderOrderError, UnknownFolderUpdateError,
  UnknownMoveOriginError,
  UnknownMoveTargetError
} from '../../errors/Error'
import { BulkImportResource, ICapabilities, IHashSettings } from '../interfaces/Resource'
import { isTest } from '../isTest'

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

      return Boolean(schemes.includes(
        new URL(bm.url).protocol
      ))
    } catch (e) {
      return false
    }
  }

  async createBookmark(bm:Bookmark<TItemLocation>):Promise<string|number> {
    Logger.log('CREATE', bm)
    bm = bm.copyWithLocation(true, this.location)
    bm.id = ++this.highestId
    const foundFolder = this.bookmarksCache.findFolder(bm.parentId)
    if (!foundFolder) {
      throw new UnknownCreateTargetError()
    }
    foundFolder.children.push(bm)
    this.bookmarksCache.updateIndex(bm)
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
    if (String(foundBookmark.parentId) === String(newBm.parentId)) {
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
    foundOldFolder.children.splice(
      foundOldFolder.children.indexOf(foundBookmark),
      1
    )

    this.bookmarksCache.removeFromIndex(foundBookmark)
    foundNewFolder.children.push(foundBookmark)
    foundBookmark.parentId = newBm.parentId
    this.bookmarksCache.updateIndex(foundBookmark)
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
    foundOldParentFolder.children.splice(foundOldParentFolder.children.indexOf(oldFolder), 1)
    foundNewParentFolder.children.push(oldFolder)
    this.bookmarksCache.removeFromIndex(oldFolder)
    oldFolder.title = folder.title
    oldFolder.parentId = folder.parentId
    this.bookmarksCache.updateIndex(oldFolder)
  }

  async orderFolder(id:string|number, order:Ordering<TItemLocation>):Promise<void> {
    Logger.log('ORDERFOLDER', { id, order })

    const folder = this.bookmarksCache.findFolder(id)
    if (!folder) {
      throw new UnknownFolderOrderError()
    }
    let newChildren = []
    order.forEach(item => {
      const child = folder.findItem(item.type, item.id)
      if (!child || String(child.parentId) !== String(folder.id)) {
        throw new UnknownFolderItemOrderError(id + ':' + JSON.stringify(item))
      }
      newChildren.push(child)
    })
    const diff = difference(folder.children.map(i => i.type + ':' + i.id), order.map(i => i.type + ':' + i.id))
    if (diff.length) {
      Logger.log('Folder ordering is missing some of the folders children (moving on): ' + id + ':' + JSON.stringify(diff))
      // We don't just append at the end but put them back where they were
      // In order to be in line with BrowserTree
      diff.forEach(item => {
        const [type, id] = item.split(':')
        const child = folder.findItem(type, id)
        if (!child) return
        const index = folder.children.indexOf(child)
        newChildren = newChildren.slice(0, index).concat([child], newChildren.slice(index))
      })
    }
    folder.children = newChildren
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
  }

  async bulkImportFolder(id:string|number, folder:Folder<TItemLocation>):Promise<Folder<TItemLocation>> {
    Logger.log('BULKIMPORT', { id, folder })
    const foundFolder = this.bookmarksCache.findFolder(id)
    if (!foundFolder) {
      throw new UnknownCreateTargetError()
    }
    // clone and adjust ids
    const imported = folder.copyWithLocation(true, this.location)
    imported.id = id
    await imported.traverse(async(item, parentFolder) => {
      item.id = ++this.highestId
      item.parentId = parentFolder.id
    })
    // insert into tree
    foundFolder.children = imported.children
    // good as new
    foundFolder.createIndex()
    this.bookmarksCache.updateIndex(foundFolder)
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
    }
  }

  setHashSettings(hashSettings: IHashSettings): void {
    this.hashSettings = hashSettings
  }
}
