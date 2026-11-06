import Account from '../lib/Account'
import { Bookmark, Folder, ItemLocation } from '../lib/Tree'
import Controller from '../lib/Controller'
import {
  clearLocalResource,
  createTestLocalRoot,
  DUMP_LOGS,
  expect,
  getAllBookmarks,
  getEnv,
  seedTestRandom,
  stringifyAccountData,
  withSyncConnection,
} from './utils'

/**
 * A notify-only profile (#2403) checks for changes instead of syncing them:
 * Account#detectChanges plans a sync, counts what it would do and must leave
 * everything else -- both trees, the cache, the mappings -- as it was.
 */
describe('Floccus', function() {
  this.timeout(120000)
  this.slow(20000)

  const { SEED, ACCOUNTS } = getEnv()

  beforeEach(function() {
    seedTestRandom(SEED)
  })

  before(async function() {
    const controller = await Controller.getSingleton()
    controller.setEnabled(false)
  })
  after(async function() {
    const controller = await Controller.getSingleton()
    controller.setEnabled(true)
  })

  ACCOUNTS.forEach(ACCOUNT_DATA => {
    describe(`${stringifyAccountData(ACCOUNT_DATA)} detecting changes`, function() {
      let account
      beforeEach('set up account', async function() {
        account = await Account.create({ ...ACCOUNT_DATA, ...(await createTestLocalRoot()) })
        await account.init()
      })
      afterEach('clean up account', async function() {
        DUMP_LOGS(this.currentTest)
        if (!account) return
        await clearLocalResource(account)
        await account.delete()
        account = null
      })

      async function storedState() {
        const mappings = await account.storage.getMappings()
        const cache = await account.storage.getCache()
        return JSON.stringify({ mappings: mappings.getSnapshot(), cache: cache.count() + cache.countFolders() })
      }

      async function seed(localResource, localRoot) {
        await localResource.createBookmark(new Bookmark({
          title: 'seed',
          url: 'http://seed.example/',
          parentId: localRoot,
          location: ItemLocation.LOCAL,
        }))
        await account.sync()
        expect(account.getData().error).to.not.be.ok
      }

      it('should report a profile that never synced as needing its first sync', async function() {
        const localResource = await account.getResource()
        const localRoot = (await localResource.getBookmarksTree(true)).id
        await localResource.createBookmark(new Bookmark({
          title: 'local',
          url: 'http://local.example/',
          parentId: localRoot,
          location: ItemLocation.LOCAL,
        }))

        const pending = await account.detectChanges()
        expect(pending).to.deep.equal({ local: 0, server: 0, initial: true })
        expect(account.getData().pendingChanges).to.deep.equal(pending)
        expect(account.getData().error).to.not.be.ok

        const serverTree = await getAllBookmarks(account)
        expect(serverTree.count()).to.equal(0)
      })

      it('should count the changes on both sides without syncing them', async function() {
        const localResource = await account.getResource()
        const localRoot = (await localResource.getBookmarksTree(true)).id
        await seed(localResource, localRoot)
        const lastSync = account.getData().lastSync

        // Local: a folder with two bookmarks -- three items for the server
        const folderId = await localResource.createFolder(new Folder({
          title: 'new folder',
          parentId: localRoot,
          location: ItemLocation.LOCAL,
        }))
        for (const i of [1, 2]) {
          await localResource.createBookmark(new Bookmark({
            title: 'local' + i,
            url: `http://local${i}.example/`,
            parentId: folderId,
            location: ItemLocation.LOCAL,
          }))
        }
        // Server: one bookmark for the local side
        await withSyncConnection(account, async() => {
          const serverRoot = await account.server.getBookmarksTree(true)
          await account.server.createBookmark(new Bookmark({
            title: 'remote',
            url: 'http://remote.example/',
            parentId: serverRoot.id,
            location: ItemLocation.SERVER,
          }))
        })

        const stateBefore = await storedState()
        const localCountBefore = (await localResource.getBookmarksTree(true)).count()
        const serverCountBefore = (await getAllBookmarks(account)).count()

        const pending = await account.detectChanges()
        expect(account.getData().error).to.not.be.ok
        expect(pending).to.deep.equal({ local: 1, server: 3 })
        expect(account.getData().pendingChanges).to.deep.equal(pending)
        expect(account.getData().lastCheck).to.be.ok
        expect(account.getData().lastSync).to.equal(lastSync)

        // Nothing was synced, nor stored
        expect((await localResource.getBookmarksTree(true)).count()).to.equal(localCountBefore)
        expect((await getAllBookmarks(account)).count()).to.equal(serverCountBefore)
        expect(await storedState()).to.equal(stateBefore)

        // The sync takes care of all of it and clears the pending changes
        await account.sync()
        expect(account.getData().error).to.not.be.ok
        expect(account.getData().pendingChanges).to.not.be.ok
        expect((await localResource.getBookmarksTree(true)).count()).to.equal(4)
        expect((await getAllBookmarks(account)).count()).to.equal(4)

        expect(await account.detectChanges()).to.equal(null)
        expect(account.getData().pendingChanges).to.equal(null)
      })

      it('should only count the changes towards the server for an overwrite profile', async function() {
        const localResource = await account.getResource()
        const localRoot = (await localResource.getBookmarksTree(true)).id
        await account.setData({ strategy: 'overwrite' })
        await seed(localResource, localRoot)

        await localResource.createBookmark(new Bookmark({
          title: 'local',
          url: 'http://local.example/',
          parentId: localRoot,
          location: ItemLocation.LOCAL,
        }))

        const pending = await account.detectChanges()
        expect(account.getData().error).to.not.be.ok
        expect(pending).to.deep.equal({ local: 0, server: 1 })
        expect((await getAllBookmarks(account)).count()).to.equal(1)
      })

      it('should not drop a sync that starts while a check is running', async function() {
        const localResource = await account.getResource()
        const localRoot = (await localResource.getBookmarksTree(true)).id
        await seed(localResource, localRoot)
        await localResource.createBookmark(new Bookmark({
          title: 'local',
          url: 'http://local.example/',
          parentId: localRoot,
          location: ItemLocation.LOCAL,
        }))

        const check = account.detectChanges()
        await account.sync()
        await check
        expect(account.getData().error).to.not.be.ok
        expect((await getAllBookmarks(account)).count()).to.equal(2)
        expect(account.getData().pendingChanges).to.not.be.ok
      })
    })
  })
})
