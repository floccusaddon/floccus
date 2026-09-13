import { expect } from './utils'
import { Bookmark, Folder, ItemLocation } from '../lib/Tree'
import CachingTreeWrapper from '../lib/CachingTreeWrapper'
import NativeTree from '../lib/native/NativeTree'

function accountStorageStub(accountId) {
  return { accountId }
}

function newAccountId() {
  return 'test' + Date.now() + Math.random()
}

/**
 * The parts of an item that the live tree and the cache have to agree on.
 */
function simplify(item) {
  if (item instanceof Folder) {
    return {
      type: 'folder',
      id: item.id,
      title: item.title,
      children: item.children.map(simplify),
    }
  }
  return {
    type: 'bookmark',
    id: item.id,
    parentId: item.parentId,
    title: item.title,
    url: item.url,
  }
}

function subtree(parentId, folderCount, bookmarksPerFolder) {
  // The ids here are the source's, not the ones the import will hand out
  let id = 1000
  return new Folder({
    id: parentId,
    title: 'imported',
    location: ItemLocation.LOCAL,
    children: Array.from({ length: folderCount }, (_, f) => new Folder({
      id: ++id,
      title: 'folder' + f,
      location: ItemLocation.LOCAL,
      children: Array.from({ length: bookmarksPerFolder }, (_, b) => new Bookmark({
        id: ++id,
        title: 'bookmark' + f + '-' + b,
        url: 'http://example.com/' + f + '/' + b,
        location: ItemLocation.LOCAL,
      })),
    })),
  })
}

describe('CachingTreeWrapper', function() {
  this.timeout(20000)

  let innerTree, wrapper, rootId

  beforeEach('set up a wrapped native tree', async function() {
    innerTree = new NativeTree(accountStorageStub(newAccountId()))
    await innerTree.load()
    wrapper = new CachingTreeWrapper(innerTree)
    rootId = (await wrapper.getBookmarksTree()).id
  })

  describe('bulk import', function() {
    it('should expose bulkImportFolder when the wrapped tree has it', async function() {
      expect('bulkImportFolder' in wrapper).to.equal(true)
    })

    it('should not expose bulkImportFolder when the wrapped tree lacks it', async function() {
      // The sync strategy picks the bulk path with `'bulkImportFolder' in resource`,
      // so a tree that can't bulk import must not appear to be able to
      const plainTree = { ...innerTree, isAvailable: () => Promise.resolve(true) }
      delete plainTree.bulkImportFolder
      expect('bulkImportFolder' in new CachingTreeWrapper(plainTree)).to.equal(false)
    })

    it('should import the subtree into the live tree', async function() {
      const imported = await wrapper.bulkImportFolder(rootId, subtree(rootId, 3, 2))

      const live = await wrapper.getBookmarksTree()
      // The returned folder stands in for the target, so only its children are
      // what the import put there
      expect(simplify(live).children).to.deep.equal(simplify(imported).children)
      expect(live.count()).to.equal(6)
      expect(live.countFolders()).to.equal(4)
    })

    it('should mirror the import into the cache under the very same ids', async function() {
      const imported = await wrapper.bulkImportFolder(rootId, subtree(rootId, 3, 2))

      const live = await wrapper.getBookmarksTree()
      const cache = await wrapper.getCacheTree()
      expect(simplify(cache)).to.deep.equal(simplify(live))
      expect(simplify(cache).children).to.deep.equal(simplify(imported).children)
    })

    it('should import a subtree larger than one nextcloud chunk in one go', async function() {
      // NativeTree replaces a folder's children rather than adding to them, so the
      // strategy must never chunk an import into it -- guard the size that would
      // have tempted it to (see Default#executeCreate)
      const imported = await wrapper.bulkImportFolder(rootId, subtree(rootId, 4, 40))

      const live = await wrapper.getBookmarksTree()
      expect(live.count()).to.equal(160)
      expect(simplify(await wrapper.getCacheTree()).children).to.deep.equal(simplify(imported).children)
    })

    it('should replace the children the folder had before', async function() {
      await wrapper.createBookmark(new Bookmark({
        parentId: rootId,
        title: 'old',
        url: 'http://example.com/old',
        location: ItemLocation.LOCAL,
      }))

      await wrapper.bulkImportFolder(rootId, subtree(rootId, 1, 1))

      const live = await wrapper.getBookmarksTree()
      const cache = await wrapper.getCacheTree()
      expect(live.children.some((child) => child.title === 'old')).to.equal(false)
      expect(simplify(cache)).to.deep.equal(simplify(live))
    })

    it('should not reissue the imported ids for items created afterwards', async function() {
      const imported = await wrapper.bulkImportFolder(rootId, subtree(rootId, 2, 2))
      const importedIds = new Set()
      await imported.traverse((item) => importedIds.add(String(item.id)))

      const id = await wrapper.createFolder(new Folder({
        parentId: rootId,
        title: 'afterwards',
        location: ItemLocation.LOCAL,
      }))

      expect(importedIds.has(String(id))).to.equal(false)
      const cache = await wrapper.getCacheTree()
      expect(cache.findFolder(id).title).to.equal('afterwards')
      expect(simplify(cache)).to.deep.equal(simplify(await wrapper.getBookmarksTree()))
    })

    it('should keep the cache out of later changes to the live tree', async function() {
      const imported = await wrapper.bulkImportFolder(rootId, subtree(rootId, 1, 1))
      // The live tree keeps the items it handed back, so hold on to the title
      // rather than to the item
      const bookmarkId = imported.children[0].children[0].id
      const titleAsImported = imported.children[0].children[0].title

      // Straight at the live tree, the way a UI edit reaches it during a sync
      await innerTree.updateBookmark(new Bookmark({
        ...imported.children[0].children[0].toJSON(),
        title: 'changed behind the sync\'s back',
      }))

      const cache = await wrapper.getCacheTree()
      expect(cache.findBookmark(bookmarkId).title).to.equal(titleAsImported)
    })
  })
})
