import { Preferences as Storage } from '@capacitor/preferences'
import { Bookmark, Folder, ItemLocation } from '../Tree'
import Ordering from '../interfaces/Ordering'
import CachingAdapter from '../adapters/Caching'
import IAccountStorage from '../interfaces/AccountStorage'
import { BulkImportResource } from '../interfaces/Resource'

export default class NativeTree extends CachingAdapter implements BulkImportResource {
  private tree: Folder
  private storage: IAccountStorage
  private readonly accountId: string
  private saveTimeout: any

  constructor(storage:IAccountStorage) {
    super({})
    this.storage = storage
    this.accountId = this.storage.accountId
  }

  async load():Promise<void> {
    const {value: tree} = await Storage.get({key: `bookmarks[${this.accountId}].tree`})
    const {value: highestId} = await Storage.get({key: `bookmarks[${this.accountId}].highestId`})
    if (tree) {
      this.bookmarksCache = Folder.hydrate(JSON.parse(tree))
      this.highestId = parseInt(highestId)
    } else {
      await this.save()
    }
  }

  async save():Promise<void> {
    await Storage.set({key: `bookmarks[${this.accountId}].tree`, value: JSON.stringify(this.bookmarksCache.clone(true, ItemLocation.LOCAL))})
    await Storage.set({key: `bookmarks[${this.accountId}].highestId`, value: this.highestId + ''})
  }

  triggerSave():void {
    clearTimeout(this.saveTimeout)
    this.saveTimeout = setTimeout(() => {
      this.save()
    }, 500)
  }

  async getBookmarksTree(): Promise<Folder> {
    const tree = await super.getBookmarksTree()
    tree.createIndex()
    return tree
  }

  async createBookmark(bookmark:Bookmark): Promise<string|number> {
    this.triggerSave()
    return super.createBookmark(bookmark)
  }

  async updateBookmark(bookmark:Bookmark):Promise<void> {
    this.triggerSave()
    return super.updateBookmark(bookmark)
  }

  async removeBookmark(bookmark:Bookmark): Promise<void> {
    this.triggerSave()
    return super.removeBookmark(bookmark)
  }

  async createFolder(folder:Folder): Promise<string|number> {
    this.triggerSave()
    return super.createFolder(folder)
  }

  async orderFolder(id:string|number, order:Ordering) :Promise<void> {
    this.triggerSave()
    return super.orderFolder(id, order)
  }

  async updateFolder(folder:Folder):Promise<void> {
    this.triggerSave()
    return super.updateFolder(folder)
  }

  async removeFolder(folder:Folder):Promise<void> {
    this.triggerSave()
    return super.removeFolder(folder)
  }

  async bulkImportFolder(id: number|string, folder:Folder):Promise<Folder> {
    await Promise.all(folder.children.map(async child => {
      child.parentId = id
      if (child instanceof Bookmark) {
        await super.createBookmark(child)
      }
      if (child instanceof Folder) {
        const folderId = await super.createFolder(child)
        await this.bulkImportFolder(folderId, child)
      }
    }))
    return this.bookmarksCache.findFolder(id)
  }
}
