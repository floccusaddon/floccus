import { expect } from './utils'
import { Preferences as Storage } from '@capacitor/preferences'
import { Bookmark, Folder, hashCacheKey, ItemLocation } from '../lib/Tree'
import NativeTree from '../lib/native/NativeTree'
import NativeAccountStorage from '../lib/native/NativeAccountStorage'

function accountStorageStub(accountId) {
  return { accountId }
}

function newAccountId() {
  return 'test' + Date.now() + Math.random()
}

/**
 * The parts of an item that the row storage is supposed to preserve.
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
    tags: item.tags,
  }
}

describe('Native SQLite storage', function() {
  this.timeout(20000)

  describe('bookmark tree', function() {
    let accountId, tree, rootId

    beforeEach('set up a tree', async function() {
      accountId = newAccountId()
      tree = new NativeTree(accountStorageStub(accountId))
      await tree.load()
      rootId = (await tree.getBookmarksTree()).id
    })

    async function reload() {
      const reloaded = new NativeTree(accountStorageStub(accountId))
      await reloaded.load()
      return reloaded
    }

    async function expectRoundTrip() {
      const before = await tree.getBookmarksTree()
      const after = await (await reload()).getBookmarksTree()
      expect(simplify(after)).to.deep.equal(simplify(before))
    }

    function bookmark(parentId, title, url, tags) {
      return new Bookmark({ parentId, title, url, tags, location: ItemLocation.LOCAL })
    }

    it('should restore folders and bookmarks including tags', async function() {
      const folderId = await tree.createFolder(
        new Folder({ parentId: rootId, title: 'foo', location: ItemLocation.LOCAL })
      )
      const subFolderId = await tree.createFolder(
        new Folder({ parentId: folderId, title: 'bar', location: ItemLocation.LOCAL })
      )
      await tree.createBookmark(bookmark(folderId, 'url1', 'http://ex.com/one'))
      await tree.createBookmark(bookmark(subFolderId, 'url2', 'http://ex.com/two', ['a', 'b']))
      await tree.createBookmark(bookmark(rootId, 'url3', 'http://ex.com/three'))

      await expectRoundTrip()
    })

    it('should not hand out ids again that were used before a reload', async function() {
      const folderId = await tree.createFolder(
        new Folder({ parentId: rootId, title: 'foo', location: ItemLocation.LOCAL })
      )
      const bookmarkId = await tree.createBookmark(bookmark(folderId, 'url1', 'http://ex.com/one'))

      const reloaded = await reload()
      const newId = await reloaded.createBookmark(bookmark(folderId, 'url2', 'http://ex.com/two'))

      expect(String(newId)).to.not.equal(String(bookmarkId))
      expect(String(newId)).to.not.equal(String(folderId))
    })

    it('should preserve the order of a folder\'s children', async function() {
      const first = await tree.createBookmark(bookmark(rootId, 'url1', 'http://ex.com/one'))
      const second = await tree.createFolder(
        new Folder({ parentId: rootId, title: 'foo', location: ItemLocation.LOCAL })
      )
      const third = await tree.createBookmark(bookmark(rootId, 'url3', 'http://ex.com/three'))

      await tree.orderFolder(rootId, [
        { type: 'bookmark', id: third },
        { type: 'bookmark', id: first },
        { type: 'folder', id: second },
      ])

      const after = await (await reload()).getBookmarksTree()
      expect(after.children.map((child) => String(child.id))).to.deep.equal(
        [third, first, second].map(String)
      )
      await expectRoundTrip()
    })

    it('should persist an updated bookmark', async function() {
      const folderId = await tree.createFolder(
        new Folder({ parentId: rootId, title: 'foo', location: ItemLocation.LOCAL })
      )
      const bookmarkId = await tree.createBookmark(bookmark(rootId, 'url1', 'http://ex.com/one', ['a']))

      await tree.updateBookmark(new Bookmark({
        id: bookmarkId,
        parentId: folderId,
        title: 'url1 (edited)',
        url: 'http://ex.com/one-edited',
        tags: ['b', 'c'],
        location: ItemLocation.LOCAL,
      }))

      const after = await (await reload()).getBookmarksTree()
      const moved = after.findBookmark(bookmarkId)
      expect(moved.title).to.equal('url1 (edited)')
      expect(moved.url).to.equal('http://ex.com/one-edited')
      expect(moved.tags).to.deep.equal(['b', 'c'])
      expect(String(moved.parentId)).to.equal(String(folderId))
      await expectRoundTrip()
    })

    it('should persist a moved and renamed folder', async function() {
      const folderId = await tree.createFolder(
        new Folder({ parentId: rootId, title: 'foo', location: ItemLocation.LOCAL })
      )
      const otherId = await tree.createFolder(
        new Folder({ parentId: rootId, title: 'other', location: ItemLocation.LOCAL })
      )
      await tree.createBookmark(bookmark(folderId, 'url1', 'http://ex.com/one'))

      await tree.updateFolder(new Folder({
        id: folderId,
        parentId: otherId,
        title: 'foo (renamed)',
        location: ItemLocation.LOCAL,
      }))

      const after = await (await reload()).getBookmarksTree()
      const moved = after.findFolder(folderId)
      expect(moved.title).to.equal('foo (renamed)')
      expect(String(moved.parentId)).to.equal(String(otherId))
      expect(moved.children).to.have.length(1)
      await expectRoundTrip()
    })

    it('should remove a folder with everything below it', async function() {
      const folderId = await tree.createFolder(
        new Folder({ parentId: rootId, title: 'foo', location: ItemLocation.LOCAL })
      )
      const subFolderId = await tree.createFolder(
        new Folder({ parentId: folderId, title: 'bar', location: ItemLocation.LOCAL })
      )
      const bookmarkId = await tree.createBookmark(bookmark(subFolderId, 'url1', 'http://ex.com/one'))
      await tree.createBookmark(bookmark(rootId, 'url2', 'http://ex.com/two'))

      await tree.removeFolder(new Folder({ id: folderId, parentId: rootId, location: ItemLocation.LOCAL }))

      const after = await (await reload()).getBookmarksTree()
      expect(after.findFolder(folderId)).to.not.be.ok
      expect(after.findFolder(subFolderId)).to.not.be.ok
      expect(after.findBookmark(bookmarkId)).to.not.be.ok
      expect(after.children).to.have.length(1)
      await expectRoundTrip()
    })

    it('should keep the tree when the root folder is removed', async function() {
      const folderId = await tree.createFolder(
        new Folder({ parentId: rootId, title: 'foo', location: ItemLocation.LOCAL })
      )
      await tree.createBookmark(bookmark(folderId, 'url1', 'http://ex.com/one'))

      // CachingAdapter ignores this, because the root has no parent to be
      // removed from -- so the rows must survive it as well
      await tree.removeFolder(await tree.getBookmarksTree())

      await expectRoundTrip()
      const after = await (await reload()).getBookmarksTree()
      expect(after.findFolder(folderId)).to.be.ok
    })

    it('should report whether a reload brought changes', async function() {
      await tree.createBookmark(bookmark(rootId, 'url1', 'http://ex.com/one'))
      expect(await tree.load()).to.equal(false)

      const other = await reload()
      await other.createBookmark(bookmark(rootId, 'url2', 'http://ex.com/two'))

      expect(await tree.load()).to.equal(true)
      expect((await tree.getBookmarksTree()).children).to.have.length(2)
    })

    it('should persist a bulk import', async function() {
      const folderId = await tree.createFolder(
        new Folder({ parentId: rootId, title: 'foo', location: ItemLocation.LOCAL })
      )
      await tree.createBookmark(bookmark(folderId, 'replaced', 'http://ex.com/replaced'))

      await tree.bulkImportFolder(folderId, new Folder({
        id: folderId,
        parentId: rootId,
        title: 'foo',
        location: ItemLocation.LOCAL,
        children: [
          bookmark(folderId, 'url1', 'http://ex.com/one'),
          new Folder({
            parentId: folderId,
            title: 'bar',
            location: ItemLocation.LOCAL,
            children: [bookmark(null, 'url2', 'http://ex.com/two', ['x'])],
          }),
        ],
      }))

      const after = await (await reload()).getBookmarksTree()
      const imported = after.findFolder(folderId)
      expect(imported.children.map((child) => child.title)).to.deep.equal(['url1', 'bar'])
      expect(imported.children[1].children.map((child) => child.title)).to.deep.equal(['url2'])
      await expectRoundTrip()
    })

    it('should import a tree that is still stored as JSON in the preferences', async function() {
      const legacyAccountId = newAccountId()
      const root = new Folder({ id: 0, title: 'root', location: ItemLocation.LOCAL })
      const folder = new Folder({ id: 1, parentId: 0, title: 'foo', location: ItemLocation.LOCAL })
      folder.children = [
        new Bookmark({ id: 2, parentId: 1, title: 'url1', url: 'http://ex.com/one', tags: ['a'], location: ItemLocation.LOCAL }),
      ]
      root.children = [
        folder,
        new Bookmark({ id: 3, parentId: 0, title: 'url2', url: 'http://ex.com/two', location: ItemLocation.LOCAL }),
      ]
      await Storage.set({
        key: `bookmarks[${legacyAccountId}].tree`,
        value: JSON.stringify(root.toJSON()),
      })
      await Storage.set({ key: `bookmarks[${legacyAccountId}].highestId`, value: '3' })

      const migrated = new NativeTree(accountStorageStub(legacyAccountId))
      await migrated.load()

      expect(simplify(await migrated.getBookmarksTree())).to.deep.equal(simplify(root))
      expect((await Storage.get({ key: `bookmarks[${legacyAccountId}].tree` })).value).to.not.be.ok

      // The migrated tree must keep handing out fresh ids
      const newId = await migrated.createBookmark(bookmark(1, 'url3', 'http://ex.com/three'))
      expect(Number(newId)).to.be.above(3)
    })
  })

  describe('folder hashes', function() {
    const SETTINGS = { preserveOrder: true, hashFn: 'xxhash3', syncTags: true }
    const CACHE_KEY = hashCacheKey(SETTINGS)

    let accountId, tree, rootId

    beforeEach('set up a hashed tree', async function() {
      accountId = newAccountId()
      tree = new NativeTree(accountStorageStub(accountId))
      await tree.load()
      tree.setHashSettings(SETTINGS)
      rootId = (await tree.getBookmarksTree()).id
    })

    async function reload() {
      const reloaded = new NativeTree(accountStorageStub(accountId))
      await reloaded.load()
      reloaded.setHashSettings(SETTINGS)
      return reloaded
    }

    function bookmark(parentId, title, url, tags) {
      return new Bookmark({ parentId, title, url, tags, location: ItemLocation.LOCAL })
    }

    async function setUpTree() {
      const folderId = await tree.createFolder(
        new Folder({ parentId: rootId, title: 'foo', location: ItemLocation.LOCAL })
      )
      const subFolderId = await tree.createFolder(
        new Folder({ parentId: folderId, title: 'bar', location: ItemLocation.LOCAL })
      )
      const bookmarkId = await tree.createBookmark(bookmark(subFolderId, 'url1', 'http://ex.com/one'))
      await tree.createBookmark(bookmark(rootId, 'url2', 'http://ex.com/two'))
      await tree.save()
      return { folderId, subFolderId, bookmarkId }
    }

    /**
     * The stored hashes have to describe what is actually stored -- a hash that
     * outlived a change would make the scanner believe nothing happened.
     */
    async function expectStoredHashesToBeCurrent() {
      const stored = await (await reload()).getBookmarksTree()
      // copy() drops the folder hashes, so this one has to compute them anew
      const recomputed = stored.copy()
      expect(await stored.hash(SETTINGS)).to.equal(await recomputed.hash(SETTINGS))
    }

    it('should store the hashes of all folders', async function() {
      const { folderId, subFolderId } = await setUpTree()

      const stored = await (await reload()).getBookmarksTree()
      expect(stored.hashValue[CACHE_KEY]).to.be.a('string')
      expect(stored.findFolder(folderId).hashValue[CACHE_KEY]).to.be.a('string')
      expect(stored.findFolder(subFolderId).hashValue[CACHE_KEY]).to.be.a('string')
      await expectStoredHashesToBeCurrent()
    })

    it('should not store hashes before any sync settled the hash settings', async function() {
      const untouched = new NativeTree(accountStorageStub(newAccountId()))
      await untouched.load()
      await untouched.createFolder(new Folder({ parentId: 0, title: 'foo', location: ItemLocation.LOCAL }))
      await untouched.save()

      const stored = await untouched.getBookmarksTree()
      expect(stored.hashValue[CACHE_KEY]).to.not.be.ok
    })

    it('should drop the hashes of a bookmark\'s ancestors when it is created', async function() {
      const { subFolderId } = await setUpTree()

      await tree.createBookmark(bookmark(subFolderId, 'url3', 'http://ex.com/three'))

      const stored = await (await reload()).getBookmarksTree()
      expect(stored.hashValue[CACHE_KEY]).to.not.be.ok
      expect(stored.findFolder(subFolderId).hashValue[CACHE_KEY]).to.not.be.ok
      await expectStoredHashesToBeCurrent()
    })

    it('should keep the hashes of untouched branches', async function() {
      const { folderId, subFolderId } = await setUpTree()
      const otherId = await tree.createFolder(
        new Folder({ parentId: rootId, title: 'other', location: ItemLocation.LOCAL })
      )
      await tree.save()

      await tree.createBookmark(bookmark(otherId, 'url3', 'http://ex.com/three'))

      const stored = await (await reload()).getBookmarksTree()
      // Changed: the new bookmark's parent and the root above it
      expect(stored.hashValue[CACHE_KEY]).to.not.be.ok
      expect(stored.findFolder(otherId).hashValue[CACHE_KEY]).to.not.be.ok
      // Untouched: the other branch keeps what it had
      expect(stored.findFolder(folderId).hashValue[CACHE_KEY]).to.be.a('string')
      expect(stored.findFolder(subFolderId).hashValue[CACHE_KEY]).to.be.a('string')
      await expectStoredHashesToBeCurrent()
    })

    it('should drop stale hashes on every kind of change', async function() {
      const changes = {
        'updating a bookmark': async({ bookmarkId, subFolderId }) => {
          await tree.updateBookmark(new Bookmark({
            id: bookmarkId,
            parentId: subFolderId,
            title: 'url1 (edited)',
            url: 'http://ex.com/one',
            location: ItemLocation.LOCAL,
          }))
        },
        'moving a bookmark': async({ bookmarkId, folderId }) => {
          await tree.updateBookmark(new Bookmark({
            id: bookmarkId,
            parentId: folderId,
            title: 'url1',
            url: 'http://ex.com/one',
            location: ItemLocation.LOCAL,
          }))
        },
        'removing a bookmark': async({ bookmarkId, subFolderId }) => {
          await tree.removeBookmark(new Bookmark({
            id: bookmarkId,
            parentId: subFolderId,
            title: 'url1',
            url: 'http://ex.com/one',
            location: ItemLocation.LOCAL,
          }))
        },
        'renaming a folder': async({ subFolderId, folderId }) => {
          await tree.updateFolder(new Folder({
            id: subFolderId,
            parentId: folderId,
            title: 'bar (renamed)',
            location: ItemLocation.LOCAL,
          }))
        },
        'moving a folder': async({ subFolderId }) => {
          await tree.updateFolder(new Folder({
            id: subFolderId,
            parentId: rootId,
            title: 'bar',
            location: ItemLocation.LOCAL,
          }))
        },
        'removing a folder': async({ subFolderId, folderId }) => {
          await tree.removeFolder(new Folder({
            id: subFolderId,
            parentId: folderId,
            location: ItemLocation.LOCAL,
          }))
        },
        'reordering a folder': async({ subFolderId }) => {
          await tree.createBookmark(bookmark(subFolderId, 'url3', 'http://ex.com/three'))
          await tree.save()
          const folder = (await tree.getBookmarksTree()).findFolder(subFolderId)
          await tree.orderFolder(subFolderId, folder.children.slice().reverse().map(
            (child) => ({ type: child.type, id: child.id })
          ))
        },
        'importing in bulk': async({ folderId }) => {
          await tree.bulkImportFolder(folderId, new Folder({
            id: folderId,
            parentId: rootId,
            title: 'foo',
            location: ItemLocation.LOCAL,
            children: [bookmark(folderId, 'imported', 'http://ex.com/imported')],
          }))
        },
      }

      for (const [name, change] of Object.entries(changes)) {
        accountId = newAccountId()
        tree = new NativeTree(accountStorageStub(accountId))
        await tree.load()
        tree.setHashSettings(SETTINGS)
        rootId = (await tree.getBookmarksTree()).id

        const ids = await setUpTree()
        await change(ids)

        const stored = await (await reload()).getBookmarksTree()
        const recomputed = stored.copy()
        expect(
          await stored.hash(SETTINGS),
          'stale stored hash after ' + name
        ).to.equal(await recomputed.hash(SETTINGS))
      }
    })

    it('should ignore hashes stored with different hash settings', async function() {
      await setUpTree()

      const reloaded = await reload()
      const otherSettings = { preserveOrder: false, hashFn: 'sha256', syncTags: false }
      const stored = await reloaded.getBookmarksTree()
      const recomputed = stored.copy()
      expect(await stored.hash(otherSettings)).to.equal(await recomputed.hash(otherSettings))
    })
  })

  describe('mappings', function() {
    let accountId, storage

    beforeEach('set up mappings', async function() {
      accountId = newAccountId()
      storage = new NativeAccountStorage(accountId)
    })

    it('should only count as initialized once initialized', async function() {
      expect(await storage.isMappingsInitialized()).to.equal(false)
      await storage.initMappings()
      expect(await storage.isMappingsInitialized()).to.equal(true)
      await storage.deleteMappings()
      expect(await storage.isMappingsInitialized()).to.equal(false)
    })

    it('should restore mappings with the id types they were stored with', async function() {
      await storage.initMappings()
      const mappings = await storage.getMappings()
      await mappings.addFolder({ localId: 5, remoteId: 'abc' })
      await mappings.addBookmark({ localId: 7, remoteId: 42 })
      await mappings.addBookmark({ localId: 8, remoteId: '0042' })
      await mappings.persist()

      const reloaded = await new NativeAccountStorage(accountId).getMappings()
      expect(reloaded.getSnapshot()).to.deep.equal(mappings.getSnapshot())
      expect(reloaded.getSnapshot().LocalToServer.bookmark[7]).to.equal(42)
      expect(reloaded.getSnapshot().LocalToServer.bookmark[8]).to.equal('0042')
      expect(reloaded.getSnapshot().ServerToLocal.folder.abc).to.equal(5)
    })

    it('should persist removed mappings', async function() {
      await storage.initMappings()
      const mappings = await storage.getMappings()
      await mappings.addBookmark({ localId: 7, remoteId: 42 })
      await mappings.addBookmark({ localId: 8, remoteId: 43 })
      await mappings.persist()

      await mappings.removeBookmark({ localId: 7 })
      await mappings.persist()

      const reloaded = await new NativeAccountStorage(accountId).getMappings()
      expect(reloaded.getSnapshot().LocalToServer.bookmark).to.deep.equal({ 8: 43 })
      expect(reloaded.getSnapshot().ServerToLocal.bookmark).to.deep.equal({ 43: 8 })
    })

    it('should persist a mapping that was pointed at a different item', async function() {
      await storage.initMappings()
      const mappings = await storage.getMappings()
      await mappings.addBookmark({ localId: 7, remoteId: 42 })
      await mappings.persist()

      await mappings.addBookmark({ localId: 8, remoteId: 42 })
      await mappings.persist()

      const reloaded = await new NativeAccountStorage(accountId).getMappings()
      expect(reloaded.getSnapshot().LocalToServer.bookmark).to.deep.equal({ 8: 42 })
      expect(reloaded.getSnapshot().ServerToLocal.bookmark).to.deep.equal({ 42: 8 })
    })

    it('should import mappings that are still stored as JSON in the preferences', async function() {
      const legacyAccountId = newAccountId()
      await Storage.set({
        key: `bookmarks[${legacyAccountId}].mappings`,
        value: JSON.stringify({
          folders: { LocalToServer: { 5: 'abc' }, ServerToLocal: { abc: 5 } },
          bookmarks: { LocalToServer: { 7: 42 }, ServerToLocal: { 42: 7 } },
        }),
      })

      const legacyStorage = new NativeAccountStorage(legacyAccountId)
      expect(await legacyStorage.isMappingsInitialized()).to.equal(true)

      const snapshot = (await legacyStorage.getMappings()).getSnapshot()
      expect(snapshot.LocalToServer.folder[5]).to.equal('abc')
      expect(snapshot.LocalToServer.bookmark[7]).to.equal(42)
      expect(snapshot.ServerToLocal.bookmark[42]).to.equal(7)
      expect((await Storage.get({ key: `bookmarks[${legacyAccountId}].mappings` })).value).to.not.be.ok
    })
  })
})
