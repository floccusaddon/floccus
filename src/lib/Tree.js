import Crypto from './Crypto'

export class Bookmark {
  constructor({ id, parentId, url, title }) {
    this.id = id
    this.parentId = parentId
    this.url = url
    this.title = title
  }

  async hash() {
    if (!this.hashValue) {
      this.hashValue = Crypto.murmur2(
        JSON.stringify({
          url: this.url,
          title: this.title
        })
      )
    }
    return this.hashValue
  }

  static hydrate(obj) {
    return new Bookmark(obj)
  }
}

export class Folder {
  constructor({ id, parentId, title, children }) {
    this.id = id
    this.parentId = parentId
    this.title = title
    this.children = children || []
  }

  findFolder(id) {
    const folderFound = this.children
      .filter(child => child instanceof Folder)
      .filter(folder => folder.id == id)[0]
    if (folderFound) {
      return folderFound
    }
    // traverse sub folders
    return this.children
      .filter(child => child instanceof Folder)
      .map(folder => folder.findFolder(id))
      .filter(folder => !!folder)[0]
  }

  findBookmark(id) {
    const bookmarkFound = this.children
      .filter(child => child instanceof Bookmark)
      .filter(bm => bm.id == id)[0]
    if (bookmarkFound) {
      return bookmarkFound
    }
    // traverse sub folders
    return this.children
      .filter(child => child instanceof Folder)
      .map(folder => folder.findBookmark(id))
      .filter(Bookmark => !!Bookmark)[0]
  }

  async hash() {
    if (!this.hashValue) {
      this.hashValue = Crypto.murmur2(
        JSON.stringify({
          children: Promise.all(this.children.map(child => child.hash())),
          title: this.title,
          parentId: this.parentId
        })
      )
    }
    return this.hashValue
  }

  static hydrate(obj) {
    return new Folder({
      ...obj,
      children: obj.children
        ? obj.children.map(child => {
            if (!child.url) {
              return Folder.hydrate(child)
            } else {
              return Bookmark.hydrate(child)
            }
          })
        : null
    })
  }
}
