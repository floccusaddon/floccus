import browser from './browser-api'
import Bookmark from './Bookmark'
import Account from './Account'

export default class Tree {
  constructor(rootId, storage) {
    this.rootId = rootId
    this.storage = storage
  }

  async getLocalIdOf(bookmark) {
    var localId = bookmark.localId
    if (!localId) {
      let mappings = await this.storage.getMappings()
      localId = mappings.ServerToLocal[bookmark.id]
    }
    bookmark.localId = localId
    return localId
  }
  
  async getIdFromLocalId(localId) {
    return (await this.storage.getMappings()).LocalToServer[localId]
  }

  async createNode(bookmark) {
		console.log('CREATE', bookmark)

    if (await this.getLocalIdOf(bookmark)) {
      throw new Error('trying to create a node for a bookmark that already has one')
    }

    const parentId = await this.mkdirpPath(bookmark.path)
		const node = await browser.bookmarks.create({parentId, title: bookmark.title, url: bookmark.url})
    await this.storage.addToMappings(node.id, bookmark.id)
    return node
  }

  async updateNode(bookmark) {
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

  async removeNode(bookmark) {
		console.log('DELETE', bookmark)
    
    if (!(await this.getLocalIdOf(bookmark))) {
      throw new Error('trying to remove a node of a bookmark that has none')
    }

		await browser.bookmarks.remove(bookmark.localId)
    await this.storage.removeFromMappings(bookmark.localId)
  }

  async getBookmarkByLocalId(localId) {
    const node = (await browser.bookmarks.getSubTree(localId))[0]
    const path = await this.getPathFromLocalId(node.parentId)
    var id
    try {
      id = await this.getIdFromLocalId(localId)
    }catch(e) {
      // id = undefined
    }
    return new Bookmark(id, localId, node.url, node.title, path)
  }
  
  async getPathFromLocalId(localId) {
    var ancestors = await Tree.getIdPathFromLocalId(localId)
    
    const containingAccount = await Account.getAccountContainingLocalId(localId, ancestors) 
    if (this.storage.accountId !== containingAccount.id) {
      throw new Error('This Bookmark does not belong to the current account')
    }
    
    if (this.root !== '-1') {
      // Non-global account
      ancestors = ancestors.slice(ancestors.indexOf(this.rootId)+1)
    }

    return '/' + (await Promise.all(
      ancestors
      .map(async ancestor => { 
        let bms = await browser.bookmarks.getSubTree(localId)
        let bm = bms[0]
        return encodeURIComponent(bm.title)
      })
    )).join('/')
  }

  async mkdirpPath(path) {
    const accountsInfo = await Account.getAccountsInfo()
    return await Tree.mkdirpPath(path, this.rootId, accountsInfo)
  }

  static async mkdirpPath(path, rootId, accountsInfo) {
    let root = (await browser.bookmarks.getSubTree(rootId))[0]
    let pathSegment = path.split('/')[1]
    let nextPath = path.substr(('/'+pathSegment).length)
    let title = decodeURIComponent(pathSegment)

    if (!Array.isArray(root.children)) {
      throw new Error('given path root is not a folder')
    }
    if (path == '/') {
      return root.id
    }
    let child
    child = root.children
      .filter(bm => bm.title == title)
      .filter(bm => !!bm.children)
      [0]
    if (!child) child = await browser.bookmarks.create({parentId: rootId, title})
    if (accountsInfo.accounts.some(acc => acc.localRoot === child.id)) {
      throw new Error('New path conflicts with existing nested floccus folder. Aborting.')
    }
    return await Tree.mkdirpPath(nextPath, child.id, accountsInfo)
  }
  
  async getAllNodes() {
    const tree = (await browser.bookmarks.getSubTree(this.rootId))[0]
    const accountsInfo = await Account.getAccountsInfo()
    const recurse = (root) => {
      if (accountsInfo.accounts.some(acc => acc.localRoot === root.id && root.id !== this.rootId)) {
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

  static async getIdPathFromLocalId(localId, path) {
    path = path || []
    if (!localId) {
      return path
    }
    path.unshift(localId)
    let bms = await browser.bookmarks.getSubTree(localId)
    let bm = bms[0]
    return await this.getIdPathFromLocalId(bm.parentId, path)
  }
}
