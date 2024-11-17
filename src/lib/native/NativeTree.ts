import { Preferences as Storage } from '@capacitor/preferences'
import { Bookmark, Folder, ItemLocation, TItemLocation } from '../Tree'
import Ordering from '../interfaces/Ordering'
import CachingAdapter from '../adapters/Caching'
import IAccountStorage from '../interfaces/AccountStorage'
import { BulkImportResource } from '../interfaces/Resource'

export default class NativeTree extends CachingAdapter implements BulkImportResource<typeof ItemLocation.LOCAL> {
  protected location: TItemLocation = ItemLocation.LOCAL

  private storage: IAccountStorage
  private readonly accountId: string
  private saveTimeout: any

  constructor(storage:IAccountStorage) {
    super({})
    this.storage = storage
    this.accountId = this.storage.accountId
  }

  async load():Promise<boolean> {
    const {value: tree} = await Storage.get({key: `bookmarks[${this.accountId}].tree`})
    const {value: highestId} = await Storage.get({key: `bookmarks[${this.accountId}].highestId`})
    if (tree) {
      const oldHash = this.bookmarksCache && await this.bookmarksCache.cloneWithLocation(false, this.location).hash(true)
      this.bookmarksCache = Folder.hydrate(JSON.parse(tree)).clone(false)
      const newHash = await this.bookmarksCache.hash(true)
      this.highestId = parseInt(highestId)
      return oldHash && oldHash !== newHash
    } else {
      await this.save()
      return false
    }
  }

  async save():Promise<void> {
    await Storage.set({key: `bookmarks[${this.accountId}].tree`, value: JSON.stringify(this.bookmarksCache.cloneWithLocation(true, ItemLocation.LOCAL))})
    await Storage.set({key: `bookmarks[${this.accountId}].highestId`, value: this.highestId + ''})
  }

  triggerSave():void {
    clearTimeout(this.saveTimeout)
    this.saveTimeout = setTimeout(() => {
      this.save()
    }, 500)
  }

  async getBookmarksTree(): Promise<Folder<typeof ItemLocation.LOCAL>> {
    const tree = await super.getBookmarksTree()
    tree.createIndex()
    return tree as Folder<typeof ItemLocation.LOCAL>
  }

  async createBookmark(bookmark:Bookmark<typeof ItemLocation.LOCAL>): Promise<string|number> {
    this.triggerSave()
    return super.createBookmark(bookmark)
  }

  async updateBookmark(bookmark:Bookmark<typeof ItemLocation.LOCAL>):Promise<void> {
    this.triggerSave()
    return super.updateBookmark(bookmark)
  }

  async removeBookmark(bookmark:Bookmark<typeof ItemLocation.LOCAL>): Promise<void> {
    this.triggerSave()
    return super.removeBookmark(bookmark)
  }

  async createFolder(folder:Folder<typeof ItemLocation.LOCAL>): Promise<string|number> {
    this.triggerSave()
    return super.createFolder(folder)
  }

  async orderFolder(id:string|number, order:Ordering<typeof ItemLocation.LOCAL>) :Promise<void> {
    this.triggerSave()
    return super.orderFolder(id, order)
  }

  async updateFolder(folder:Folder<typeof ItemLocation.LOCAL>):Promise<void> {
    this.triggerSave()
    return super.updateFolder(folder)
  }

  async removeFolder(folder:Folder<typeof ItemLocation.LOCAL>):Promise<void> {
    this.triggerSave()
    return super.removeFolder(folder)
  }

  async bulkImportFolder(id: number|string, folder:Folder<typeof ItemLocation.LOCAL>):Promise<Folder<typeof ItemLocation.LOCAL>> {
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
    return this.bookmarksCache.findFolder(id) as Folder<typeof ItemLocation.LOCAL>
  }

  isAvailable(): Promise<boolean> {
    return Promise.resolve(true)
  }
}
