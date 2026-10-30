import Account from '../lib/Account'
import { Bookmark, Folder, ItemLocation } from '../lib/Tree'
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
    describe(`${stringifyAccountData(ACCOUNT_DATA)} atomic interrupts`, function() {
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

      // What a sync that applied the server's changes locally and was then
      // interrupted leaves behind: the server moved a bookmark out of a folder
      // and removed that folder, and the local side has done the same move
      // already, though not the removal yet
      it('should not duplicate a bookmark moved on both sides out of a folder removed on the server', async function() {
        const localResource = await account.getResource()
        const localRoot = (await localResource.getBookmarksTree(true)).id
        const fromId = await localResource.createFolder(new Folder({ title: 'from', parentId: localRoot, location: ItemLocation.LOCAL }))
        const toId = await localResource.createFolder(new Folder({ title: 'to', parentId: localRoot, location: ItemLocation.LOCAL }))
        const bookmarkId = await localResource.createBookmark(new Bookmark({ title: 'moved', url: 'http://moved.example/', parentId: fromId, location: ItemLocation.LOCAL }))
        await account.sync()
        expect(account.getData().error).to.not.be.ok

        const serverTree = await account.server.getBookmarksTree()
        const serverFrom = serverTree.children.find(item => item.title === 'from')
        const serverTo = serverTree.children.find(item => item.title === 'to')
        const serverBookmark = serverFrom.children[0]
        await account.server.updateBookmark(new Bookmark({ ...serverBookmark, parentId: serverTo.id }))
        await account.server.removeFolder(new Folder({ ...serverFrom, children: [] }))

        const localTree = await localResource.getBookmarksTree(true)
        await localResource.updateBookmark(new Bookmark({ ...localTree.findBookmark(bookmarkId), parentId: toId }))

        await account.sync()
        expect(account.getData().error).to.not.be.ok

        const expected = ['to:moved']
        const flatten = tree => tree.children.map(folder => folder.title + ':' + folder.children.map(item => item.title).join(','))
        expect(flatten(await localResource.getBookmarksTree(true))).to.deep.equal(expected)
        expect(flatten(await account.server.getBookmarksTree())).to.deep.equal(expected)
      })
    })
  })
})
