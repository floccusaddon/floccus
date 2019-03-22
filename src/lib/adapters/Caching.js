import * as Tree from '../Tree'
import Logger from '../Logger'
import { Folder, Bookmark } from '../Tree'
import Adapter from '../Adapter'
const url = require('url')

export default class CachingAdapter extends Adapter {
  constructor(server) {
    super()
    this.highestId = 0
    this.bookmarksCache = new Folder({ id: 0, title: 'root' })
  }

  getLabel() {
    let data = this.getData()
    return data.username + '@' + url.parse(data.url).hostname
  }

  async getBookmarksTree() {
    return this.bookmarksCache.clone()
  }

  async createBookmark(bm) {
    Logger.log('CREATE', bm)
    bm.id = ++this.highestId
    const foundFolder = this.bookmarksCache.findFolder(bm.parentId)
    if (!foundFolder) {
      throw new Error("Folder to create in doesn't exist")
    }
    foundFolder.children.push(bm)
    this.bookmarksCache.createIndex()
    return bm.id
  }

  async updateBookmark(newBm) {
    Logger.log('UPDATE', newBm)
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
      this.bookmarksCache.createIndex()
    }
  }

  async removeBookmark(id) {
    Logger.log('REMOVE', { id })
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

  /**
   * @param parentId:int the id of the parent node of the new folder
   * @param title:string the title of the folder
   * @return Promise<int> the id of the new folder
   */
  async createFolder(parentId, title) {
    Logger.log('CREATEFOLDER', { parentId, title })
    const folder = new Tree.Folder({ parentId, title })
    folder.id = ++this.highestId
    const foundParentFolder = this.bookmarksCache.findFolder(parentId)
    if (!foundParentFolder) {
      throw new Error("Folder to create in doesn't exist")
    }
    foundParentFolder.children.push(folder)
    this.bookmarksCache.createIndex()
    return folder.id
  }

  /**
   * @param id:int the id of the folder to be updated
   * @param title:string the new title
   */
  async updateFolder(id, title) {
    Logger.log('UPDATEFOLDER', { id, title })
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
  async moveFolder(id, newParentId) {
    Logger.log('MOVEFOLDER', { id, newParentId })
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
    foundNewFolder.children.push(folder)
    folder.parentId = newParentId
    this.bookmarksCache.createIndex()
  }

  async orderFolder(id, order) {
    Logger.log('ORDERFOLDER', { id, order })

    let folder = this.bookmarksCache.findFolder(id)
    if (!folder) {
      throw new Error('Could not find folder to order')
    }
    order.forEach(item => {
      let child
      if (item.type === 'folder') {
        child = folder.findFolder(item.id)
      } else {
        child = folder.findBookmark(item.id)
      }
      if (!child || child.parentId !== folder.id) {
        throw new Error(
          'Item in folder ordering is not an actual child: ' +
            JSON.stringify(item)
        )
      }
    })
    if (order.length !== folder.children.length) {
      throw new Error(
        "Folder ordering is missing some of the folder's children"
      )
    }
    const newChildren = []
    order.forEach(item => {
      let child
      if (item.type === 'folder') {
        child = folder.findFolder(item.id)
      } else {
        child = folder.findBookmark(item.id)
      }
      newChildren.push(child)
    })
    folder.children = newChildren
  }

  /**
   * @param id:int the id of the folder
   */
  async removeFolder(id) {
    Logger.log('REMOVEFOLDER', { id })
    const folder = this.bookmarksCache.findFolder(id)
    if (!folder) {
      throw new Error("Folder to remove doesn't exist")
    }
    // root folder doesn't have a parent, yo!
    const foundOldFolder = this.bookmarksCache.findFolder(folder.parentId)
    if (!foundOldFolder) {
      throw new Error("Parent folder to remove folder from of doesn't exist")
    }
    foundOldFolder.children.splice(foundOldFolder.children.indexOf(folder), 1)
    this.bookmarksCache.createIndex()
  }

  setData(data) {
    this.server = { ...data }
  }

  getData() {
    return { ...this.server }
  }
}
