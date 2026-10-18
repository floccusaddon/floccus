import Account from '../lib/Account'
import { Bookmark, ItemLocation } from '../lib/Tree'
import Controller from '../lib/Controller'
import { UnsupportedItemError } from '../errors/Error'
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
    describe(`${stringifyAccountData(ACCOUNT_DATA)} unsupported items`, function() {
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

      it('should leave out items the local tree cannot hold, and keep them on the server', async function() {
        // Like LocalTabs with a URL Firefox can't open in a tab
        const unsupportedUrl = 'chrome://newtab/'
        const localResource = await account.getResource()
        const createBookmark = localResource.createBookmark.bind(localResource)
        localResource.createBookmark = async(bookmark) => {
          if (bookmark.url === unsupportedUrl) {
            throw new UnsupportedItemError('Cannot open ' + unsupportedUrl)
          }
          return createBookmark(bookmark)
        }

        const serverTree = await getAllBookmarks(account)
        await withSyncConnection(account, async() => {
          await account.server.createBookmark(new Bookmark({
            parentId: serverTree.id,
            title: 'supported',
            url: 'http://supported.example/',
            location: ItemLocation.SERVER,
          }))
          await account.server.createBookmark(new Bookmark({
            parentId: serverTree.id,
            title: 'unsupported',
            url: unsupportedUrl,
            location: ItemLocation.SERVER,
          }))
        })

        for (let i = 0; i < 2; i++) {
          await account.sync()
          expect(account.getData().error).to.not.be.ok

          const localTree = await localResource.getBookmarksTree(true)
          expect(localTree.children.map(item => item.url))
            .to.deep.equal(['http://supported.example/'])
          // The next sync offers it again rather than taking it for deleted locally
          const mappings = (await account.storage.getMappings()).getSnapshot()
          expect(Object.keys(mappings.ServerToLocal.bookmark)).to.have.lengthOf(1)

          const tree = await getAllBookmarks(account)
          expect(tree.children.map(item => item.url).sort())
            .to.deep.equal(['chrome://newtab/', 'http://supported.example/'])
        }
      })
    })
  })
})
