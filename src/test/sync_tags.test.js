import Account from '../lib/Account'
import { Bookmark, Folder, ItemLocation, ItemType } from '../lib/Tree'
import * as AsyncParallel from 'async-parallel'
import Controller from '../lib/Controller'
import {
  clearLocalResource,
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
    describe(`${stringifyAccountData(ACCOUNT_DATA)} Tag Sync`, function() {
      let account
      beforeEach('set up account', async function() {
        account = await Account.create(ACCOUNT_DATA)
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
        if (!localCapabilities.supportsTags || !serverCapabilities.supportsTags) {
          this.skip()
        }
      })
      afterEach('clean up account', async function() {
        DUMP_LOGS(this.currentTest)
        if (!account) return
        await clearLocalResource(account)
        if (ACCOUNT_DATA.type !== 'fake') {
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
          url: 'http://ur.l/',
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

        const serverBookmark = await findServerBookmark('http://ur.l/')
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
            url: 'http://ur.l/',
            tags: ['from-server'],
            parentId: serverFolder.id,
            location: ItemLocation.SERVER,
          }))
        })

        await account.sync()
        expect(account.getData().error).to.not.be.ok

        const localBookmark = await findLocalBookmark('http://ur.l/')
        expect(localBookmark).to.be.ok
        expect(localBookmark.tags).to.deep.equal(['from-server'])
      })

      it('should propagate a tag added locally', async function() {
        const { localResource, bookmarkId } = await setUpTaggedBookmark(['foo'])

        await localResource.updateBookmark(new Bookmark({
          id: bookmarkId,
          title: 'url',
          url: 'http://ur.l/',
          tags: ['foo', 'added'],
          parentId: (await findLocalBookmark('http://ur.l/')).parentId,
          location: ItemLocation.LOCAL,
        }))

        await account.sync()
        expect(account.getData().error).to.not.be.ok

        const serverBookmark = await findServerBookmark('http://ur.l/')
        expect([...serverBookmark.tags].sort()).to.deep.equal(['added', 'foo'])
      })

      it('should propagate a tag removed locally', async function() {
        const { localResource, bookmarkId } = await setUpTaggedBookmark(['foo', 'bar'])

        await localResource.updateBookmark(new Bookmark({
          id: bookmarkId,
          title: 'url',
          url: 'http://ur.l/',
          tags: ['foo'],
          parentId: (await findLocalBookmark('http://ur.l/')).parentId,
          location: ItemLocation.LOCAL,
        }))

        await account.sync()
        expect(account.getData().error).to.not.be.ok

        const serverBookmark = await findServerBookmark('http://ur.l/')
        expect(serverBookmark.tags).to.deep.equal(['foo'])
      })

      it('should propagate a tag changed on the server', async function() {
        await setUpTaggedBookmark(['foo'])

        const serverBookmark = await findServerBookmark('http://ur.l/')
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

        const localBookmark = await findLocalBookmark('http://ur.l/')
        expect([...localBookmark.tags].sort()).to.deep.equal(['foo', 'server-side'])
      })

      it('should not resurrect tags removed on the server', async function() {
        await setUpTaggedBookmark(['foo', 'bar'])

        const serverBookmark = await findServerBookmark('http://ur.l/')
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

        const localBookmark = await findLocalBookmark('http://ur.l/')
        expect(localBookmark.tags || []).to.deep.equal([])
      })

      it('should leave tags alone when only the title changes', async function() {
        const { localResource, bookmarkId } = await setUpTaggedBookmark(['foo', 'bar'])

        await localResource.updateBookmark(new Bookmark({
          id: bookmarkId,
          title: 'a new title',
          url: 'http://ur.l/',
          parentId: (await findLocalBookmark('http://ur.l/')).parentId,
          location: ItemLocation.LOCAL,
        }))

        await account.sync()
        expect(account.getData().error).to.not.be.ok

        const serverBookmark = await findServerBookmark('http://ur.l/')
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
          url: 'http://ur.l/',
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
                  new Bookmark({ title: 'url', url: 'http://ur.l/', tags: ['foo'] })
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

        const serverBookmark = await findServerBookmark('http://ur.l/')
        const localBookmark = await findLocalBookmark('http://ur.l/')
        expect([...serverBookmark.tags].sort()).to.deep.equal(['bar', 'foo'])
        expect([...localBookmark.tags].sort()).to.deep.equal(['bar', 'foo'])
      })

      it('should converge when tags are only reordered', async function() {
        const { localResource, bookmarkId } = await setUpTaggedBookmark(['foo', 'bar'])

        await localResource.updateBookmark(new Bookmark({
          id: bookmarkId,
          title: 'url',
          url: 'http://ur.l/',
          tags: ['bar', 'foo'],
          parentId: (await findLocalBookmark('http://ur.l/')).parentId,
          location: ItemLocation.LOCAL,
        }))

        await account.sync()
        expect(account.getData().error).to.not.be.ok

        // The reorder is written back once so that both sides agree again --
        // no tag may be lost or duplicated in the process
        const serverBookmark = await findServerBookmark('http://ur.l/')
        expect(serverBookmark.tags).to.deep.equal(['bar', 'foo'])

        // ...and the next sync has nothing left to do
        await account.sync()
        expect(account.getData().error).to.not.be.ok
        expect((await findServerBookmark('http://ur.l/')).tags).to.deep.equal(['bar', 'foo'])
        expect((await findLocalBookmark('http://ur.l/')).tags).to.deep.equal(['bar', 'foo'])
      })
    })
  })
})
