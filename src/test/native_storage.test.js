import { expect } from './utils'
import { Preferences as Storage } from '@capacitor/preferences'
import { Bookmark, Folder, hashCacheKey, ItemLocation } from '../lib/Tree'
import NativeTree from '../lib/native/NativeTree'
import NativeAccountStorage from '../lib/native/NativeAccountStorage'
import NativeTreeQuery, { formatSearchToken, parseSearchQuery } from '../lib/native/NativeTreeQuery'
import NativeDatabase from '../lib/native/NativeDatabase'
import DefaultSyncProcess from '../lib/strategies/Default'
import Diff from '../lib/Diff'

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

describe('NativeAccountStorage continuation', function() {
  this.timeout(20000)

  const STALE_AFTER = 1000 * 60 * 30

  let accountId, storage

  beforeEach('set up an account storage', async function() {
    accountId = newAccountId()
    storage = new NativeAccountStorage(accountId)
  })

  afterEach('drop the continuation', async function() {
    await NativeAccountStorage.deleteEntry(`bookmarks[${accountId}].continuation`)
  })

  it('should hand back the continuation it was given', async function() {
    await storage.setCurrentContinuation({ strategy: 'default', actionsPlanned: 7 })

    const stored = await storage.getCurrentContinuation()
    expect(stored.strategy).to.equal('default')
    expect(stored.actionsPlanned).to.equal(7)
  })

  it('should stamp the continuation with the time it was stored', async function() {
    // Account#sync discards continuations older than half an hour by this very
    // field; an unstamped one compares as NaN and is resumed forever
    const before = Date.now()
    await storage.setCurrentContinuation({ strategy: 'default' })
    const stored = await storage.getCurrentContinuation()

    expect(stored.createdAt).to.be.a('number')
    expect(stored.createdAt).to.be.at.least(before)
    expect(stored.createdAt).to.be.at.most(Date.now())
  })

  it('should let the staleness check actually decide something', async function() {
    await storage.setCurrentContinuation({ strategy: 'default' })
    const fresh = await storage.getCurrentContinuation()
    expect(Date.now() - fresh.createdAt > STALE_AFTER).to.equal(false)

    // The same entry as it looks half an hour on
    await NativeAccountStorage.setEntry(
      `bookmarks[${accountId}].continuation`,
      { ...fresh, createdAt: Date.now() - STALE_AFTER - 1000 }
    )
    const aged = await storage.getCurrentContinuation()
    expect(Date.now() - aged.createdAt > STALE_AFTER).to.equal(true)
  })

  it('should store null when the continuation is cleared', async function() {
    await storage.setCurrentContinuation({ strategy: 'default' })
    await storage.setCurrentContinuation(null)

    // Account#sync takes any non-null entry for a continuation and hands it to
    // fromJSON, so a cleared one must not come back as a bare { createdAt }
    expect(await storage.getCurrentContinuation()).to.equal(null)
  })
})

