import browser from './browser-api'
import Bookmark from './Bookmark'
import Account from './Account'
import AsyncLock from 'async-lock'

const treeLock = new AsyncLock()
const reverseStr = (str) => str.split('').reverse().join('')

export default class Tree {
  constructor (storage, rootId, serverRoot) {
    this.rootId = rootId
    this.serverRoot = serverRoot
    this.storage = storage
  }

  async load (mappings, cache) {
    this.mappings = mappings || await this.storage.getMappings()
    this.cache = cache || await this.storage.getCache()
    await this.loadBookmarks()
    this.markDirty()
  }

  async markDirty () {
    return Promise.all(
      Object.values(this.bookmarks)
        .map(async bookmark => {
          const treeHash = await bookmark.hash()
          const cacheHash = this.cache[bookmark.localId]
          if (treeHash !== cacheHash) {
            bookmark.dirty = true
          }
        })
    )
  }

  async loadBookmarks () {
    const tree = (await browser.bookmarks.getSubTree(this.rootId))[0]
    const allAccounts = await Account.getAllAccounts()

    this.bookmarks = {}
    const recurse = (node, parentPath) => {
      if (allAccounts.some(acc => acc.getData().localRoot === node.id && node.id !== this.rootId)) {
        // This is the root folder of a different account
        // (the user has apparently nested them *facepalm* -- how nice of us to take care of that)
        return
      }
      if (!node.children) {
        this.bookmarks[node.id] = new Bookmark(this.mappings.LocalToServer[node.id]
          , node.id
          , node.url
          , node.title
          , parentPath
        )
        return
      }
      const descendantPath = parentPath + '/' + node.title.replace(/[/]/g, '\\/') // other paths don't have a trailing slash
      node.children.map((node) => recurse(node, descendantPath))
    }
    tree.children.forEach(node => recurse(node, this.serverRoot))
  }

  getBookmarkByLocalId (localId) {
    return this.bookmarks[localId]
  }

  getBookmarkById (id) {
    const localId = this.mappings.ServerToLocal[id]
    if (!localId) return
    return this.bookmarks[localId]
  }

  getAllBookmarks () {
    return Object.keys(this.bookmarks)
  }

  async createNode (bookmark) {
    console.log('CREATE', bookmark)

    if (this.getBookmarkById(bookmark.id)) {
      throw new Error('trying to create a node for a bookmark that already has one')
    }

    const parentId = await this.mkdirpPath(bookmark.getLocalPath(this.serverRoot))
    const node = await browser.bookmarks.create({
      parentId
      , title: bookmark.title
      , url: bookmark.url
    })
    bookmark.localId = node.id
    this.bookmarks[bookmark.localId] = bookmark
    await this.storage.addToMappings(bookmark)
    return node
  }

  async updateNode (bookmark) {
    console.log('LOCALUPDATE', bookmark)

    if (!this.getBookmarkById(bookmark.id)) {
      throw new Error('trying to update a node of a bookmark that has none')
    }

    await browser.bookmarks.update(bookmark.localId, {
      title: bookmark.title
      , url: bookmark.url
    })
    const parentId = await this.mkdirpPath(bookmark.getLocalPath(this.serverRoot))
    await browser.bookmarks.move(bookmark.localId, {parentId})
  }

  async removeNode (bookmark) {
    console.log('DELETE', bookmark)

    if (!this.getBookmarkByLocalId(bookmark.localId)) {
      throw new Error('trying to remove a node of a bookmark that has none')
    }

    await browser.bookmarks.remove(bookmark.localId)
    await this.storage.removeFromMappings(bookmark.localId)
  }

  async removeOrphanedFolders () {
    const tree = (await browser.bookmarks.getSubTree(this.rootId))[0]
    const allAccounts = await Account.getAllAccounts()

    const recurse = async (parentPath, node) => {
      if (allAccounts.some(acc => acc.getData().localRoot === node.id && node.id !== this.rootId)) {
        // This is the root folder of a different account
        // (the user has apparently nested them *facepalm* -- how nice of us to take care of that)
        return
      }
      if (!node.children) {
        return
      }
      const descendantPath = parentPath + '/' + node.title.replace(/[/]/g, '\\/')

      await Promise.all(
        node.children
          .map((node) => recurse(descendantPath, node))
      )

      const children = await browser.bookmarks.getChildren(node.id)
      if (!children.length && node.id !== this.rootId && parentPath !== '/') {
        console.log('Remove orphaned folder: ' + descendantPath)
        await browser.bookmarks.remove(node.id)
      }
    }
    await recurse('', tree)
  }

  async getAllNodes () {
    const tree = (await browser.bookmarks.getSubTree(this.rootId))[0]
    const allAccounts = await Account.getAllAccounts()
    const recurse = (root) => {
      if (allAccounts.some(acc => acc.getData().localRoot === root.id && root.id !== this.rootId)) {
        // This is the root folder of a different account
        // (the user has apparently nested them *facepalm* -- how nice of us to take care of that)
        return []
      }
      if (!root.children) return [root]
      return root.children
        .map(recurse)
        .reduce((desc1, desc2) => desc1.concat(desc2), [])
    }
    return recurse(tree)
  }

  static async getPathFromLocalId (localId, ancestors, relativeToRoot) {
    ancestors = ancestors || await Tree.getIdPathFromLocalId(localId)

    if (relativeToRoot) {
      ancestors = ancestors.slice(ancestors.indexOf(relativeToRoot) + 1)
    }

    return (await Promise.all(
      ancestors
        .map(async ancestor => {
          try {
            let bms = await browser.bookmarks.get(ancestor)
            let bm = bms[0]
            return bm.title.replace(/[/]/g, '\\/')
          } catch (e) {
            return 'Error!'
          }
        })
    )).join('/')
  }

  async mkdirpPath (path) {
    const allAccounts = await Account.getAllAccounts()
    return Tree.mkdirpPath(path, this.rootId, allAccounts)
  }

  static async mkdirpPath (path, rootId, allAccounts) {
    if (path === '/' || path === '') {
      return rootId
    }

    let pathArr = reverseStr(path)
      .split(/[/](?![\\])/)
      .reverse()
      .map(str => reverseStr(str))
    let pathSegment = pathArr[1]
    let title = pathSegment.replace(/[\\][/]/g, '/')

    let child = await treeLock.acquire(rootId, async () => {
      let children = await browser.bookmarks.getChildren(rootId)
      let childrenWithRightName = children.filter(bm => bm.title === title)
      for (var i = 0; i < childrenWithRightName.length; i++) {
        let subChildren = await browser.bookmarks.getChildren(childrenWithRightName[i].id)
        if (subChildren.length) {
          return childrenWithRightName[i]
        }
      }
      return browser.bookmarks.create({parentId: rootId, title})
    })
    if (allAccounts.some(acc => acc.getData().localRoot === child.id)) {
      throw new Error('New path conflicts with existing nested floccus folder. Aborting.')
    }
    return Tree.mkdirpPath('/' + pathArr.slice(2).join('/'), child.id, allAccounts)
  }

  static async getIdPathFromLocalId (localId, path) {
    path = path || []
    if (!localId) {
      return path
    }
    path.unshift(localId)
    let bms = await browser.bookmarks.get(localId)
    let bm = bms[0]
    if (bm.parentId === localId) {
      return path // might be that the root is circular
    }
    return this.getIdPathFromLocalId(bm.parentId, path)
  }
}
