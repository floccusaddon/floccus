import Account from '../lib/Account'
import { Bookmark, ItemLocation } from '../lib/Tree'
import Controller from '../lib/Controller'
import { NetworkError } from '../errors/Error'
import {
  clearLocalResource,
  createTestLocalRoot,
  DUMP_LOGS,
  expect,
  getEnv,
  seedTestRandom,
  stringifyAccountData,
} from './utils'

describe('Floccus', function() {
  this.timeout(120000)
  const { SEED, ACCOUNTS } = getEnv()
  beforeEach(function() { seedTestRandom(SEED) })
  before(async function() { (await Controller.getSingleton()).setEnabled(false) })
  after(async function() { (await Controller.getSingleton()).setEnabled(true) })

  ACCOUNTS.forEach(ACCOUNT_DATA => {
    describe(`${stringifyAccountData(ACCOUNT_DATA)} atomic upload failure`, function() {
      let account
      beforeEach(async function() {
        if (ACCOUNT_DATA.type !== 'fake') return this.skip()
        account = await Account.create({ ...ACCOUNT_DATA, ...(await createTestLocalRoot()) })
        await account.init()
      })
      afterEach(async function() {
        DUMP_LOGS(this.currentTest)
        if (!account) return
        await clearLocalResource(account)
        await account.delete()
        account = null
      })

      // Make the fake server behave like WebDAV: changes only land when
      // onSyncComplete uploads them; a failed upload leaves the file as it was
      function makeWebdavLike(failUpload) {
        const server = account.server
        let snapshot
        server.onSyncStart = async() => { snapshot = server.bookmarksCache.clone(true) }
        server.onSyncFail = async() => { server.bookmarksCache = snapshot }
        server.onSyncComplete = async() => {
          if (failUpload()) throw new NetworkError()
        }
      }

      for (const tick of [false, true]) {
        it(`should not revert a local creation when the upload fails${tick ? ' after a progress tick' : ''}`, async function() {
          const localResource = await account.getResource()
          const localRoot = (await localResource.getBookmarksTree(true)).id
          await localResource.createBookmark(new Bookmark({ title: 'seed', url: 'http://seed.example/', parentId: localRoot, location: ItemLocation.LOCAL }))
          await account.sync()
          expect(account.getData().error).to.not.be.ok

          let fail = true
          makeWebdavLike(() => fail)
          if (tick) {
            const orig = account.server.createBookmark.bind(account.server)
            account.server.createBookmark = async(bm) => {
              const id = await orig(bm)
              await account.progressCallback(0.6, 1)
              return id
            }
          }
          await localResource.createBookmark(new Bookmark({ title: 'new', url: 'http://new.example/', parentId: localRoot, location: ItemLocation.LOCAL }))
          await account.sync()
          expect(account.getData().error).to.contain('E017')

          fail = false
          await account.sync()
          expect(account.getData().error).to.not.be.ok
          const local = (await localResource.getBookmarksTree(true)).children.map(i => i.title).sort()
          const server = (await account.server.getBookmarksTree()).children.map(i => i.title).sort()
          expect(local).to.deep.equal(['new', 'seed'])
          expect(server).to.deep.equal(['new', 'seed'])
        })

        it(`should not revert a local deletion when the upload fails${tick ? ' after a progress tick' : ''}`, async function() {
          const localResource = await account.getResource()
          const localRoot = (await localResource.getBookmarksTree(true)).id
          await localResource.createBookmark(new Bookmark({ title: 'seed', url: 'http://seed.example/', parentId: localRoot, location: ItemLocation.LOCAL }))
          const goneId = await localResource.createBookmark(new Bookmark({ title: 'gone', url: 'http://gone.example/', parentId: localRoot, location: ItemLocation.LOCAL }))
          await account.sync()
          expect(account.getData().error).to.not.be.ok

          let fail = true
          makeWebdavLike(() => fail)
          if (tick) {
            const orig = account.server.removeBookmark.bind(account.server)
            account.server.removeBookmark = async(bm) => {
              await orig(bm)
              await account.progressCallback(0.6, 1)
            }
          }
          const tree = await localResource.getBookmarksTree(true)
          await localResource.removeBookmark(tree.findBookmark(goneId))
          await account.sync()
          expect(account.getData().error).to.contain('E017')

          fail = false
          await account.sync()
          expect(account.getData().error).to.not.be.ok
          const local = (await localResource.getBookmarksTree(true)).children.map(i => i.title).sort()
          const server = (await account.server.getBookmarksTree()).children.map(i => i.title).sort()
          expect(local).to.deep.equal(['seed'])
          expect(server).to.deep.equal(['seed'])
        })
      }
    })
  })
})
