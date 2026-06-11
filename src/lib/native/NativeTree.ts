import { Preferences as Storage } from '@capacitor/preferences'
import { Bookmark, Folder, ItemLocation } from '../Tree'
import Ordering from '../interfaces/Ordering'
import CachingAdapter from '../adapters/Caching'
import IAccountStorage from '../interfaces/AccountStorage'
import { BulkImportResource, IHashSettings } from '../interfaces/Resource'
import Logger from '../Logger'

export default class NativeTree extends CachingAdapter implements BulkImportResource<typeof ItemLocation.LOCAL> {
  private static saveQueues = new Map<string, Promise<void>>()

  private storage: IAccountStorage
  private readonly accountId: string
  private saveTimeout: ReturnType<typeof setTimeout>
  private loaded = false

  constructor(storage:IAccountStorage) {
    super({})
    this.location = ItemLocation.LOCAL
    this.storage = storage
    this.accountId = this.storage.accountId
    this.resetCache()
  }

  async load():Promise<boolean> {
    const {value: tree} = await Storage.get({key: `bookmarks[${this.accountId}].tree`})
    const {value: highestId} = await Storage.get({key: `bookmarks[${this.accountId}].highestId`})
    if (tree) {
      // Make sure we use xxhash3 if we have to calculate hash for this
      const hashSettings: IHashSettings = {
        preserveOrder: true,
        hashFn: 'xxhash3',
      }
      let oldHash
      if (this.loaded && this.bookmarksCache) {
        oldHash = await this.bookmarksCache.cloneWithLocation(false, this.location).hash(hashSettings)
      }
      this.bookmarksCache = Folder.hydrate(JSON.parse(tree)).copyWithLocation(false, this.location)
      const parsedHighestId = parseInt(highestId ?? '0', 10)
      this.highestId = Number.isNaN(parsedHighestId) ? 0 : parsedHighestId
      if (oldHash && this.loaded) {
        const newHash = await this.bookmarksCache.hash(hashSettings)
        return oldHash !== newHash
      } else {
        this.loaded = true
        return false
      }
    } else {
      await this.save()
      this.loaded = true
      return false
    }
  }

  async saveImmediately(): Promise<void> {
    clearTimeout(this.saveTimeout)
    await this.queueSave()
  }

  async save():Promise<void> {
    await Storage.set({key: `bookmarks[${this.accountId}].tree`, value: JSON.stringify(await this.bookmarksCache.cloneWithLocation(true, ItemLocation.LOCAL).toJSONAsync())})
    await Storage.set({key: `bookmarks[${this.accountId}].highestId`, value: this.highestId + ''})
  }

  private queueSave(): Promise<void> {
    const saveQueue = (NativeTree.saveQueues.get(this.accountId) || Promise.resolve())
      .catch((error) => {
        console.error(error)
      })
      .then(() => this.save())

    NativeTree.saveQueues.set(this.accountId, saveQueue)
    return saveQueue
  }

  triggerSave():void {
    clearTimeout(this.saveTimeout)
    this.saveTimeout = setTimeout(() => {
      this.queueSave().catch(console.error)
    }, 500)
  }

  async getBookmarksTree(): Promise<Folder<typeof ItemLocation.LOCAL>> {
    const tree = await super.getBookmarksTree()
    tree.createIndex()
    return tree as Folder<typeof ItemLocation.LOCAL>
  }

  async createBookmark(bookmark:Bookmark<typeof ItemLocation.LOCAL>): Promise<string|number> {
    const id = await super.createBookmark(bookmark)
    this.triggerSave()
    return id
  }

  async updateBookmark(bookmark:Bookmark<typeof ItemLocation.LOCAL>):Promise<void> {
    // This is a quickfix so we can pass url and title as undefined in the benchmark tests
    const currentBookmark = this.bookmarksCache.findBookmark(bookmark.id)
    const nextBookmark = currentBookmark
      ? new Bookmark({
        ...currentBookmark.toJSON(),
        ...bookmark.toJSON(),
        id:
          typeof bookmark.id === 'undefined'
            ? currentBookmark.id
            : bookmark.id,
        title:
          typeof bookmark.title === 'undefined'
            ? currentBookmark.title
            : bookmark.title,
        url:
          typeof bookmark.url === 'undefined'
            ? currentBookmark.url
            : bookmark.url,
        parentId:
          typeof bookmark.parentId === 'undefined'
            ? currentBookmark.parentId
            : bookmark.parentId,
        tags:
          typeof bookmark.tags === 'undefined'
            ? currentBookmark.tags
            : bookmark.tags,
        location: this.location,
      })
      : bookmark

    await super.updateBookmark(nextBookmark)
    this.triggerSave()
  }

  async removeBookmark(bookmark:Bookmark<typeof ItemLocation.LOCAL>): Promise<void> {
    await super.removeBookmark(bookmark)
    this.triggerSave()
  }

  async createFolder(folder:Folder<typeof ItemLocation.LOCAL>): Promise<string|number> {
    const id = await super.createFolder(folder)
    this.triggerSave()
    return id
  }

  async orderFolder(id:string|number, order:Ordering<typeof ItemLocation.LOCAL>) :Promise<void> {
    Logger.log('(local)ORDERFOLDER', { id, order })
    const folder = this.bookmarksCache.findFolder(id)
    if (!folder) {
      return
    }

    let newChildren = []
    order.forEach((item) => {
      const child = folder.findItem(item.type, item.id)
      if (!child || String(child.parentId) !== String(folder.id)) {
        Logger.log('(local)ORDERFOLDER: skipping item ', item)
        return
      }
      newChildren.push(child)
    })

    const missingChildren = folder.children.filter(
      (child) => !newChildren.includes(child)
    )

    if (missingChildren.length) {
      Logger.log(
        '(local)ORDERFOLDER: restoring missing children',
        missingChildren.map((child) => ({ type: child.type, id: child.id }))
      )
      missingChildren.forEach((child) => {
        const index = folder.children.indexOf(child)
        newChildren = newChildren
          .slice(0, index)
          .concat([child], newChildren.slice(index))
      })
    }

    folder.children = newChildren
    this.triggerSave()
  }

  async updateFolder(folder:Folder<typeof ItemLocation.LOCAL>):Promise<void> {
    await super.updateFolder(folder)
    this.triggerSave()
  }

  async removeFolder(folder:Folder<typeof ItemLocation.LOCAL>):Promise<void> {
    await super.removeFolder(folder)
    this.triggerSave()
  }

  async bulkImportFolder(id: number|string, folder:Folder<typeof ItemLocation.LOCAL>):Promise<Folder<typeof ItemLocation.LOCAL>> {
    const imported = await super.bulkImportFolder(id, folder) as Folder<typeof ItemLocation.LOCAL>
    this.triggerSave()
    return imported
  }

  isAvailable(): Promise<boolean> {
    return Promise.resolve(true)
  }

  isAtomic(): boolean {
    return false
  }
}
