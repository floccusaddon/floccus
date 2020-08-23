import Crypto from './Crypto'
import Logger from './Logger'

const Parallel = require('async-parallel')

const STRANGE_PROTOCOLS = ['data:', 'javascript:', 'about:', 'chrome:']

export class Bookmark {
  constructor({ id, parentId, url, title, hashValue }) {
    this.type = 'bookmark'
    this.id = id
    this.parentId = parentId
    this.title = title
    this.hashValue = hashValue || {}

    // not a regular bookmark
    if (STRANGE_PROTOCOLS.some(proto => url.indexOf(proto) === 0)) {
      this.url = url
      return
    }

    try {
      let urlObj = new URL(url)
      this.url = urlObj.href
    } catch (e) {
      Logger.log('Failed to normalize', url)
      this.url = url
    }
  }

  canMergeWith(otherItem) {
    return this.type === otherItem.type && this.url === otherItem.url
  }

  async hash() {
    if (!this.hashValue) {
      this.hashValue = await Crypto.sha256(
        JSON.stringify({ title: this.title, url: this.url })
      )
    }
    return this.hashValue
  }

  clone(withHash) {
    return new Bookmark({...this, ...(!withHash && { hashValue: {} })})
  }

  createIndex() {
    return { [this.id]: this }
  }

  inspect(depth) {
    return (
      Array(depth)
        .fill('  ')
        .join('') +
      `- #${this.id}[${this.title}](${this.url}) parentId: ${this.parentId}`
    )
  }

  visitCreate(syncProcess, ...args) {
    return syncProcess.createBookmark(...args)
  }

  visitUpdate(syncProcess, ...args) {
    return syncProcess.updateBookmark(...args)
  }

  visitRemove(syncProcess, ...args) {
    return syncProcess.removeBookmark(...args)
  }

  static hydrate(obj) {
    return new Bookmark(obj)
  }
}

export class Folder {
  constructor({ id, parentId, title, children, hashValue, dateGroupModified }) {
    this.type = 'folder'
    this.id = id
    this.parentId = parentId
    this.title = title
    this.children = children || []
    this.hashValue = hashValue || {}
    this.dateGroupModified = dateGroupModified || null
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
      .filter(bm => String(bm.id) === String(id))[0]
    if (bookmarkFound) {
      return bookmarkFound
    }
    // traverse sub folders
    return this.children
      .filter(child => child instanceof Folder)
      .map(folder => folder.findBookmark(id))
      .filter(bookmark => !!bookmark)[0]
  }

  findItem(type, id) {
    if (type === 'folder') {
      return this.findFolder(id)
    } else {
      return this.findBookmark(id)
    }
  }

  async traverse(fn) {
    await Parallel.each(this.children, async item => {
      await fn(item, this)
      if (item.type === 'folder') {
        await item.traverse(fn)
      }
    })
  }

  canMergeWith(otherItem) {
    return this.type === otherItem.type && this.title === otherItem.title
  }

  async hash(preserveOrder) {
    if (this.hashValue && this.hashValue[preserveOrder]) {
      return this.hashValue[preserveOrder]
    }
    let children = this.children.slice()
    if (!preserveOrder) {
      // only re-sort unless we sync the order of the children as well
      children.sort((c1, c2) => {
        if (c1.title < c2.title) {
          return -1
        }
        if (c2.title < c1.title) {
          return 1
        }
        return 0
      })
    }
    if (!this.hashValue) this.hashValue = {}
    this.hashValue[preserveOrder] = await Crypto.sha256(
      JSON.stringify({
        title: this.title,
        children: await Parallel.map(
          this.children,
          child => child.hash(preserveOrder),
          1
        )
      })
    )
    return this.hashValue[preserveOrder]
  }

  clone(withHash) {
    return new Folder({
      ...this,
      ...(!withHash && { hashValue: {} }),
      children: this.children.map(child => child.clone(withHash))
    })
  }

  count() {
    if (!this.index) {
      this.createIndex()
    }
    return Object.keys(this.index.bookmarks).length
  }

  countFolders() {
    if (!this.index) {
      this.createIndex()
    }
    return Object.keys(this.index.folders).length
  }

  createIndex() {
    this.index = {
      folders: { [this.id]: this },
      bookmarks: Object.assign(
        {},
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

  inspect(depth) {
    return (
      Array(depth)
        .fill('  ')
        .join('') +
      `+ #${this.id}[${this.title}] parentId: ${this.parentId}, hash: ${this
        .hashValue[true] || this.hashValue[false]}\n` +
      this.children
        .map(child =>
          child && child.inspect ? child.inspect(depth + 1) : String(child)
        )
        .join('\n')
    )
  }

  visitCreate(syncProcess, ...args) {
    return syncProcess.createFolder(...args)
  }

  visitUpdate(syncProcess, ...args) {
    return syncProcess.updateFolder(...args)
  }

  visitRemove(syncProcess, ...args) {
    return syncProcess.removeFolder(...args)
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
