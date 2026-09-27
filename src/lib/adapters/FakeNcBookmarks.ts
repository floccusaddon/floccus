import CachingAdapter from './Caching'
import { Bookmark, Folder, TItemLocation } from '../Tree'

export default class FakeNcBookmarksAdapter extends CachingAdapter {
  constructor(server) {
    super(server)
    this.server = server
  }

  static getDefaultValues() {
    return {
      type: 'fake-nc-bookmarks',
    }
  }

  setData(data) {
    this.server = data
  }

  getData() {
    return JSON.parse(JSON.stringify(this.server))
  }

  getLabel() {
    return 'Fake Nextcloud Bookmarks account (floccus)'
  }

  /**
   * This adapter stands in for nextcloud-bookmarks, where every action hits the
   * server as its own request: an interrupted sync leaves partial state behind
   * and the next one has to resume from a continuation. CachingAdapter, which we
   * inherit the tree handling from, is atomic instead -- so say so explicitly.
   */
  isAtomic(): boolean {
    return false
  }

  async createBookmark(bm: Bookmark<TItemLocation>): Promise<string | number> {
    const id = await super.createBookmark(bm)
    const storedBm = this.bookmarksCache.findBookmark(id)
    storedBm.id = `${id};${storedBm.parentId}`
    this.bookmarksCache.createIndex()
    return storedBm.id
  }

  async updateBookmark(newBm: Bookmark<TItemLocation>): Promise<void> {
    await super.updateBookmark(newBm)
    const id = newBm.id
    const storedBm = this.bookmarksCache.findBookmark(id)
    const [idFirstPart] = String(id).split(';')
    storedBm.id = `${idFirstPart};${storedBm.parentId}`
    this.bookmarksCache.createIndex()
    newBm.id = storedBm.id
  }

  // Like nextcloud-bookmarks' import endpoint, bulkImportFolder adds to the
  // folder, so Default#executeCreate imports large subtrees in chunks here too
  bulkImportAppendsChildren = true

  async bulkImportFolder(
    id: number | string,
    folder: Folder<TItemLocation>
  ): Promise<Folder<TItemLocation>> {
    const importedIds = new Set<string>()
    await Promise.all(
      folder.children.map(async(child) => {
        child.parentId = id
        if (child instanceof Bookmark) {
          importedIds.add(String(await this.createBookmark(child)))
        }
        if (child instanceof Folder) {
          const folderId = await this.createFolder(child)
          importedIds.add(String(folderId))
          await this.bulkImportFolder(folderId, child)
        }
      })
    )
    this.bookmarksCache.createIndex()
    // The endpoint answers with what it imported, not the whole folder
    const imported = this.bookmarksCache.findFolder(id).copy(false)
    imported.children = imported.children.filter(
      (child) => importedIds.has(String(child.id))
    )
    return imported
  }
}
