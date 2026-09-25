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

  describe('persisting the cache', function() {
    /**
     * What Account#sync used to do on every progress tick: copy the cache tree,
     * filter it, serialize the copy. getCacheTreeJSON has to come out the same.
     */
    async function theOldWay(accepts) {
      const cache = await wrapper.getCacheTree()
      const filter = (folder) => {
        let changed = false
        folder.children = folder.children.filter((child) => {
          if (child instanceof Bookmark) {
            const accepted = accepts(child)
            changed = changed || !accepted
            return accepted
          }
          changed = filter(child) || changed
          return true
        })
        if (changed) {
          folder.invalidateHash()
        }
        return changed
      }
      filter(cache)
      return cache.toJSON()
    }

    it('starts out dirty, because storage holds an earlier sync\'s cache', function() {
      expect(wrapper.isCacheDirty()).to.equal(true)
    })

    it('is clean once the revision it was at has been persisted', async function() {
      wrapper.markCachePersisted(wrapper.getCacheRevision())
      expect(wrapper.isCacheDirty()).to.equal(false)
    })

    it('goes dirty again on every kind of change to the cached tree', async function() {
      wrapper.markCachePersisted(wrapper.getCacheRevision())

      const folderId = await wrapper.createFolder(new Folder({ id: 0, parentId: rootId, title: 'f', location: ItemLocation.LOCAL }))
      expect(wrapper.isCacheDirty()).to.equal(true)

      wrapper.markCachePersisted(wrapper.getCacheRevision())
      const bookmarkId = await wrapper.createBookmark(new Bookmark({ id: 0, parentId: folderId, title: 'b', url: 'http://example.com/b', location: ItemLocation.LOCAL }))
      expect(wrapper.isCacheDirty()).to.equal(true)

      wrapper.markCachePersisted(wrapper.getCacheRevision())
      await wrapper.updateBookmark(new Bookmark({ id: bookmarkId, parentId: folderId, title: 'b2', url: 'http://example.com/b', location: ItemLocation.LOCAL }))
      expect(wrapper.isCacheDirty()).to.equal(true)

      wrapper.markCachePersisted(wrapper.getCacheRevision())
      await wrapper.bulkImportFolder(folderId, subtree(folderId, 1, 1))
      expect(wrapper.isCacheDirty()).to.equal(true)

      wrapper.markCachePersisted(wrapper.getCacheRevision())
      await wrapper.removeFolder(new Folder({ id: folderId, parentId: rootId, title: 'f', location: ItemLocation.LOCAL }))
      expect(wrapper.isCacheDirty()).to.equal(true)
    })

    it('stays dirty when the change landed after the revision being written was read', async function() {
      // What Account#progressCallback does: read the revision, serialize, write,
      // and only then record what went to storage. A change in between must not
      // be swallowed by that record.
      const revision = wrapper.getCacheRevision()
      await wrapper.createFolder(new Folder({ id: 0, parentId: rootId, title: 'raced', location: ItemLocation.LOCAL }))
      wrapper.markCachePersisted(revision)
      expect(wrapper.isCacheDirty()).to.equal(true)
    })

    it('serializes to what the copy-filter-serialize path produced', async function() {
      await wrapper.bulkImportFolder(rootId, subtree(rootId, 2, 3))
      expect(wrapper.getCacheTreeJSON()).to.deep.equal(await theOldWay(() => true))
    })

    it('drops the bookmarks the server refuses, as the old path did', async function() {
      await wrapper.bulkImportFolder(rootId, subtree(rootId, 2, 3))
      const accepts = (bm) => !bm.url.endsWith('/0/0')

      const json = wrapper.getCacheTreeJSON(accepts)
      expect(json).to.deep.equal(await theOldWay(accepts))

      const urls = []
      const walk = (folder) => folder.children.forEach((child) => child.children ? walk(child) : urls.push(child.url))
      walk(json)
      expect(urls).to.have.lengthOf(5)
      expect(urls.some((url) => url.endsWith('/0/0'))).to.equal(false)
    })

    it('drops the cached hash of every folder above a dropped bookmark', async function() {
      await wrapper.bulkImportFolder(rootId, subtree(rootId, 2, 3))
      // Give every folder a hash, the way a sync's scanner leaves them behind
      const hashed = await wrapper.getCacheTree()
      await hashed.hash({ preserveOrder: false, hashFn: 'murmur3' })
      await wrapper.setCacheTree(hashed)

      const json = wrapper.getCacheTreeJSON((bm) => !bm.url.endsWith('/0/0'))
      // bulkImportFolder splices the subtree's children straight into the root
      const touched = json.children[0]
      const untouched = json.children[1]

      // The folder that lost it, and every folder above it, up to the root
      expect(touched.hashValue).to.deep.equal({})
      expect(json.hashValue).to.deep.equal({})
      // ...and nothing else: a sibling's subtree didn't change
      expect(Object.keys(untouched.hashValue || {})).to.have.lengthOf.above(0)
    })

    it('leaves the cached tree alone, unlike the filtering it replaces', async function() {
      await wrapper.bulkImportFolder(rootId, subtree(rootId, 1, 2))
      const before = simplify(await wrapper.getCacheTree())

      wrapper.getCacheTreeJSON(() => false)

      expect(simplify(await wrapper.getCacheTree())).to.deep.equal(before)
    })
  })
})
