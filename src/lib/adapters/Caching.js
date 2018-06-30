import * as Tree from '../Tree'
import { Folder, Bookmark } from '../Tree'
import Adapter from '../Adapter'

export default class CachingAdapter extends Adapter {
  constructor(server) {
    super()
    this.highestId = 0
    this.bookmarksCache = new Folder ({id: 0, title: 'root'});
  }

  getLabel() {
    let data = this.getData()
    return data.username + '@' + data.url
  }

  async getBookmarksTree() {
    return this.bookmarksCache.clone()
  }

  async createBookmark(bm) {
    console.log('CREATE', bm)
    bm.id = ++this.highestId
    const foundFolder = this.bookmarksCache.findFolder(bm.parentId)
    if (!foundFolder) {
      throw new Error("Folder to create in doesn't exist")
    }
    foundFolder.children.push(bm) // TODO: respect order
    return bm.id
  }

  async updateBookmark(newBm) {
    console.log('UPDATE', newBm)
    const foundBookmark = this.bookmarksCache.findBookmark(newBm.id)
    if (!foundBookmark) {
      throw new Error("Bookmark to update doesn't exist anymore")
    }
    foundBookmark.url = newBm.url
    foundBookmark.title = newBm.title
    if (foundBookmark.parentId !== newBm.parentId) {
      const foundOldFolder = this.bookmarksCache.findFolder(
        foundBookmark.parentId
      )
      if (!foundOldFolder) {
        throw new Error(
          "Folder to move out of doesn't exist. This is an anomaly. Congratulations."
        )
      }
      const foundNewFolder = this.bookmarksCache.findFolder(newBm.parentId)
      if (!foundNewFolder) {
        throw new Error("Folder to move into doesn't exist")
      }
      foundOldFolder.children.splice(
        foundOldFolder.children.indexOf(foundBookmark),
        1
      )
      foundNewFolder.children.push(foundBookmark) // TODO: respect order
      foundBookmark.parentId = newBm.parentId
    }
  }

  async removeBookmark(id) {
    console.log('REMOVE', { id })
    const foundBookmark = this.bookmarksCache.findBookmark(id)
    if (!foundBookmark) {
      throw new Error("Bookmark to remove doesn't exist anymore")
    }
    const foundOldFolder = this.bookmarksCache.findFolder(
      foundBookmark.parentId
    )
    if (!foundOldFolder) {
      throw new Error("Folder to move out of doesn't exist")
    }
    foundOldFolder.children.splice(
      foundOldFolder.children.indexOf(foundBookmark),
      1
    )
  }

  /**
   * @param parentId:int the id of the parent node of the new folder
   * @param title:string the title of the folder
   * @return Promise<int> the id of the new folder
   */
  async createFolder(parentId, title) {
    console.log('CREATEFOLDER', { parentId, title })
    const folder = new Tree.Folder({ parentId, title })
    folder.id = ++this.highestId
    const foundParentFolder = this.bookmarksCache.findFolder(parentId)
    if (!foundParentFolder) {
      throw new Error("Folder to create in doesn't exist")
    }
    foundParentFolder.children.push(folder) // TODO: respect order
    return folder.id
  }

  /**
   * @param id:int the id of the folder to be updated
   * @param title:string the new title
   */
  async updateFolder(id, title) {
    console.log('UPDATEFOLDER', { id, title })
    const folder = this.bookmarksCache.findFolder(id)
    if (!folder) {
      throw new Error("Folder to move doesn't exist")
    }
    folder.title = title
  }

  /**
   * @param id:int the id of the folder
   * @param newParentId:int the id of the new folder
   */
  async moveFolder(id, newParent) {
    console.log('MOVEFOLDER', { id, newParent })
    const folder = this.bookmarksCache.findFolder(id)
    if (!folder) {
      throw new Error("Folder to move doesn't exist")
    }
    const foundOldFolder = this.bookmarksCache.findFolder(folder.parentId)
    if (!foundOldFolder) {
      throw new Error("Folder to move out of doesn't exist")
    }
    const foundNewFolder = this.bookmarksCache.findFolder(newParentId)
    if (!foundNewFolder) {
      throw new Error("Folder to move into doesn't exist")
    }
    foundOldFolder.children.splice(foundOldFolder.children.indexOf(folder), 1)
    foundNewFolder.children.push(folder) // TODO: respect order
  }

  /**
   * @param id:int the id of the folder
   */
  async removeFolder(id) {
    console.log('REMOVEFOLDER', { id })
    const folder = this.bookmarksCache.findFolder(id)
    if (!folder) {
      throw new Error("Folder to remove doesn't exist")
    }
    const foundOldFolder = this.bookmarksCache.findFolder(folder.parentId)
    if (!foundOldFolder) {
      throw new Error("Parent folder to remove folder from of doesn't exist")
    }
    foundOldFolder.children.splice(foundOldFolder.children.indexOf(folder), 1)
  }

  setData(data) {
    this.server = { ...data }
  }

  getData() {
    return { ...this.server }
  }
}
