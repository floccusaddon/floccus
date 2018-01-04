import browser from './browser-api'
import Bookmark from './Bookmark'

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

    const parentId = await Tree.mkdirpPath(bookmark.path, this.rootId)
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
    if (localId === this.rootId) return '/'
    let bms = await browser.bookmarks.getSubTree(localId)
    let bm = bms[0]
    let path = await this.getPathFromLocalId(bm.parentId)
    
    return path + encodeURIComponent(bm.title)+'/'
  }

  async mkdirpPath(path) {
    return await Tree.mkdirpPath(path, this.rootId)
  }

  static async mkdirpPath(path, rootId) {
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
    return await Bookmark.mkdirpPath(nextPath, child.id)
  }
  
  async getAllNodes() {
    var tree = (await browser.bookmarks.getSubTree(this.rootId))[0]
    const recurse = (root) => {
      if (!root.children) return [root]
      return root.children
        .map(recurse)
        .reduce((desc1, desc2) => desc1.concat(desc2), [])
    }
    return recurse(tree)
  }

}
