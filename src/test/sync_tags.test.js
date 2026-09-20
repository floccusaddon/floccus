import Account from '../lib/Account'
import { Bookmark, Folder, ItemLocation, ItemType } from '../lib/Tree'
import * as AsyncParallel from 'async-parallel'
import Controller from '../lib/Controller'
import {
  clearLocalResource,
  createTestLocalRoot,
  DUMP_LOGS,
  expect,
  expectTreeEqual,
  getAllBookmarks,
  getEnv,
  seedTestRandom,
  stringifyAccountData,
  withSyncConnection
} from './utils'

describe('Floccus', function() {
  this.timeout(120000) // no test should run longer than 120s
  this.slow(20000) // 20s is slow

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
    // The ' test ' in the title is load-bearing: CI greps for '<adapter> test'
    // (see .github/workflows/android-appium.yml), so a suite without it is
    // silently filtered out of the Android and Selenium runs.
    describe(`${stringifyAccountData(ACCOUNT_DATA)} test ${ACCOUNT_DATA.serverRoot ? 'subfolder' : 'root'} Tag Sync`, function() {
      let account
      let tagsSupported
      let bookmarkUrl

      beforeEach('set up account', async function() {
        // Nextcloud keys bookmarks by URL per user, and deleting one only
        // soft-deletes its tree entry -- the bookmark row and its tags stay in
        // the trash. Re-creating the same URL calls softUndeleteEntry() and
        // merges the tags in with tagMapper->addTo() (create appends where
        // update replaces), so a shared URL would carry tags from one test into
        // the next. Both Nextcloud profiles stringify the same, hence the
        // root/subfolder part.
        const scope = `${stringifyAccountData(ACCOUNT_DATA)}-${ACCOUNT_DATA.serverRoot ? 'subfolder' : 'root'}`
        const slug = `${scope}-${this.currentTest.title}`.replace(/[^a-z0-9]+/gi, '-').toLowerCase()
        bookmarkUrl = `http://ur.l/${slug}/`

        account = await Account.create({...ACCOUNT_DATA, ...(await createTestLocalRoot())})
        if (ACCOUNT_DATA.type === 'fake') {
          account.server.bookmarksCache = new Folder({
            id: '',
            title: 'root',
            location: ItemLocation.SERVER
          })
        }
        await account.init()

        // Tags only travel if both ends of this account can hold them. The
        // browser's bookmark API can't, so in the extension this whole suite is
        // moot -- skip rather than assert the wrong thing.
        const localCapabilities = await (await account.getResource()).getCapabilities()
        const serverCapabilities = await account.server.getCapabilities()
        tagsSupported = Boolean(localCapabilities.supportsTags && serverCapabilities.supportsTags)
        if (!tagsSupported) {
          this.skip()
        }
      })
      afterEach('clean up account', async function() {
        DUMP_LOGS(this.currentTest)
        if (!account) return
        await clearLocalResource(account)
        // A skipped suite never got as far as touching the server, so don't
        // spend a round trip per skipped test tearing down nothing
        if (tagsSupported && ACCOUNT_DATA.type !== 'fake') {
          await account.setData({ serverRoot: null })
          account.lockTimeout = 0
          const tree = await getAllBookmarks(account)
          await withSyncConnection(account, async() => {
            await AsyncParallel.each(tree.children, async(child) => {
              if (child instanceof Folder) {
                await account.server.removeFolder(child)
              } else {
                await account.server.removeBookmark(child)
              }
            })
          })
        }
        await account.delete()
      })

      /**
       * Create `foo/` with one tagged bookmark in it and sync it up.
       */
      const setUpTaggedBookmark = async(tags) => {
        const localResource = await account.getResource()
        const localRoot = (await localResource.getBookmarksTree(true)).id
        const fooFolder = await localResource.createFolder(new Folder({
          title: 'foo',
          parentId: localRoot,
          location: ItemLocation.LOCAL,
        }))
        const bookmarkId = await localResource.createBookmark(new Bookmark({
          title: 'url',
          url: bookmarkUrl,
          tags,
          parentId: fooFolder,
          location: ItemLocation.LOCAL,
        }))
        await account.sync()
        expect(account.getData().error).to.not.be.ok
        return { localResource, localRoot, fooFolder, bookmarkId }
      }

      const findServerBookmark = async(url) => {
        const tree = await getAllBookmarks(account)
        return tree.findItemFilter(ItemType.BOOKMARK, (item) => item.url === url)
      }

      const findLocalBookmark = async(url) => {
        const localResource = await account.getResource()
        const tree = await localResource.getBookmarksTree(true)
        return tree.findItemFilter(ItemType.BOOKMARK, (item) => item.url === url)
      }

      it('should upload tags of a new local bookmark', async function() {
        await setUpTaggedBookmark(['foo', 'bar'])

        const serverBookmark = await findServerBookmark(bookmarkUrl)
        expect(serverBookmark).to.be.ok
        expect([...serverBookmark.tags].sort()).to.deep.equal(['bar', 'foo'])
      })

      it('should download tags of a new server bookmark', async function() {
        const localResource = await account.getResource()
        const localRoot = (await localResource.getBookmarksTree(true)).id
        await localResource.createFolder(new Folder({
          title: 'foo',
          parentId: localRoot,
          location: ItemLocation.LOCAL,
        }))
        await account.sync()
        expect(account.getData().error).to.not.be.ok

        const serverTree = await getAllBookmarks(account)
        const serverFolder = serverTree.findItemFilter(ItemType.FOLDER, (item) => item.title === 'foo')
        await withSyncConnection(account, async() => {
          await account.server.createBookmark(new Bookmark({
            title: 'url',
            url: bookmarkUrl,
            tags: ['from-server'],
            parentId: serverFolder.id,
            location: ItemLocation.SERVER,
          }))
        })

        await account.sync()
        expect(account.getData().error).to.not.be.ok

        const localBookmark = await findLocalBookmark(bookmarkUrl)
        expect(localBookmark).to.be.ok
        expect(localBookmark.tags).to.deep.equal(['from-server'])
      })

      it('should propagate a tag added locally', async function() {
        const { localResource, bookmarkId } = await setUpTaggedBookmark(['foo'])

        await localResource.updateBookmark(new Bookmark({
          id: bookmarkId,
          title: 'url',
          url: bookmarkUrl,
          tags: ['foo', 'added'],
          parentId: (await findLocalBookmark(bookmarkUrl)).parentId,
          location: ItemLocation.LOCAL,
        }))

        await account.sync()
        expect(account.getData().error).to.not.be.ok

        const serverBookmark = await findServerBookmark(bookmarkUrl)
        expect([...serverBookmark.tags].sort()).to.deep.equal(['added', 'foo'])
      })

      it('should propagate a tag removed locally', async function() {
        const { localResource, bookmarkId } = await setUpTaggedBookmark(['foo', 'bar'])

        await localResource.updateBookmark(new Bookmark({
          id: bookmarkId,
          title: 'url',
          url: bookmarkUrl,
          tags: ['foo'],
          parentId: (await findLocalBookmark(bookmarkUrl)).parentId,
          location: ItemLocation.LOCAL,
        }))

        await account.sync()
        expect(account.getData().error).to.not.be.ok

        const serverBookmark = await findServerBookmark(bookmarkUrl)
        expect(serverBookmark.tags).to.deep.equal(['foo'])
      })

      it('should propagate a tag changed on the server', async function() {
        await setUpTaggedBookmark(['foo'])

        const serverBookmark = await findServerBookmark(bookmarkUrl)
        await withSyncConnection(account, async() => {
          await account.server.updateBookmark(new Bookmark({
            id: serverBookmark.id,
            title: serverBookmark.title,
            url: serverBookmark.url,
            tags: ['foo', 'server-side'],
            parentId: serverBookmark.parentId,
            location: ItemLocation.SERVER,
          }))
        })

        await account.sync()
        expect(account.getData().error).to.not.be.ok

        const localBookmark = await findLocalBookmark(bookmarkUrl)
        expect([...localBookmark.tags].sort()).to.deep.equal(['foo', 'server-side'])
      })

      it('should not resurrect tags removed on the server', async function() {
        await setUpTaggedBookmark(['foo', 'bar'])

        const serverBookmark = await findServerBookmark(bookmarkUrl)
        await withSyncConnection(account, async() => {
          await account.server.updateBookmark(new Bookmark({
            id: serverBookmark.id,
            title: serverBookmark.title,
            url: serverBookmark.url,
            tags: [],
            parentId: serverBookmark.parentId,
            location: ItemLocation.SERVER,
          }))
        })

        await account.sync()
        expect(account.getData().error).to.not.be.ok

        const localBookmark = await findLocalBookmark(bookmarkUrl)
        expect(localBookmark.tags || []).to.deep.equal([])
      })

      it('should leave tags alone when only the title changes', async function() {
        const { localResource, bookmarkId } = await setUpTaggedBookmark(['foo', 'bar'])

        await localResource.updateBookmark(new Bookmark({
          id: bookmarkId,
          title: 'a new title',
          url: bookmarkUrl,
          parentId: (await findLocalBookmark(bookmarkUrl)).parentId,
          location: ItemLocation.LOCAL,
        }))

        await account.sync()
        expect(account.getData().error).to.not.be.ok

        const serverBookmark = await findServerBookmark(bookmarkUrl)
        expect(serverBookmark.title).to.equal('a new title')
        expect([...serverBookmark.tags].sort()).to.deep.equal(['bar', 'foo'])
      })

      it('should keep tags across a move', async function() {
        const { localResource, localRoot, bookmarkId } = await setUpTaggedBookmark(['foo'])
        const otherFolder = await localResource.createFolder(new Folder({
          title: 'other',
          parentId: localRoot,
          location: ItemLocation.LOCAL,
        }))

        await localResource.updateBookmark(new Bookmark({
          id: bookmarkId,
          title: 'url',
          url: bookmarkUrl,
          tags: ['foo'],
          parentId: otherFolder,
          location: ItemLocation.LOCAL,
        }))

        await account.sync()
        expect(account.getData().error).to.not.be.ok

        const tree = await getAllBookmarks(account)
        expectTreeEqual(
          tree,
          new Folder({
            title: tree.title,
            children: [
              new Folder({ title: 'foo', children: [] }),
              new Folder({
                title: 'other',
                children: [
                  new Bookmark({ title: 'url', url: bookmarkUrl, tags: ['foo'] })
                ]
              }),
            ]
          }),
          true,
          false,
          true
        )
      })

      it('should converge after a second sync without further changes', async function() {
        await setUpTaggedBookmark(['foo', 'bar'])

        await account.sync()
        expect(account.getData().error).to.not.be.ok

        const serverBookmark = await findServerBookmark(bookmarkUrl)
        const localBookmark = await findLocalBookmark(bookmarkUrl)
        expect([...serverBookmark.tags].sort()).to.deep.equal(['bar', 'foo'])
        expect([...localBookmark.tags].sort()).to.deep.equal(['bar', 'foo'])
      })

      it('should not treat a reordering of tags as a change', async function() {
        const { localResource, bookmarkId } = await setUpTaggedBookmark(['aaa', 'zzz'])

        // normalizeTags sorts, so writing the same tags in a different order
        // is not a change at all -- nothing should reach the server
        await localResource.updateBookmark(new Bookmark({
          id: bookmarkId,
          title: 'url',
          url: bookmarkUrl,
          tags: ['zzz', 'aaa'],
          parentId: (await findLocalBookmark(bookmarkUrl)).parentId,
          location: ItemLocation.LOCAL,
        }))

        await account.sync()
        expect(account.getData().error).to.not.be.ok

        expect((await findServerBookmark(bookmarkUrl)).tags).to.deep.equal(['aaa', 'zzz'])
        expect((await findLocalBookmark(bookmarkUrl)).tags).to.deep.equal(['aaa', 'zzz'])
      })

      it('should ignore the order a server returns tags in', async function() {
        if (ACCOUNT_DATA.type !== 'fake') {
          // Forcing a specific server-side tag order means reaching into the
          // server's tree, which only the fake one lets us do
          return this.skip()
        }
        await setUpTaggedBookmark(['aaa', 'zzz'])

        // Linkwarden hands a bookmark's tags back ordered by tag identity, not
        // in the order they were written (its query specifies no ordering), so
        // our write never comes back the way we sent it. Make the fake server
        // behave the same way.
        const serverBookmark = account.server.bookmarksCache.findItemFilter(
          ItemType.BOOKMARK,
          (item) => item.url === bookmarkUrl
        )
        serverBookmark.tags = ['zzz', 'aaa']

        const serverUpdates = []
        const updateBookmark = account.server.updateBookmark.bind(account.server)
        account.server.updateBookmark = (bookmark) => {
          serverUpdates.push(bookmark.id)
          return updateBookmark(bookmark)
        }

        // Sorting on the way in means the server's order never reaches the
        // diff: no write is provoked and what we hold doesn't budge, however
        // often we sync
        await account.sync()
        await account.sync()
        expect(account.getData().error).to.not.be.ok
        expect((await findLocalBookmark(bookmarkUrl)).tags).to.deep.equal(['aaa', 'zzz'])
        expect(serverUpdates).to.deep.equal([])
      })
    })
  })
})
