import Account from '../lib/Account'
import { Bookmark, Folder, ItemLocation } from '../lib/Tree'
import Controller from '../lib/Controller'
import { NetworkError } from '../errors/Error'
import NativeDatabase from '../lib/native/NativeDatabase'
import {
  clearLocalResource,
  createTestLocalRoot,
  DUMP_LOGS,
  expect,
  getAllBookmarks,
  getEnv,
  seedTestRandom,
  stringifyAccountData,
} from './utils'

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
    describe(`${stringifyAccountData(ACCOUNT_DATA)} continuation resume`, function() {
      let account
      beforeEach('set up account', async function() {
        // Continuations are only persisted for non-atomic servers
        if (ACCOUNT_DATA.type !== 'fake-nc-bookmarks') {
          return this.skip()
        }
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

      it('should not re-execute actions done after the last progress tick when a sync fails', async function() {
        const localResource = await account.getResource()
        const localRoot = (await localResource.getBookmarksTree(true)).id

        // A first sync, so that the cache isn't empty and the second one runs
        // the default strategy rather than merge
        await localResource.createBookmark(new Bookmark({
          title: 'seed',
          url: 'http://seed.example/',
          parentId: localRoot,
          location: ItemLocation.LOCAL,
        }))
        await account.sync()
        expect(account.getData().error).to.not.be.ok

        // Empty folders: each is one CREATE on the server, done as soon as the
        // folder exists (no bulk import), and unlike bookmarks a folder that is
        // created twice is a duplicate on nextcloud-bookmarks as well
        const titles = ['f1', 'f2', 'f3', 'f4', 'f5']
        for (const title of titles) {
          await localResource.createFolder(new Folder({
            title,
            parentId: localRoot,
            location: ItemLocation.LOCAL,
          }))
        }

        // Production persists the continuation on a throttled tick every
        // 1.5-10s; under test those ticks are off (queueProgressUpdate), so play
        // one by hand: right before the third create, i.e. with two creates
        // done. The third create then goes through after that tick, and the
        // fourth fails with a network error, which keeps the continuation.
        const server = account.server
        const originalCreateFolder = server.createFolder.bind(server)
        let calls = 0
        server.createFolder = async(folder) => {
          calls++
          if (calls === 3) {
            await account.progressCallback(0.6, 2)
          }
          if (calls === 4) {
            throw new NetworkError()
          }
          return originalCreateFolder(folder)
        }

        await account.sync()
        server.createFolder = originalCreateFolder
        expect(account.getData().error).to.contain('E017')

        // Make sure the next sync resumes rather than starting over, so that
        // this test fails for the reason it is about
        const continuation = await account.storage.getCurrentContinuation()
        expect(continuation).to.be.ok

        await account.sync()
        expect(account.getData().error).to.not.be.ok

        const serverTree = await getAllBookmarks(account)
        const serverTitles = serverTree.children
          .filter(item => item instanceof Folder)
          .map(item => item.title)
          .sort()
        // f3 was created on the server after the last persisted tick; resuming
        // from that tick creates it a second time
        expect(serverTitles).to.deep.equal(titles)

        await account.sync()
        expect(account.getData().error).to.not.be.ok
        const localTitles = (await localResource.getBookmarksTree(true)).children
          .filter(item => item instanceof Folder)
          .map(item => item.title)
          .sort()
        expect(localTitles).to.deep.equal(titles)
      })

      /**
       * Interrupt the sync at the first reorder it executes, i.e. once
       * everything before the reorderings is done and the continuation holds
       * nothing but the reorders.
       */
      function interruptAtFirstReorder(syncProcess) {
        const executeReorderings = syncProcess.executeReorderings.bind(syncProcess)
        let armed = false
        syncProcess.executeReorderings = async(resource, reorderings) => {
          if (!armed && reorderings.peekActions().some(action => action.order.length > 1)) {
            armed = true
            syncProcess.setInterruptAfterActions(syncProcess.getActionsDone() + 1)
          }
          return executeReorderings(resource, reorderings)
        }
      }

      async function createFolderWithBookmarks(localResource, parentId) {
        const folderId = await localResource.createFolder(new Folder({
          title: 'ordered',
          parentId,
          location: ItemLocation.LOCAL,
        }))
        for (const i of [1, 2, 3]) {
          await localResource.createBookmark(new Bookmark({
            title: 'bm' + i,
            url: `http://bm${i}.example/`,
            parentId: folderId,
            location: ItemLocation.LOCAL,
          }))
        }
        // A second REORDER with something to do, so that interrupting the
        // first one leaves work behind -- an interrupt at the last one lets the
        // sync finish as if nothing happened
        const subFolderId = await localResource.createFolder(new Folder({
          title: 'sub',
          parentId: folderId,
          location: ItemLocation.LOCAL,
        }))
        for (const i of [1, 2]) {
          await localResource.createBookmark(new Bookmark({
            title: 'sub' + i,
            url: `http://sub${i}.example/`,
            parentId: subFolderId,
            location: ItemLocation.LOCAL,
          }))
        }
      }

      function expectOrderedFolder(tree) {
        const folder = tree.children.find(item => item.title === 'ordered')
        expect(folder.children.map(item => item.title)).to.deep.equal(['bm1', 'bm2', 'bm3', 'sub'])
        const subFolder = folder.children.find(item => item.title === 'sub')
        expect(subFolder.children.map(item => item.title)).to.deep.equal(['sub1', 'sub2'])
      }

      async function expectTitlesInOrder(account) {
        expectOrderedFolder(await getAllBookmarks(account))
        expectOrderedFolder(await (await account.getResource()).getBookmarksTree(true))
      }

      /**
       * Run a sync with the given strategy that is interrupted in its
       * reordering stage, and return the continuation it leaves behind
       */
      async function interruptInReorderingStage(strategy) {
        const localResource = await account.getResource()
        const localRoot = (await localResource.getBookmarksTree(true)).id

        if (!strategy) {
          // A first sync, so that the cache isn't empty and the second one runs
          // the default strategy rather than merge
          await localResource.createBookmark(new Bookmark({
            title: 'seed',
            url: 'http://seed.example/',
            parentId: localRoot,
            location: ItemLocation.LOCAL,
          }))
          await account.sync()
          expect(account.getData().error).to.not.be.ok
        }

        // Created on the server by a bulk import, which plans a REORDER for it
        await createFolderWithBookmarks(localResource, localRoot)

        account.onSyncProcessCreated = interruptAtFirstReorder
        await account.sync(strategy)
        account.onSyncProcessCreated = null
        expect(account.getData().error).to.contain('E026')

        const continuation = await account.storage.getCurrentContinuation()
        expect(continuation).to.be.ok
        return continuation
      }

      /** Sync with the given arguments, and return how often it scanned */
      async function syncCountingScans(...args) {
        let scans = 0
        account.onSyncProcessCreated = (syncProcess) => {
          // The default strategies scan with getDiffs, unidirectional with getDiff
          const method = 'getDiff' in syncProcess ? 'getDiff' : 'getDiffs'
          const scan = syncProcess[method].bind(syncProcess)
          syncProcess[method] = async() => {
            scans++
            return scan()
          }
        }
        await account.sync(...args)
        account.onSyncProcessCreated = null
        expect(account.getData().error).to.not.be.ok
        return scans
      }

      const RESUMES = [
        { interrupted: undefined, resumed: [], label: 'default, resumed by a plain sync' },
        { interrupted: undefined, resumed: [null, true], label: 'default, resumed by a forced sync' },
        { interrupted: undefined, resumed: ['default'], label: 'default, resumed by asking for it' },
        { interrupted: 'overwrite', resumed: [], label: 'overwrite, resumed by a plain sync' },
        { interrupted: 'overwrite', resumed: ['overwrite'], label: 'overwrite, resumed by asking for it' },
      ]
      RESUMES.forEach(({ interrupted, resumed, label }) => {
        it(`should resume an interrupted reordering stage without planning the sync anew (${label})`, async function() {
          const continuation = await interruptInReorderingStage(interrupted)
          if (interrupted) {
            expect(continuation.strategy).to.equal('unidirectional')
            expect(continuation.revertReorders).to.be.ok
          } else {
            expect(continuation.strategy).to.equal('default')
            expect(continuation.serverReorders).to.be.ok
          }

          // Everything before the reorderings has been executed: scanning and
          // planning again executes a sync of its own, whose reorders are
          // dropped in favour of the stored ones
          expect(await syncCountingScans(...resumed)).to.equal(0)

          await expectTitlesInOrder(account)
        })
      })

      it('should not resume an interrupted overwrite when asked for the opposite direction', async function() {
        await interruptInReorderingStage('overwrite')
        // Overwriting local now is a different sync altogether
        expect(await syncCountingScans('slave')).to.equal(1)
      })

      it('should sync normally if the stored continuation cannot be read', async function() {
        const localResource = await account.getResource()
        const localRoot = (await localResource.getBookmarksTree(true)).id
        await localResource.createBookmark(new Bookmark({
          title: 'seed',
          url: 'http://seed.example/',
          parentId: localRoot,
          location: ItemLocation.LOCAL,
        }))
        await account.sync()
        expect(account.getData().error).to.not.be.ok

        // A continuation with an action row that isn't JSON any more
        await NativeDatabase.batch([
          {
            statement: 'INSERT OR REPLACE INTO continuations (account_id, strategy, created_at, structure) VALUES (?,?,?,?)',
            values: [account.id, 'default', Date.now(), JSON.stringify({
              meta: {},
              members: { serverReorders: { kind: 'diff', diff: 'corrupt' } },
              diffIds: ['corrupt'],
            })],
          },
          {
            statement: 'INSERT OR REPLACE INTO continuation_actions (account_id, diff_id, seq, action) VALUES (?,?,?,?)',
            values: [account.id, 'corrupt', 0, '{"type": "REORDER", '],
          },
        ])

        // An unreadable continuation is as good as none -- it must not fail the
        // sync, which would re-initialize the account and wipe its cache and
        // mappings over it
        const init = account.init.bind(account)
        let inits = 0
        account.init = async() => {
          inits++
          return init()
        }
        await localResource.createBookmark(new Bookmark({
          title: 'second',
          url: 'http://second.example/',
          parentId: localRoot,
          location: ItemLocation.LOCAL,
        }))
        await account.sync()
        account.init = init
        expect(account.getData().error).to.not.be.ok
        expect(inits).to.equal(0)

        const serverTree = await getAllBookmarks(account)
        expect(serverTree.children.map(item => item.title).sort()).to.deep.equal(['second', 'seed'])
        // The completed sync has cleared the unreadable rows along with it
        expect(await account.storage.getCurrentContinuation()).to.not.be.ok
      })
    })
  })
})