describe('NativeAccountStorage incremental continuations', function() {
  this.timeout(20000)

  let accountId, storage, syncProcess

  function bookmark(id) {
    return new Bookmark({
      id,
      parentId: 1,
      title: 'Bookmark ' + id,
      url: 'http://example.com/' + id,
      location: ItemLocation.LOCAL,
    })
  }

  function emptyPlan() {
    return {
      CREATE: new Diff(),
      UPDATE: new Diff(),
      MOVE: new Diff(),
      REMOVE: new Diff(),
      REORDER: new Diff(),
    }
  }

  function creation(id) {
    return { type: 'CREATE', payload: bookmark(id) }
  }

  async function persist() {
    const update = await syncProcess.toContinuationUpdateAsync()
    await storage.updateCurrentContinuation(update)
    syncProcess.markContinuationPersisted(update)
    return update
  }

  function diffUpdate(update, diff) {
    return update.diffs.find((entry) => entry.id === diff.id)
  }

  function storedIds(actions) {
    return actions.map((action) => action.payload.id)
  }

  async function countRows() {
    const [row] = await NativeDatabase.query(
      'SELECT COUNT(*) AS count FROM continuation_actions WHERE account_id = ?',
      [accountId]
    )
    return Number(row.count)
  }

  beforeEach('set up an account storage and a sync process', async function() {
    accountId = newAccountId()
    storage = new NativeAccountStorage(accountId)
    // The strategy is only used as a bag of members here -- nothing is synced
    syncProcess = new DefaultSyncProcess(null, null, null, async() => undefined)
  })

  afterEach('drop the continuation', async function() {
    await storage.setCurrentContinuation(null)
    await NativeAccountStorage.deleteEntry(`bookmarks[${accountId}].continuation`)
  })

  it('should hand back the actions it stored', async function() {
    const scanResult = emptyPlan()
    scanResult.CREATE.commit(creation(1))
    scanResult.CREATE.commit(creation(2))
    scanResult.REMOVE.commit({ type: 'REMOVE', payload: bookmark(3) })
    syncProcess.localScanResult = scanResult

    await persist()

    const stored = await storage.getCurrentContinuation()
    expect(stored.strategy).to.equal('default')
    expect(stored.createdAt).to.be.a('number')
    expect(storedIds(stored.localScanResult.CREATE)).to.deep.equal([1, 2])
    expect(storedIds(stored.localScanResult.REMOVE)).to.deep.equal([3])
    expect(stored.localScanResult.UPDATE).to.deep.equal([])
    // Members that hadn't been computed at this point stay null, so that a
    // resumed sync recomputes them instead of reading .CREATE off nothing
    expect(stored.serverPlanStage2).to.equal(null)
    // The trees are deliberately not part of a continuation
    expect(stored.localTreeRoot).to.equal(null)
  })

  it('should only write the actions that changed since the last persist', async function() {
    const scanResult = emptyPlan()
    const first = creation(1)
    scanResult.CREATE.commit(first)
    scanResult.CREATE.commit(creation(2))
    syncProcess.localScanResult = scanResult

    const initial = await persist()
    expect(diffUpdate(initial, scanResult.CREATE).added).to.have.length(2)

    // Nothing happened since
    const unchanged = await persist()
    expect(diffUpdate(unchanged, scanResult.CREATE)).to.equal(undefined)

    // What an executed action does: out of the plan, into the done plan
    const [committed] = scanResult.CREATE.getActions()
    scanResult.CREATE.retract(committed)
    scanResult.CREATE.commit(creation(3))

    const delta = await persist()
    const diff = diffUpdate(delta, scanResult.CREATE)
    expect(storedIds(diff.added.map(({ action }) => action))).to.deep.equal([3])
    expect(diff.removed).to.have.length(1)

    const stored = await storage.getCurrentContinuation()
    expect(storedIds(stored.localScanResult.CREATE)).to.deep.equal([2, 3])
    expect(await countRows()).to.equal(2)
  })

  it('should drop the row of an action executed while the write was in flight', async function() {
    const scanResult = emptyPlan()
    scanResult.CREATE.commit(creation(1))
    scanResult.CREATE.commit(creation(2))
    syncProcess.localScanResult = scanResult

    // The sync doesn't wait for the continuation to be written -- it goes on
    // executing actions, which take themselves out of their plan, while the
    // update that still holds them is on its way to the store
    const update = await syncProcess.toContinuationUpdateAsync()
    const [executed] = scanResult.CREATE.getActions()
    scanResult.CREATE.retract(executed)
    await storage.updateCurrentContinuation(update)
    syncProcess.markContinuationPersisted(update)

    // That row may have been written by this very update, so the next one has
    // to take it out again: an executed action left behind in its plan is
    // executed a second time by the sync that resumes from this continuation
    await persist()

    const stored = await storage.getCurrentContinuation()
    expect(storedIds(stored.localScanResult.CREATE)).to.deep.equal([2])
    expect(await countRows()).to.equal(1)
  })

  it('should write an unacknowledged action again', async function() {
    const scanResult = emptyPlan()
    scanResult.CREATE.commit(creation(1))
    syncProcess.localScanResult = scanResult

    // A write that fails is never acknowledged, so what it carried is still
    // owed to the store
    await syncProcess.toContinuationUpdateAsync()

    await persist()

    const stored = await storage.getCurrentContinuation()
    expect(storedIds(stored.localScanResult.CREATE)).to.deep.equal([1])
  })

  it('should notice an action that was changed in place', async function() {
    const reorders = new Diff()
    const action = {
      type: 'REORDER',
      payload: bookmark(1),
      order: [{ type: 'bookmark', id: 5 }, { type: 'bookmark', id: 6 }],
    }
    reorders.commit(action)
    syncProcess.localReorders = reorders

    await persist()

    // Default#removeItemFromReorders rewrites the order of an action that stays
    // in its diff, which commit()/retract() can't know about
    const [stored] = reorders.getActions()
    stored.order = stored.order.filter((item) => item.id !== 6)
    reorders.markChanged(stored)

    const update = await persist()
    expect(diffUpdate(update, reorders).added).to.have.length(1)

    const loaded = await storage.getCurrentContinuation()
    expect(loaded.localReorders[0].order).to.deep.equal([{ type: 'bookmark', id: 5 }])
  })

  it('should drop the rows of members it no longer persists', async function() {
    const scanResult = emptyPlan()
    scanResult.CREATE.commit(creation(1))
    syncProcess.localScanResult = scanResult

    await persist()
    expect(await countRows()).to.equal(1)

    // Once both stage 3 plans exist, the scan results are no longer persisted
    syncProcess.planStage3Local = emptyPlan()
    syncProcess.planStage3Server = emptyPlan()
    await persist()

    const stored = await storage.getCurrentContinuation()
    expect('localScanResult' in stored).to.equal(false)
    expect(await countRows()).to.equal(0)
  })

  it('should store a diff shared by two members once and restore both', async function() {
    const plan = emptyPlan()
    plan.CREATE.commit(creation(1))
    // planStage3Local is built from the very same diffs as localPlanStage2
    syncProcess.localPlanStage2 = plan
    syncProcess.planStage3Local = { ...plan }
    syncProcess.actionsPlanned = 5

    const update = await persist()
    expect(update.diffIds).to.have.length(5)
    expect(await countRows()).to.equal(1)

    const stored = await storage.getCurrentContinuation()
    expect(storedIds(stored.localPlanStage2.CREATE)).to.deep.equal([1])
    expect(storedIds(stored.planStage3Local.CREATE)).to.deep.equal([1])
    // Diff.fromJSON hydrates the actions in place, so each member needs its own
    expect(stored.localPlanStage2.CREATE[0]).to.not.equal(stored.planStage3Local.CREATE[0])
  })

  it('should not adopt the rows of the run before it', async function() {
    const previous = emptyPlan()
    previous.CREATE.commit(creation(1))
    previous.CREATE.commit(creation(2))
    previous.CREATE.commit(creation(3))
    syncProcess.localScanResult = previous
    await persist()
    expect(await countRows()).to.equal(3)

    // What resuming after a restart looks like: a fresh sync process, with
    // diffs of its own, persisting over the rows the interrupted run left --
    // here with fewer actions in them, because some have since been executed
    syncProcess = new DefaultSyncProcess(null, null, null, async() => undefined)
    const resumed = emptyPlan()
    resumed.CREATE.commit(creation(1))
    syncProcess.localScanResult = resumed
    await persist()

    const stored = await storage.getCurrentContinuation()
    expect(storedIds(stored.localScanResult.CREATE)).to.deep.equal([1])
    expect(await countRows()).to.equal(1)
  })

  it('should resume a continuation that was stored as a blob', async function() {
    // What a sync that was interrupted before the update to row storage left
    await NativeAccountStorage.setEntry(`bookmarks[${accountId}].continuation`, {
      strategy: 'default',
      createdAt: Date.now(),
      actionsPlanned: 7,
    })

    const legacy = await storage.getCurrentContinuation()
    expect(legacy.actionsPlanned).to.equal(7)

    // ... and it doesn't outlive the rows that replace it
    syncProcess.localScanResult = emptyPlan()
    await persist()

    const stored = await storage.getCurrentContinuation()
    expect(stored.actionsPlanned).to.equal(undefined)
    expect(
      await NativeAccountStorage.getEntry(`bookmarks[${accountId}].continuation`)
    ).to.equal(undefined)
  })

  it('should clear the rows when the continuation is cleared', async function() {
    const scanResult = emptyPlan()
    scanResult.CREATE.commit(creation(1))
    syncProcess.localScanResult = scanResult
    await persist()

    await storage.setCurrentContinuation(null)

    expect(await storage.getCurrentContinuation()).to.equal(null)
    expect(await countRows()).to.equal(0)
  })
})

