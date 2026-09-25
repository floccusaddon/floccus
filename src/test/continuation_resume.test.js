import Account from '../lib/Account'
import { Bookmark, Folder, ItemLocation } from '../lib/Tree'
import Controller from '../lib/Controller'
import { NetworkError } from '../errors/Error'
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
    })
  })
})
