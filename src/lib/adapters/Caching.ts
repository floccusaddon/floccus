import * as Tree from '../Tree'
import { Bookmark, Folder, ItemLocation } from '../Tree'
import Logger from '../Logger'
import Adapter from '../interfaces/Adapter'
import difference from 'lodash/difference'

import url from 'url'
import Ordering from '../interfaces/Ordering'
import {
  MissingItemOrderError,
  UnknownBookmarkUpdateError,
  UnknownCreateTargetError, UnknownFolderItemOrderError, UnknownFolderOrderError, UnknownFolderUpdateError,
  UnknownMoveOriginError,
  UnknownMoveTargetError
} from '../../errors/Error'

export default class CachingAdapter implements Adapter {
  protected highestId: number
  protected bookmarksCache: Folder
  protected server: any
  constructor(server: any) {
    this.resetCache()
  }

  resetCache() {
    this.highestId = 0
    this.bookmarksCache = new Folder({ id: 0, title: 'root', location: ItemLocation.SERVER })
  }

  getLabel():string {
    const data = this.getData()
    return data.username + '@' + url.parse(data.url).hostname
  }

  async getBookmarksTree(): Promise<Folder> {
    return this.bookmarksCache.clone()
  }

  acceptsBookmark(bm:Bookmark):boolean {
    if (bm.url === 'data:') {
      return false
    }
    return Boolean(['https:', 'http:', 'ftp:', 'data:', 'javascript:', 'chrome:'].includes(
      url.parse(bm.url).protocol
    ))
  }

  async createBookmark(bm:Bookmark):Promise<string|number> {
    Logger.log('CREATE', bm)
    bm.id = ++this.highestId
    const foundFolder = this.bookmarksCache.findFolder(bm.parentId)
    if (!foundFolder) {
      throw new UnknownCreateTargetError()
    }
    foundFolder.children.push(bm)
    this.bookmarksCache.createIndex()
    return bm.id
  }

  async updateBookmark(newBm: Bookmark): Promise<void> {
    Logger.log('UPDATE', newBm)
    const foundBookmark = this.bookmarksCache.findBookmark(newBm.id)
    if (!foundBookmark) {
      throw new UnknownBookmarkUpdateError()
    }
    foundBookmark.url = newBm.url
    foundBookmark.title = newBm.title
    if (foundBookmark.parentId === newBm.parentId) {
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
    foundNewFolder.children.push(foundBookmark)
    foundBookmark.parentId = newBm.parentId
    this.bookmarksCache.createIndex()
  }

  async removeBookmark(bookmark:Bookmark): Promise<void> {
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
    this.bookmarksCache.createIndex()
  }

  async createFolder(folder:Folder): Promise<string|number> {
    Logger.log('CREATEFOLDER', { folder })
    const newFolder = new Tree.Folder({ id: ++this.highestId, parentId: folder.parentId, title: folder.title, location: ItemLocation.SERVER })
    const foundParentFolder = this.bookmarksCache.findFolder(newFolder.parentId)
    if (!foundParentFolder) {
      throw new UnknownCreateTargetError()
    }
    foundParentFolder.children.push(newFolder)
    this.bookmarksCache.createIndex()
    return newFolder.id
  }

  async updateFolder(folder:Folder): Promise<void> {
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
    oldFolder.title = folder.title
    oldFolder.parentId = folder.parentId
    this.bookmarksCache.createIndex()
  }

  async orderFolder(id:string|number, order:Ordering):Promise<void> {
    Logger.log('ORDERFOLDER', { id, order })

    const folder = this.bookmarksCache.findFolder(id)
    if (!folder) {
      throw new UnknownFolderOrderError()
    }
    order.forEach(item => {
      const child = folder.findItem(item.type, item.id)
      if (!child || child.parentId !== folder.id) {
        throw new UnknownFolderItemOrderError(id + ':' + JSON.stringify(item))
      }
    })
    folder.children.forEach(child => {
      const item = order.find((item) => item.type === child.type && item.id === child.id)
      if (!item) {
        throw new MissingItemOrderError(
          id + ':' + child.inspect()
        )
      }
    })
    if (order.length !== folder.children.length) {
      const diff = difference(folder.children.map(i => i.id), order.map(i => i.id))
      throw new MissingItemOrderError(id + ':' + JSON.stringify(diff))
    }
    const newChildren = []
    order.forEach(item => {
      const child = folder.findItem(item.type, item.id)
      newChildren.push(child)
    })
    folder.children = newChildren
  }

  async removeFolder(folder:Folder):Promise<void> {
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
    this.bookmarksCache.createIndex()
  }

  async bulkImportFolder(id:string|number, folder:Folder):Promise<Folder> {
    Logger.log('BULKIMPORT', { id, folder })
    const foundFolder = this.bookmarksCache.findFolder(id)
    if (!foundFolder) {
      throw new UnknownCreateTargetError()
    }
    // clone and adjust ids
    const imported = folder.clone()
    imported.id = id
    await imported.traverse(async(item, parentFolder) => {
      item.id = ++this.highestId
      item.parentId = parentFolder.id
    })
    // insert into tree
    foundFolder.children = imported.children
    // good as new
    this.bookmarksCache.createIndex()
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
}