describe('NativeAccountStorage preferences entries', function() {
  this.timeout(20000)

  let key

  beforeEach('pick an entry', async function() {
    key = 'test-entry-' + Date.now() + Math.random()
  })

  afterEach('drop the entry', async function() {
    await NativeAccountStorage.deleteEntry(key)
  })

  it('should round-trip a value written with setEntry', async function() {
    const value = { title: 'root', children: [{ title: 'a', url: 'http://example.com/' }] }
    await NativeAccountStorage.setEntry(key, value)
    expect(await NativeAccountStorage.getEntry(key)).to.deep.equal(value)
  })

  it('should replace the previous value rather than merge into it', async function() {
    await NativeAccountStorage.setEntry(key, { before: true, gone: 'yes' })
    await NativeAccountStorage.setEntry(key, { after: true })
    expect(await NativeAccountStorage.getEntry(key)).to.deep.equal({ after: true })
  })

  it('should write what changeEntry writes, so either can read the other', async function() {
    // setEntry is changeEntry without the read-back; the two have to agree on
    // the stored representation or a fast-path write becomes unreadable
    const value = { messages: ['one', 'two'], nested: { n: 1 } }
    await NativeAccountStorage.setEntry(key, value)
    const viaChangeEntry = await NativeAccountStorage.getEntry(key)

    await NativeAccountStorage.changeEntry(key, () => value, null)
    expect(await NativeAccountStorage.getEntry(key)).to.deep.equal(viaChangeEntry)
  })

  it('should round-trip an array, the shape the logs are stored in', async function() {
    await NativeAccountStorage.setEntry(key, ['first', 'second'])
    expect(await NativeAccountStorage.getEntry(key, [])).to.deep.equal(['first', 'second'])
  })

  it('should hand out the default for an entry that was never written', async function() {
    expect(await NativeAccountStorage.getEntry(key, [])).to.deep.equal([])
  })
})

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

  describe('browsing and search', function() {
    let accountId, tree, query, rootId

    beforeEach('set up a tree to browse', async function() {
      accountId = newAccountId()
      tree = new NativeTree(accountStorageStub(accountId))
      await tree.load()
      query = new NativeTreeQuery(accountId)
      rootId = (await tree.getBookmarksTree()).id
    })

    function bookmark(parentId, title, url, tags) {
      return new Bookmark({ parentId, title, url, tags, location: ItemLocation.LOCAL })
    }

    function folder(parentId, title) {
      return new Folder({ parentId, title, location: ItemLocation.LOCAL })
    }

    it('should hand out the folders without any bookmarks in them', async function() {
      const fooId = await tree.createFolder(folder(rootId, 'foo'))
      const barId = await tree.createFolder(folder(fooId, 'bar'))
      await tree.createBookmark(bookmark(fooId, 'url1', 'http://ex.com/one'))
      await tree.save()

      const folders = await query.getFolderTree()
      expect(String(folders.id)).to.equal(String(rootId))
      expect(folders.children.map((child) => child.title)).to.deep.equal(['foo'])
      const foo = folders.findFolder(fooId)
      expect(foo.children.map((child) => child.title)).to.deep.equal(['bar'])
      expect(String(folders.findFolder(barId).parentId)).to.equal(String(fooId))
      // The index is what the UI looks folders up through while it renders
      expect(Object.keys(foo.index.folder).map(String).sort()).to.deep.equal(
        [fooId, barId].map(String).sort()
      )
    })

    it('should have no folders for an account that was never opened', async function() {
      expect(await new NativeTreeQuery(newAccountId()).getFolderTree()).to.equal(null)
    })

    it('should hand out a folder\'s children in the order they are stored in', async function() {
      const first = await tree.createBookmark(bookmark(rootId, 'url1', 'http://ex.com/one'))
      const second = await tree.createFolder(folder(rootId, 'foo'))
      const third = await tree.createBookmark(bookmark(rootId, 'url3', 'http://ex.com/three'))
      await tree.createBookmark(bookmark(second, 'url4', 'http://ex.com/four'))
      await tree.save()

      const children = await query.getChildren(rootId)
      expect(children.map((child) => String(child.id))).to.deep.equal(
        [first, second, third].map(String)
      )
      expect(children.map((child) => child.type)).to.deep.equal(['bookmark', 'folder', 'bookmark'])

      await tree.orderFolder(rootId, [
        { type: 'bookmark', id: third },
        { type: 'folder', id: second },
        { type: 'bookmark', id: first },
      ])
      await tree.save()
      expect((await query.getChildren(rootId)).map((child) => String(child.id))).to.deep.equal(
        [third, second, first].map(String)
      )
    })

    it('should count the tags below a folder, most used first', async function() {
      const fooId = await tree.createFolder(folder(rootId, 'foo'))
      const barId = await tree.createFolder(folder(fooId, 'bar'))
      await tree.createBookmark(bookmark(fooId, 'url1', 'http://ex.com/one', ['common', 'rare']))
      await tree.createBookmark(bookmark(barId, 'url2', 'http://ex.com/two', ['common']))
      await tree.createBookmark(bookmark(rootId, 'url3', 'http://ex.com/three', ['elsewhere']))
      await tree.save()

      expect(await query.getTags(fooId)).to.deep.equal(['common', 'rare'])
      expect(await query.getTags(null)).to.deep.equal(['common', 'elsewhere', 'rare'])
    })

    it('should find a bookmark by its url', async function() {
      const bookmarkId = await tree.createBookmark(bookmark(rootId, 'url1', 'http://ex.com/one'))
      await tree.save()

      expect(String((await query.findBookmarkByUrl('http://ex.com/one')).id)).to.equal(String(bookmarkId))
      expect(await query.findBookmarkByUrl('http://ex.com/nope')).to.equal(null)
    })

    it('should find folders and bookmarks by title, url and tags', async function() {
      const fooId = await tree.createFolder(folder(rootId, 'holiday pictures'))
      await tree.createBookmark(bookmark(rootId, 'Trip report', 'http://ex.com/holiday'))
      await tree.createBookmark(bookmark(rootId, 'Something else', 'http://ex.com/other', ['holiday']))
      await tree.createBookmark(bookmark(rootId, 'Unrelated', 'http://ex.com/unrelated'))
      await tree.save()

      const { folders, bookmarks } = await query.search('holiday')
      expect(folders.map((f) => String(f.id))).to.deep.equal([String(fooId)])
      expect(bookmarks.map((b) => b.title).sort()).to.deep.equal(['Something else', 'Trip report'])
    })

    it('should rank whole-word title matches first', async function() {
      await tree.createBookmark(bookmark(rootId, 'Something about rusty nails', 'http://ex.com/nails'))
      await tree.createBookmark(bookmark(rootId, 'The rust book', 'http://ex.com/book'))
      await tree.createBookmark(bookmark(rootId, 'Trusty tools', 'http://ex.com/tools'))
      await tree.save()

      const { bookmarks } = await query.search('rust')
      expect(bookmarks.map((b) => b.title)).to.deep.equal([
        'The rust book', // 'rust' is a word of its own
        'Something about rusty nails', // only part of a word
        'Trusty tools',
      ])
    })

    it('should require every term to match', async function() {
      await tree.createBookmark(bookmark(rootId, 'red green', 'http://ex.com/one'))
      await tree.createBookmark(bookmark(rootId, 'red only', 'http://ex.com/two'))
      await tree.save()

      const { bookmarks } = await query.search('red green')
      expect(bookmarks.map((b) => b.title)).to.deep.equal(['red green'])
    })

    it('should ignore case beyond ASCII', async function() {
      await tree.createBookmark(bookmark(rootId, 'Äpfel und Birnen', 'http://ex.com/one'))
      await tree.save()

      expect((await query.search('äpfel')).bookmarks).to.have.length(1)
      expect((await query.search('ÄPFEL')).bookmarks).to.have.length(1)
    })

    it('should take LIKE wildcards as literal characters', async function() {
      await tree.createBookmark(bookmark(rootId, '100% cotton', 'http://ex.com/one'))
      await tree.createBookmark(bookmark(rootId, 'plain', 'http://ex.com/two'))
      await tree.save()

      expect((await query.search('100%')).bookmarks.map((b) => b.title)).to.deep.equal(['100% cotton'])
      expect((await query.search('%')).bookmarks.map((b) => b.title)).to.deep.equal(['100% cotton'])
    })

    it('should search tags only for a #query, exact matches first', async function() {
      await tree.createFolder(folder(rootId, 'holiday'))
      await tree.createBookmark(bookmark(rootId, 'partially tagged', 'http://ex.com/one', ['holidays']))
      await tree.createBookmark(bookmark(rootId, 'exactly tagged', 'http://ex.com/two', ['holiday']))
      await tree.createBookmark(bookmark(rootId, 'holiday in the title', 'http://ex.com/three'))
      await tree.save()

      const { folders, bookmarks } = await query.search('#holiday')
      expect(folders).to.deep.equal([])
      expect(bookmarks.map((b) => b.title)).to.deep.equal(['exactly tagged', 'partially tagged'])
    })

    it('should narrow the results down with every tag named', async function() {
      await tree.createBookmark(bookmark(rootId, 'both', 'http://ex.com/one', ['holiday', 'beach']))
      await tree.createBookmark(bookmark(rootId, 'only holiday', 'http://ex.com/two', ['holiday']))
      await tree.createBookmark(bookmark(rootId, 'only beach', 'http://ex.com/three', ['beach']))
      await tree.save()

      expect((await query.search('#holiday')).bookmarks.map((b) => b.title).sort())
        .to.deep.equal(['both', 'only holiday'])
      expect((await query.search('#holiday #beach')).bookmarks.map((b) => b.title))
        .to.deep.equal(['both'])
      expect((await query.search('#holiday #beach #nonexistent')).bookmarks).to.deep.equal([])
    })

    it('should rank bookmarks carrying every tag exactly first', async function() {
      await tree.createBookmark(bookmark(rootId, 'partial', 'http://ex.com/one', ['holidays', 'beaches']))
      await tree.createBookmark(bookmark(rootId, 'exact', 'http://ex.com/two', ['holiday', 'beach']))
      await tree.createBookmark(bookmark(rootId, 'half', 'http://ex.com/three', ['holiday', 'beaches']))
      await tree.save()

      expect((await query.search('#holiday #beach')).bookmarks.map((b) => b.title))
        .to.deep.equal(['exact', 'half', 'partial'])
    })

    it('should combine tags with free text', async function() {
      await tree.createBookmark(bookmark(rootId, 'Pasta carbonara', 'http://ex.com/one', ['recipes']))
      await tree.createBookmark(bookmark(rootId, 'Pasta machine', 'http://ex.com/two', ['shopping']))
      await tree.createBookmark(bookmark(rootId, 'Risotto', 'http://ex.com/three', ['recipes']))
      await tree.save()

      expect((await query.search('#recipes pasta')).bookmarks.map((b) => b.title))
        .to.deep.equal(['Pasta carbonara'])
      // Order doesn't matter
      expect((await query.search('pasta #recipes')).bookmarks.map((b) => b.title))
        .to.deep.equal(['Pasta carbonara'])
    })

    it('should let a term match a tag while another matches the title', async function() {
      await tree.createBookmark(bookmark(rootId, 'Pasta carbonara', 'http://ex.com/one', ['recipes']))
      await tree.createBookmark(bookmark(rootId, 'Pasta machine', 'http://ex.com/two', ['shopping']))
      await tree.save()

      expect((await query.search('recipes pasta')).bookmarks.map((b) => b.title))
        .to.deep.equal(['Pasta carbonara'])
    })

    it('should return no folders for a query naming a tag', async function() {
      await tree.createFolder(folder(rootId, 'holiday'))
      await tree.createBookmark(bookmark(rootId, 'tagged', 'http://ex.com/one', ['holiday']))
      await tree.save()

      expect((await query.search('holiday')).folders.map((f) => f.title)).to.deep.equal(['holiday'])
      expect((await query.search('#holiday')).folders).to.deep.equal([])
    })

    it('should take a quoted tag as one tag', async function() {
      await tree.createBookmark(bookmark(rootId, 'saved', 'http://ex.com/one', ['read later']))
      await tree.createBookmark(bookmark(rootId, 'later only', 'http://ex.com/two', ['later']))
      await tree.save()

      expect((await query.search('#"read later"')).bookmarks.map((b) => b.title))
        .to.deep.equal(['saved'])
      // Unquoted, 'later' is a term of its own -- which 'later only' has as a tag
      expect((await query.search('#read later')).bookmarks.map((b) => b.title))
        .to.deep.equal(['saved'])
    })

    it('should parse and format the tags of a query', function() {
      expect(parseSearchQuery('#holiday #beach pictures')).to.deep.equal({
        tags: ['holiday', 'beach'],
        terms: ['pictures'],
      })
      expect(parseSearchQuery('pictures')).to.deep.equal({ tags: [], terms: ['pictures'] })
      // Someone who has only just started typing
      expect(parseSearchQuery('#')).to.deep.equal({ tags: [], terms: [] })
      expect(parseSearchQuery('  ')).to.deep.equal({ tags: [], terms: [] })

      expect(formatSearchToken('holiday', true)).to.equal('#holiday')
      expect(formatSearchToken('read later', true)).to.equal('#"read later"')
      expect(parseSearchQuery(formatSearchToken('read later', true)).tags).to.deep.equal(['read later'])
    })

    it('should keep the search up to date with edits', async function() {
      const bookmarkId = await tree.createBookmark(bookmark(rootId, 'before', 'http://ex.com/one'))
      await tree.save()
      expect((await query.search('before')).bookmarks).to.have.length(1)

      await tree.updateBookmark(new Bookmark({
        id: bookmarkId,
        parentId: rootId,
        title: 'after',
        url: 'http://ex.com/one',
        location: ItemLocation.LOCAL,
      }))
      await tree.save()

      expect((await query.search('before')).bookmarks).to.have.length(0)
      expect((await query.search('after')).bookmarks).to.have.length(1)
    })

    it('should build the search index for rows that were stored without one', async function() {
      const fooId = await tree.createFolder(folder(rootId, 'Ölberg'))
      await tree.createBookmark(bookmark(fooId, 'Ölmühle', 'http://ex.com/one', ['Öl']))
      await tree.save()

      // What an installation that predates the search_text column looks like
      await NativeDatabase.batch([
        { statement: 'UPDATE folders SET search_text = NULL WHERE account_id = ?', values: [accountId] },
        { statement: 'UPDATE bookmarks SET search_text = NULL WHERE account_id = ?', values: [accountId] },
        { statement: 'UPDATE account_meta SET search_backfilled = 0 WHERE account_id = ?', values: [accountId] },
      ])

      const { folders, bookmarks } = await query.search('öl')
      expect(folders.map((f) => f.title)).to.deep.equal(['Ölberg'])
      expect(bookmarks.map((b) => b.title)).to.deep.equal(['Ölmühle'])
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
