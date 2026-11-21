import Account from '../lib/Account'
import { Bookmark, ItemLocation } from '../lib/Tree'
import Controller from '../lib/Controller'
import {
  CancelledSyncError,
  FileUnreadableError,
  GitPushError,
  NetworkError,
  RemoteFileChangedError,
  ResourceLockedError,
  XbelParseError,
} from '../errors/Error'
import {
  clearLocalResource,
  createTestLocalRoot,
  DUMP_LOGS,
  expect,
  getEnv,
  seedTestRandom,
} from './utils'

describe('Floccus', function() {
  this.timeout(120000)
  this.slow(20000)

  const { SEED } = getEnv()
  beforeEach(function() { seedTestRandom(SEED) })
  before(async function() { (await Controller.getSingleton()).setEnabled(false) })
  after(async function() { (await Controller.getSingleton()).setEnabled(true) })

  // Non-atomic: it persists cache, mappings and continuation during the sync,
  // so a failure has something to preserve and the next run resumes from it.
  // (Atomic adapters keep all three as they were before the sync.)
  describe('transient failure sync state', function() {
    let account

    beforeEach(async function() {
      account = await Account.create({
        type: 'fake-nc-bookmarks',
        ...(await createTestLocalRoot()),
      })
      await account.init()
    })

    afterEach(async function() {
      DUMP_LOGS(this.currentTest)
      if (!account) return
      await clearLocalResource(account)
      await account.delete()
      account = null
    })

    async function createBookmark(localResource, parentId, title) {
      return localResource.createBookmark(new Bookmark({
        title,
        url: `http://${title}.example/`,
        parentId,
        location: ItemLocation.LOCAL,
      }))
    }

    async function syncedAccountWithDeletion() {
      const localResource = await account.getResource()
      const localRoot = (await localResource.getBookmarksTree(true)).id
      await createBookmark(localResource, localRoot, 'keep')
      await createBookmark(localResource, localRoot, 'gone')
      await account.sync()
      expect(account.getData().error).to.not.be.ok

      // Deleted locally but not yet on the server, and a creation that has not
      // been synced yet either: a failure now leaves work in both directions.
      const tree = await localResource.getBookmarksTree(true)
      await localResource.removeBookmark(tree.children.find(item => item.title === 'gone'))
      await createBookmark(localResource, localRoot, 'new')
      return { localResource, localRoot }
    }

    async function storedState() {
      const cache = await account.storage.getCache()
      const mappings = await account.storage.getMappings()
      const continuation = await account.storage.getCurrentContinuation()
      return {
        cacheTitles: cache.children.map(item => item.title).sort(),
        mappedBookmarks: Object.keys(mappings.getSnapshot().LocalToServer.bookmark).length,
        continuation,
      }
    }

    async function titles(localResource) {
      const [localTree, serverTree] = await Promise.all([
        localResource.getBookmarksTree(true),
        account.server.getBookmarksTree(true),
      ])
      return {
        local: localTree.children.map(item => item.title).sort(),
        server: serverTree.children.map(item => item.title).sort(),
      }
    }

    const midSyncFailures = [
      { name: 'cancelled sync', code: 'E026', error: () => new CancelledSyncError() },
      { name: 'network error', code: 'E017', error: () => new NetworkError() },
    ]

    for (const failure of midSyncFailures) {
      it(`should keep cache, mappings and continuation on a ${failure.name}`, async function() {
        const { localResource } = await syncedAccountWithDeletion()

        // Fail the server-side deletion, after a progress tick has persisted
        // cache, mappings and the continuation of the run.
        const server = account.server
        const originalRemoveBookmark = server.removeBookmark.bind(server)
        server.removeBookmark = async() => {
          await account.progressCallback(0.6, 1)
          throw failure.error()
        }
        await account.sync()
        server.removeBookmark = originalRemoveBookmark

        expect(account.getData().error).to.contain(failure.code)
        const state = await storedState()
        expect(state.cacheTitles).to.deep.equal(['keep', 'new'])
        expect(state.mappedBookmarks).to.be.greaterThan(0)
        expect(state.continuation).to.be.ok
        expect(state.continuation.strategy).to.equal('default')

        // Resume: the pending deletion reaches the server and nothing that was
        // deleted comes back or is duplicated.
        await account.sync()
        expect(account.getData().error).to.not.be.ok
        expect(await titles(localResource)).to.deep.equal({
          local: ['keep', 'new'],
          server: ['keep', 'new'],
        })

        await account.sync()
        expect(account.getData().error).to.not.be.ok
        expect(await titles(localResource)).to.deep.equal({
          local: ['keep', 'new'],
          server: ['keep', 'new'],
        })
      })
    }

    const uploadFailures = [
      { name: 'rejected push', code: 'E037', error: () => new ResourceLockedError() },
      { name: 'failed push', code: 'E044', error: () => new GitPushError('rejected') },
      { name: 'conditional-write conflict', code: 'E060', error: () => new RemoteFileChangedError() },
    ]

    for (const failure of uploadFailures) {
      it(`should keep cache, mappings and continuation on a ${failure.name}`, async function() {
        const { localResource } = await syncedAccountWithDeletion()

        // onSyncComplete is where a file adapter commits and pushes (or an
        // atomic one uploads), so this is where a rejected push surfaces.
        const server = account.server
        const originalOnSyncComplete = server.onSyncComplete.bind(server)
        server.onSyncComplete = async() => { throw failure.error() }
        await account.sync()
        server.onSyncComplete = originalOnSyncComplete

        expect(account.getData().error).to.contain(failure.code)
        const state = await storedState()
        expect(state.cacheTitles).to.deep.equal(['keep', 'new'])
        expect(state.mappedBookmarks).to.be.greaterThan(0)
        expect(state.continuation).to.be.ok

        // The next sync must not create anything a second time.
        await account.sync()
        expect(account.getData().error).to.not.be.ok
        expect(await titles(localResource)).to.deep.equal({
          local: ['keep', 'new'],
          server: ['keep', 'new'],
        })
      })
    }

    const readFailures = [
      { name: 'unreadable remote file', code: 'E034', error: () => new FileUnreadableError() },
      { name: 'unparseable remote file', code: 'E047', error: () => new XbelParseError() },
    ]

    for (const failure of readFailures) {
      it(`should keep cache and mappings on an ${failure.name}`, async function() {
        const localResource = await account.getResource()
        const localRoot = (await localResource.getBookmarksTree(true)).id
        await createBookmark(localResource, localRoot, 'keep')
        await createBookmark(localResource, localRoot, 'gone')
        await account.sync()
        expect(account.getData().error).to.not.be.ok

        const server = account.server
        const originalGetBookmarksTree = server.getBookmarksTree.bind(server)
        server.getBookmarksTree = async() => { throw failure.error() }
        await createBookmark(localResource, localRoot, 'new')
        await account.sync()
        server.getBookmarksTree = originalGetBookmarksTree

        expect(account.getData().error).to.contain(failure.code)
        const state = await storedState()
        expect(state.cacheTitles).to.deep.equal(['gone', 'keep'])
        expect(state.mappedBookmarks).to.equal(2)
        expect(state.continuation).to.not.be.ok

        await account.sync()
        expect(account.getData().error).to.not.be.ok
        expect(await titles(localResource)).to.deep.equal({
          local: ['gone', 'keep', 'new'],
          server: ['gone', 'keep', 'new'],
        })
      })
    }

    it('should reinitialize cache and mappings on an explicit reset', async function() {
      const { localResource } = await syncedAccountWithDeletion()
      // What the UI's "reset cache" action does
      await account.storage.initCache()
      await account.storage.initMappings()

      const reset = await storedState()
      expect(reset.cacheTitles).to.deep.equal([])
      expect(reset.mappedBookmarks).to.equal(0)

      // Starting over from scratch, the merge restores what only the server
      // still has: an explicit reset is allowed to lose the pending deletion.
      await account.sync()
      expect(account.getData().error).to.not.be.ok
      expect(await titles(localResource)).to.deep.equal({
        local: ['gone', 'keep', 'new'],
        server: ['gone', 'keep', 'new'],
      })
      expect((await storedState()).cacheTitles).to.deep.equal(['gone', 'keep', 'new'])
    })

    it('should clear the continuation of a failed sync on an explicit reset', async function() {
      const { localResource } = await syncedAccountWithDeletion()

      // Fail the server-side deletion after a progress tick has persisted the
      // continuation of the run
      const server = account.server
      const originalRemoveBookmark = server.removeBookmark.bind(server)
      server.removeBookmark = async() => {
        await account.progressCallback(0.6, 1)
        throw new CancelledSyncError()
      }
      await account.sync()
      server.removeBookmark = originalRemoveBookmark
      expect(account.getData().error).to.contain('E026')
      expect((await storedState()).continuation).to.be.ok

      // What the UI's "reset cache" action does
      await account.reset()

      const reset = await storedState()
      expect(reset.cacheTitles).to.deep.equal([])
      expect(reset.mappedBookmarks).to.equal(0)
      expect(reset.continuation).to.not.be.ok

      // The next sync starts over instead of resuming the discarded plan
      await account.sync()
      expect(account.getData().error).to.not.be.ok
      expect(await titles(localResource)).to.deep.equal({
        local: ['gone', 'keep', 'new'],
        server: ['gone', 'keep', 'new'],
      })
    })
  })

  // An atomic adapter takes none of the run's changes before onSyncComplete,
  // so a failure has to leave cache and mappings exactly as the last successful
  // sync stored them -- persisting them would record local changes as synced
  // that the server never got (#2362).
  describe('atomic failure sync state', function() {
    let account

    beforeEach(async function() {
      account = await Account.create({
        type: 'fake',
        ...(await createTestLocalRoot()),
      })
      await account.init()
    })

    afterEach(async function() {
      DUMP_LOGS(this.currentTest)
      if (!account) return
      await clearLocalResource(account)
      await account.delete()
      account = null
    })

    async function createBookmark(localResource, parentId, title) {
      return localResource.createBookmark(new Bookmark({
        title,
        url: `http://${title}.example/`,
        parentId,
        location: ItemLocation.LOCAL,
      }))
    }

    async function storedState() {
      const cache = await account.storage.getCache()
      const mappings = await account.storage.getMappings()
      const continuation = await account.storage.getCurrentContinuation()
      return {
        cacheTitles: cache.children.map(item => item.title).sort(),
        mappedBookmarks: Object.keys(mappings.getSnapshot().LocalToServer.bookmark).length,
        continuation,
      }
    }

    async function titles(localResource) {
      const [localTree, serverTree] = await Promise.all([
        localResource.getBookmarksTree(true),
        account.server.getBookmarksTree(true),
      ])
      return {
        local: localTree.children.map(item => item.title).sort(),
        server: serverTree.children.map(item => item.title).sort(),
      }
    }

    const failures = [
      { name: 'cancelled sync', code: 'E026', error: () => new CancelledSyncError(), during: 'serverOperation' },
      { name: 'network error', code: 'E017', error: () => new NetworkError(), during: 'serverOperation' },
      { name: 'rejected push', code: 'E037', error: () => new ResourceLockedError(), during: 'upload' },
      { name: 'failed push', code: 'E044', error: () => new GitPushError('rejected'), during: 'upload' },
    ]

    for (const failure of failures) {
      it(`should leave the stored cache and mappings untouched on a ${failure.name}`, async function() {
        const localResource = await account.getResource()
        const localRoot = (await localResource.getBookmarksTree(true)).id
        await createBookmark(localResource, localRoot, 'keep')
        await createBookmark(localResource, localRoot, 'gone')
        await account.sync()
        expect(account.getData().error).to.not.be.ok

        const before = await storedState()
        const localTree = await localResource.getBookmarksTree(true)
        await localResource.removeBookmark(localTree.children.find(item => item.title === 'gone'))
        await createBookmark(localResource, localRoot, 'new')

        const server = account.server
        if (failure.during === 'upload') {
          // Closest to what an atomic adapter does: it uploads in onSyncComplete
          const originalOnSyncComplete = server.onSyncComplete.bind(server)
          server.onSyncComplete = async() => { throw failure.error() }
          await account.sync()
          server.onSyncComplete = originalOnSyncComplete
        } else {
          const originalRemoveBookmark = server.removeBookmark.bind(server)
          server.removeBookmark = async() => {
            await account.progressCallback(0.6, 1)
            throw failure.error()
          }
          await account.sync()
          server.removeBookmark = originalRemoveBookmark
        }

        expect(account.getData().error).to.contain(failure.code)
        const after = await storedState()
        expect(after.cacheTitles).to.deep.equal(before.cacheTitles)
        expect(after.mappedBookmarks).to.equal(before.mappedBookmarks)
        expect(after.continuation).to.not.be.ok

        // The local changes are still local changes; the next sync carries
        // them over without resurrecting or duplicating anything
        await account.sync()
        expect(account.getData().error).to.not.be.ok
        expect(await titles(localResource)).to.deep.equal({
          local: ['keep', 'new'],
          server: ['keep', 'new'],
        })
      })
    }
  })
})
