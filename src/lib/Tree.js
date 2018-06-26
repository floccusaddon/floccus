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
        JSON.stringify([
          this.url,
          this.title
        ])
      )
    }
    return this.hashValue
  }

  clone() {
    return new Bookmark(this)
  }

  createIndex() {
    return { [this.id]: this }
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
    if (this.id === id) {
      return this
    }

    if (this.index) {
      return this.index.folders[id]
    }

    // traverse sub folders
    return this.children
      .filter(child => child instanceof Folder)
      .map(folder => folder.findFolder(id))
      .filter(folder => !!folder)[0]
  }

  findBookmark(id) {
    if (this.index) {
      return this.index.bookmarks[id]
    }
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
      .filter(bookmark => !!bookmark)[0]
  }

  async hash() {
    if (!this.hashValue) {
      this.hashValue = Crypto.murmur2(
        JSON.stringify([
          await Promise.all(this.children.map(child => child.hash())),
          this.title
        ])
      )
    }
    return this.hashValue
  }

  clone() {
    return new Folder({
      ...this,
      children: this.children.map(child => child.clone())
    })
  }

  createIndex() {
    this.index = {
      folders: { [this.id]: this },
      bookmarks: Object.assign(
        {},
        { [this.id]: this },
        this.children
          .filter(child => child instanceof Bookmark)
          .reduce((obj, child) => {
            obj[child.id] = child
            return obj
          }, {})
      )
    }

    this.children
      .filter(child => child instanceof Folder)
      .map(child => child.createIndex())
      .forEach(subIndex => {
        Object.assign(this.index.folders, subIndex.folders)
        Object.assign(this.index.bookmarks, subIndex.bookmarks)
      })
    return this.index
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
