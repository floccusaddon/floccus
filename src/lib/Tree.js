import browser from './browser-api'
import Bookmark from './Bookmark'
import Account from './Account'

const reverseStr = (str) => str.split('').reverse().join('')

export default class Tree {
  constructor (rootId, storage) {
    this.rootId = rootId
    this.storage = storage
  }

  async getLocalIdOf (bookmark) {
    var localId = bookmark.localId
    if (!localId) {
      let mappings = await this.storage.getMappings()
      localId = mappings.ServerToLocal[bookmark.id]
    }
    bookmark.localId = localId
    return localId
  }

  async getIdFromLocalId (localId) {
    return (await this.storage.getMappings()).LocalToServer[localId]
  }

  async createNode (bookmark) {
    console.log('CREATE', bookmark)

    if (await this.getLocalIdOf(bookmark)) {
      throw new Error('trying to create a node for a bookmark that already has one')
    }

    const parentId = await this.mkdirpPath(bookmark.path)
    const node = await browser.bookmarks.create({
      parentId
      , title: bookmark.title
      , url: bookmark.url
    })
    bookmark.localId = node.id
    await this.storage.addToMappings(bookmark)
    return node
  }

  async updateNode (bookmark) {
    console.log('LOCALUPDATE', bookmark)

    if (!(await this.getLocalIdOf(bookmark))) {
      throw new Error('trying to remove a node of a bookmark that has none')
    }

    await browser.bookmarks.update(bookmark.localId, {
      title: bookmark.title
      , url: bookmark.url
    })
    const parentId = await this.mkdirpPath(bookmark.path)
    await browser.bookmarks.move(bookmark.localId, {parentId})
  }

  async removeNode (bookmark) {
    console.log('DELETE', bookmark)

    if (!(await this.getLocalIdOf(bookmark))) {
      throw new Error('trying to remove a node of a bookmark that has none')
    }

    await browser.bookmarks.remove(bookmark.localId)
    await this.storage.removeFromMappings(bookmark.localId)
  }

  async getBookmarkByLocalId (localId) {
    const node = (await browser.bookmarks.getSubTree(localId))[0]
    const path = await this.getPathFromLocalId(node.parentId)
    var id
    try {
      id = await this.getIdFromLocalId(localId)
    } catch (e) {
      // id = undefined
    }
    return new Bookmark(id, localId, node.url, node.title, path)
  }

  async getPathFromLocalId (localId) {
    var ancestors = await Tree.getIdPathFromLocalId(localId)

    const containingAccount = await Account.getAccountContainingLocalId(localId, ancestors)
    if (!containingAccount || this.storage.accountId !== containingAccount.id) {
      throw new Error('This Bookmark does not belong to the current account')
    }
    return Tree.getPathFromLocalId(localId, ancestors, this.rootId)
  }

  static async getPathFromLocalId (localId, ancestors, relativeToRoot) {
    ancestors = ancestors || await Tree.getIdPathFromLocalId(localId)

    if (relativeToRoot) {
      ancestors = ancestors.slice(ancestors.indexOf(relativeToRoot) + 1)
    }

    return '/' + (await Promise.all(
      ancestors
        .map(async ancestor => {
          try {
            let bms = await browser.bookmarks.getSubTree(ancestor)
            let bm = bms[0]
            return bm.title.replace('/', '\\/')
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
    let root = (await browser.bookmarks.getSubTree(rootId))[0]
    let pathArr = reverseStr(path)
      .split(/[/](?![\\])/)
      .reverse()
      .map(str => reverseStr(str))
    let pathSegment = pathArr[1]
    let title = pathSegment.replace('\\/', '/')

    if (!Array.isArray(root.children)) {
      throw new Error('given path root is not a folder')
    }
    if (path === '/' || path === '') {
      return root.id
    }
    let child
    child = root.children
      .filter(bm => bm.title === title)
      .filter(bm => !!bm.children)[0]
    if (!child) child = await browser.bookmarks.create({parentId: rootId, title})
    if (allAccounts.some(acc => acc.getData().localRoot === child.id)) {
      throw new Error('New path conflicts with existing nested floccus folder. Aborting.')
    }
    return Tree.mkdirpPath('/' + pathArr.slice(2).join('/'), child.id, allAccounts)
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

  static async getIdPathFromLocalId (localId, path) {
    path = path || []
    if (!localId) {
      return path
    }
    path.unshift(localId)
    let bms = await browser.bookmarks.getSubTree(localId)
    let bm = bms[0]
    return this.getIdPathFromLocalId(bm.parentId, path)
  }
}
