export default class Resource {
  constructor() {
    if (this.constructor === Resource) {
      throw new Error('Cannot instantiate abstract class')
    }
  }

  /**
   * @return Promise<Tree> The bookmarks tree as it is present on the server
   */
  async getBookmarksTree() {
    throw new Error('Not implemented')
  }

  /**
   * @param bookmark:Bookmark the bookmark to create
   * @return int the id of the new bookmark
   */
  async createBookmark(bookmark) {
    throw new Error('Not implemented')
  }

  /**
   * @param bookmark:Bookmark the bookmark with the new data
   * @returns (optional) new id of the bookmark
   */
  async updateBookmark(bookmark) {
    throw new Error('Not implemented')
  }

  /**
   * @param bookmark:Bookmark the bookmark to delete
   */
  async removeBookmark(bookmark) {
    throw new Error('Not implemented')
  }

  /**
   * @param folder:Folder the new folder
   * @return Promise<int> the id of the new folder
   */
  async createFolder(folder) {
    throw new Error('Not implemented')
  }

  /**
   * @param folder:Folder the folder to be updated
   */
  async updateFolder(folder) {
    throw new Error('Not implemented')
  }

  /**
   * @param id:Folder the folder
   */
  async removeFolder(folder) {
    throw new Error('Not implemented')
  }
}
