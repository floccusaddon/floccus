import Account from '../lib/Account'
import { Bookmark, Folder, ItemType } from '../lib/Tree'
import * as AsyncParallel from 'async-parallel'
import Controller from '../lib/Controller'
import {
  clearLocalResource,
  DUMP_LOGS,
  expect,
  expectTreeEqual,
  getAllBookmarks,
  getEnv,
  stringifyAccountData,
  withSyncConnection
} from './utils'
import random from 'random'
import seedrandom from 'seedrandom'

describe('Floccus', function() {
  this.timeout(120000) // no test should run longer than 120s
  this.slow(20000) // 20s is slow

  const { SEED, ACCOUNTS, APP_VERSION } = getEnv()

  beforeEach(function() {
    random.use(seedrandom(SEED))
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
    describe(`${stringifyAccountData(ACCOUNT_DATA)} test ${ACCOUNT_DATA.serverRoot ? 'subfolder' : 'root'} Sync`,
      function() {
        context('with two clients', function() {
          this.timeout(40 * 60000) // timeout after 20mins
          let account1, account2
          beforeEach('set up accounts', async function() {
            account1 = await Account.create(ACCOUNT_DATA)
            await account1.init()
            account2 = await Account.create(ACCOUNT_DATA)
            await account2.init()

            if (ACCOUNT_DATA.type === 'fake') {
              // Wrire both accounts to the same fake db
              account2.server.bookmarksCache = account1.server.bookmarksCache = new Folder(
                { id: '', title: 'root', location: 'Server' }
              )
              account2.server.__defineSetter__('highestId', (id) => {
                account1.server.highestId = id
              })
              account2.server.__defineGetter__('highestId', () => account1.server.highestId)
            }
          })
          afterEach('clean up accounts', async function() {
            DUMP_LOGS(this.currentTest)
            if (ACCOUNT_DATA.type === 'git') {
              await account1.server.clearServer()
            } else if (ACCOUNT_DATA.type !== 'fake') {
              await account1.setData({
                serverRoot: null,
              })
              account1.lockTimeout = 0
              await withSyncConnection(account1, async() => {
                const tree = await account1.server.getBookmarksTree(true)
                await AsyncParallel.each(tree.children, async(child) => {
                  if (child instanceof Folder) {
                    await account1.server.removeFolder(child)
                  } else {
                    await account1.server.removeBookmark(child)
                  }
                })
              })
            }
            if (ACCOUNT_DATA.type === 'google-drive') {
              const fileList = await account1.server.listFiles(
                'name = ' + "'" + ACCOUNT_DATA.bookmark_file + "'"
              )
              const files = fileList.files
              for (const file of files) {
                await account1.server.deleteFile(file.id)
              }
              if (files.length > 1) {
                throw new Error(
                  'Google Drive sync left more than one file behind'
                )
              }
            }
            if (ACCOUNT_DATA.type === 'dropbox') {
              const fileList = await account1.server.listFiles(
                ACCOUNT_DATA.bookmark_file,
                100
              )
              const files = fileList.matches
              for (const file of files) {
                await account1.server.deleteFile(file.metadata.metadata.id)
              }
              if (files.length > 1) {
                throw new Error('Dropbox sync left more than one file behind')
              }
            }
            await clearLocalResource(account1)
            await clearLocalResource(account2)
            await account1.delete()
            await account2.delete()
          })
          it('should not sync two clients at the same time', async function() {
            if (ACCOUNT_DATA.type === 'fake') {
              return this.skip()
            }
            if (ACCOUNT_DATA.type === 'nextcloud-bookmarks' && ['v1.1.2', 'v2.3.4', 'stable3', 'stable4'].includes(APP_VERSION)) {
              return this.skip()
            }
            if (ACCOUNT_DATA.type === 'linkwarden' || ACCOUNT_DATA.type === 'karakeep') {
              return this.skip()
            }
            const localResource1 = await account1.getResource()
            const localRoot1 = (await localResource1.getBookmarksTree()).id
            const fooFolderId = await localResource1.createFolder(new Folder({title: 'foo', parentId: localRoot1}))
            const barFolderId = await localResource1.createFolder(new Folder({title: 'bar', parentId: fooFolderId}))
            await localResource1.createBookmark(new Bookmark({title: 'url', url: 'http://ur.l/', parentId: barFolderId}))

            // Sync once first, so the file exists on GDrive and a lock can be set
            await account1.sync()

            let sync2, resolved = false
            console.log('Starting sync with account 1')
            await withSyncConnection(account1, async() => {
              console.log('Syncing account 1')
              console.log('Starting sync with account 2')
              sync2 = account2.sync()
              sync2.then(() => {
                console.log('Finished sync with account 2')
                resolved = true
              })
              await new Promise(resolve => setTimeout(resolve, 60000))
              expect(account2.getData().error).to.be.not.ok
              expect(account2.getData().scheduled).to.be.ok
              expect(resolved).to.equal(true)
            })
            console.log('Finished sync with account 1')
            sync2 = account2.sync()
            sync2.then(() => {
              console.log('Finished sync with account 2')
              resolved = true
            })
            await new Promise(resolve => setTimeout(resolve, 60000))
            expect(account2.getData().error).to.be.not.ok
            expect(account2.getData().scheduled).to.be.not.ok
            expect(resolved).to.equal(true)
          })
          it('should propagate edits using "last write wins"', async function() {
            const localResource1 = await account1.getResource()
            const localResource2 = await account2.getResource()
            const localRoot1 = (await localResource1.getBookmarksTree()).id
            const fooFolderId = await localResource1.createFolder(new Folder({title: 'foo', parentId: localRoot1}))
            const barFolderId = await localResource1.createFolder(new Folder({title: 'bar', parentId: fooFolderId}))
            let bookmark1
            const bookmark1Id = await localResource1.createBookmark(bookmark1 = new Bookmark({title: 'url', url: 'http://ur.l/', parentId: barFolderId}))
            await account1.sync()
            await account2.sync()

            const serverTree = await getAllBookmarks(account1)

            const tree1 = await account1.localTree.getBookmarksTree(true)
            const tree2 = await account2.localTree.getBookmarksTree(true)
            tree1.title = tree2.title
            expectTreeEqual(tree1, tree2)
            tree2.title = serverTree.title
            expectTreeEqual(tree2, serverTree)

            await localResource1.updateBookmark(new Bookmark({
              ...bookmark1,
              id: bookmark1Id,
              title: 'NEW TITLE FROM ACC1'
            }))
            await account1.sync()

            const bm2 = (await account2.localTree.getBookmarksTree(true))
              .children[0].children[0].children[0]
            let newBookmark2
            await localResource2.updateBookmark(
              newBookmark2 = new Bookmark({
                ...bm2,
                title: 'NEW TITLE FROM ACC1',
              })
            )
            await account2.sync()

            await account1.sync()

            const serverTreeAfterSyncing = await getAllBookmarks(account1)
            expectTreeEqual(
              serverTreeAfterSyncing,
              new Folder({
                title: serverTreeAfterSyncing.title,
                children: [
                  new Folder({
                    title: 'foo',
                    children: [
                      new Folder({
                        title: 'bar',
                        children: [new Bookmark(newBookmark2)]
                      })
                    ]
                  })
                ]
              }),
              false
            )

            const tree1AfterSyncing = await account1.localTree.getBookmarksTree(
              true
            )
            const tree2AfterSyncing = await account2.localTree.getBookmarksTree(
              true
            )
            expectTreeEqual(
              tree1AfterSyncing,
              tree2AfterSyncing,
              false
            )
            tree2AfterSyncing.title = serverTreeAfterSyncing.title
            expectTreeEqual(
              tree2AfterSyncing,
              serverTreeAfterSyncing,
              false
            )
          })
          it('should overtake moves to a different client', async function() {
            const localResource1 = await account1.getResource()
            const localRoot1 = (await localResource1.getBookmarksTree()).id
            const fooFolderId = await localResource1.createFolder(new Folder({title: 'foo', parentId: localRoot1}))
            const barFolderId = await localResource1.createFolder(new Folder({title: 'bar', parentId: fooFolderId}))
            let bookmark1
            const bookmark1Id = await localResource1.createBookmark(bookmark1 = new Bookmark({title: 'url', url: 'http://ur.l/', parentId: barFolderId}))
            const tree1 = await account1.localTree.getBookmarksTree(true)
            await account1.sync()
            await account2.sync()

            const serverTreeAfterFirstSync = await getAllBookmarks(account1)

            const tree1AfterFirstSync = await account1.localTree.getBookmarksTree(
              true
            )
            const tree2AfterFirstSync = await account2.localTree.getBookmarksTree(
              true
            )
            expectTreeEqual(
              tree1AfterFirstSync,
              tree1,
              false
            )
            serverTreeAfterFirstSync.title = tree1.title
            expectTreeEqual(
              serverTreeAfterFirstSync,
              tree1,
              false
            )
            tree2AfterFirstSync.title = tree1.title
            expectTreeEqual(
              tree2AfterFirstSync,
              tree1,
              false
            )
            console.log('First round ok')

            await localResource1.updateBookmark(new Bookmark({...bookmark1.toJSON(), id: bookmark1Id, parentId: fooFolderId}))
            console.log('acc1: Moved bookmark from bar into foo')

            const tree1BeforeSecondSync = await account1.localTree.getBookmarksTree(
              true
            )
            await account1.sync()

            const serverTreeAfterSecondSync = await getAllBookmarks(account1)

            const tree1AfterSecondSync = await account1.localTree.getBookmarksTree(
              true
            )
            expectTreeEqual(
              tree1AfterSecondSync,
              tree1BeforeSecondSync,
              false
            )
            serverTreeAfterSecondSync.title = tree1AfterSecondSync.title
            expectTreeEqual(
              serverTreeAfterSecondSync,
              tree1AfterSecondSync,
              false
            )
            console.log('Second round first half ok')

            await account2.sync()

            const serverTreeAfterThirdSync = await getAllBookmarks(account1)

            const tree2AfterThirdSync = await account2.localTree.getBookmarksTree(
              true
            )
            expectTreeEqual(
              tree2AfterThirdSync,
              tree1AfterSecondSync,
              false
            )
            serverTreeAfterThirdSync.title = tree2AfterThirdSync.title
            expectTreeEqual(
              serverTreeAfterThirdSync,
              tree2AfterThirdSync,
              false
            )
            console.log('Second round second half ok')

            console.log('acc1: final sync')
            await account1.sync()

            const serverTreeAfterFinalSync = await getAllBookmarks(account1)

            const tree1AfterFinalSync = await account1.localTree.getBookmarksTree(
              true
            )
            expectTreeEqual(
              tree1AfterFinalSync,
              tree2AfterThirdSync,
              false
            )
            tree2AfterThirdSync.title = serverTreeAfterFinalSync.title
            expectTreeEqual(
              tree2AfterThirdSync,
              serverTreeAfterFinalSync,
              false
            )
          })
          it('should handle creations inside deletions gracefully', async function() {
            const localResource1 = await account1.getResource()
            const localResource2 = await account2.getResource()
            const localRoot1 = (await localResource1.getBookmarksTree()).id
            const fooFolderId = await localResource1.createFolder(new Folder({title: 'foo', parentId: localRoot1}))
            const barFolderId = await localResource1.createFolder(new Folder({title: 'bar', parentId: fooFolderId}))
            await localResource1.createBookmark(new Bookmark({title: 'url', url: 'http://ur.l/', parentId: barFolderId}))
            const tree1 = await account1.localTree.getBookmarksTree(true)
            await account1.sync()
            expect(account1.getData().error).to.not.be.ok
            await account2.sync()
            expect(account1.getData().error).to.not.be.ok

            const serverTreeAfterFirstSync = await getAllBookmarks(account1)

            const tree1AfterFirstSync = await account1.localTree.getBookmarksTree(
              true
            )
            const tree2AfterFirstSync = await account2.localTree.getBookmarksTree(
              true
            )
            expectTreeEqual(
              tree1AfterFirstSync,
              tree1,
              false
            )
            serverTreeAfterFirstSync.title = tree1.title
            expectTreeEqual(
              serverTreeAfterFirstSync,
              tree1,
              false
            )
            tree2AfterFirstSync.title = tree1.title
            expectTreeEqual(
              tree2AfterFirstSync,
              tree1,
              false
            )
            console.log('First round ok')

            const tree2 = await account2.localTree.getBookmarksTree(true)

            // remove bar folder in account2
            await localResource2.removeFolder(
              new Folder({
                id: tree2.children[0].children[0].id,
                title: tree2.children[0].children[0].title,
                parentId: tree2.children[0].id,
              })
            )
            await localResource1.createBookmark(new Bookmark({
              title: 'url2',
              url: 'http://ur2.l/',
              parentId: barFolderId
            }))
            console.log(
              'acc1: Created bookmark in bar and deleted bar on the other side'
            )

            const tree2BeforeSecondSync = await account2.localTree.getBookmarksTree(
              true
            )
            await account2.sync()
            expect(account2.getData().error).to.not.be.ok

            await account1.sync()
            expect(account1.getData().error).to.not.be.ok

            const serverTreeAfterThirdSync = await getAllBookmarks(account1)

            const tree1AfterThirdSync = await account1.localTree.getBookmarksTree(
              true
            )
            expectTreeEqual(
              tree1AfterThirdSync,
              tree2BeforeSecondSync,
              false
            )
            serverTreeAfterThirdSync.title = tree2BeforeSecondSync.title
            expectTreeEqual(
              serverTreeAfterThirdSync,
              tree2BeforeSecondSync,
              false
            )

            console.log('Second round second half ok')

            console.log('acc2: final sync')
            await account2.sync()
            expect(account2.getData().error).to.not.be.ok

            const serverTreeAfterFinalSync = await getAllBookmarks(account1)

            const tree2AfterFinalSync = await account2.localTree.getBookmarksTree(
              true
            )
            expectTreeEqual(
              tree2AfterFinalSync,
              tree2BeforeSecondSync,
              false
            )
            tree2BeforeSecondSync.title = serverTreeAfterFinalSync.title
            expectTreeEqual(
              serverTreeAfterFinalSync,
              tree2BeforeSecondSync,
              false
            )
          })
          it('should handle duplicate bookmarks in different serverRoot folders', async function() {
            if (ACCOUNT_DATA.type !== 'nextcloud-bookmarks') {
              return this.skip()
            }
            await account1.setData({ serverRoot: '/folder1' })
            await account2.setData({ serverRoot: '/folder2' })

            const localResource1 = await account1.getResource()
            const localRoot1 = (await localResource1.getBookmarksTree()).id

            const fooFolderId = await localResource1.createFolder(new Folder({ title: 'foo', parentId: localRoot1 }))

            const barFolderId = await localResource1.createFolder(new Folder({ title: 'bar', parentId: fooFolderId }))
            await localResource1.createBookmark(new Bookmark({title: 'url', url: 'http://ur.l/', parentId: barFolderId}))

            const localResource2 = await account2.getResource()
            const localRoot2 = (await localResource2.getBookmarksTree()).id

            const fooFolder2Id = await localResource2.createFolder(new Folder({ title: 'foo', parentId: localRoot2 }))

            const barFolder2Id = await localResource2.createFolder(new Folder({ title: 'bar', parentId: fooFolder2Id }))

            await account1.sync()
            expect(account1.getData().error).to.not.be.ok

            await account2.sync()
            expect(account2.getData().error).to.not.be.ok

            await localResource2.createBookmark(new Bookmark({
              title: 'foo',
              url: 'http://ur.l/',
              parentId: barFolder2Id
            }))

            await account2.sync()
            expect(account2.getData().error).to.not.be.ok

            await account1.sync()
            expect(account1.getData().error).to.not.be.ok

            await account2.sync()
            expect(account2.getData().error).to.not.be.ok

            const serverTree1 = await getAllBookmarks(account1)

            const tree1AfterSync = await account1.localTree.getBookmarksTree(
              true
            )
            const tree2AfterSync = await account2.localTree.getBookmarksTree(
              true
            )

            // Note that we compare two different trees from two different server roots
            // here, which just happen to look the same by virtue of this test

            serverTree1.title = tree1AfterSync.title
            expectTreeEqual(
              serverTree1,
              tree1AfterSync,
              false
            )
            expectTreeEqual(
              tree2AfterSync,
              tree1AfterSync,
              false
            )
          })
          it('should keep residual creates when merging concurrently created folders', async function() {
            const localResource1 = await account1.getResource()
            const localRoot1 = (await localResource1.getBookmarksTree()).id
            const localResource2 = await account2.getResource()
            const localRoot2 = (await localResource2.getBookmarksTree()).id

            await localResource1.createFolder(new Folder({
              title: 'unrelated',
              parentId: localRoot1
            }))

            await account1.sync()
            expect(account1.getData().error).to.not.be.ok
            await account2.sync()
            expect(account2.getData().error).to.not.be.ok


            const folder1Id = await localResource1.createFolder(new Folder({ title: 'shared', parentId: localRoot1 }))
            await localResource1.createBookmark(new Bookmark({title: 'from account 1', url: 'https://account1.example/', parentId: folder1Id}))


            const folder2Id = await localResource2.createFolder(new Folder({ title: 'shared', parentId: localRoot2 }))
            await localResource2.createBookmark(new Bookmark({
              title: 'from account 2',
              url: 'https://account2.example/',
              parentId: folder2Id
            }))

            await account1.sync()
            expect(account1.getData().error).to.not.be.ok
            await account2.sync()
            expect(account2.getData().error).to.not.be.ok
            await account1.sync()
            expect(account1.getData().error).to.not.be.ok

            const serverTree = await getAllBookmarks(account1)
            expectTreeEqual(
              serverTree,
              new Folder({
                title: serverTree.title,
                children: [
                  new Folder({
                    title: 'unrelated',
                    children: [],
                  }),
                  new Folder({
                    title: 'shared',
                    children: [
                      new Bookmark({ title: 'from account 1', url: 'https://account1.example/' }),
                      new Bookmark({ title: 'from account 2', url: 'https://account2.example/' }),
                    ]
                  })
                ]
              }),
              false,
              false
            )

            const tree1 = await account1.localTree.getBookmarksTree(true)
            const tree2 = await account2.localTree.getBookmarksTree(true)
            tree1.title = serverTree.title
            tree2.title = serverTree.title
            expectTreeEqual(tree1, serverTree, false, false)
            expectTreeEqual(tree2, serverTree, false, false)
          })
          it('should handle concurrent hierarchy reversals', async function() {
            const localResource1 = await account1.getResource()
            const localResource2 = await account2.getResource()
            const localRoot1 = (await localResource1.getBookmarksTree()).id
            let aFolder
            const aFolderId = await localResource1.createFolder(aFolder = new Folder({title: 'a', parentId: localRoot1}))

            const bFolderId = await localResource1.createFolder(new Folder({ title: 'b', parentId: aFolderId }))

            const cFolderId = await localResource1.createFolder(new Folder({ title: 'c', parentId: localRoot1 }))
            await localResource1.createBookmark(new Bookmark({title: 'url', url: 'http://ur.l/', parentId: cFolderId}))
            await localResource1.createBookmark(new Bookmark({title: 'urlalala', url: 'http://ur.la/', parentId: bFolderId}))
            const tree1 = await account1.localTree.getBookmarksTree(true)
            await account1.sync()
            expect(account1.getData().error).to.not.be.ok
            await account2.sync()
            expect(account1.getData().error).to.not.be.ok

            const serverTreeAfterFirstSync = await getAllBookmarks(account1)

            const tree1AfterFirstSync = await account1.localTree.getBookmarksTree(
              true
            )
            const tree2AfterFirstSync = await account2.localTree.getBookmarksTree(
              true
            )
            expectTreeEqual(
              tree1AfterFirstSync,
              tree1,
              false,
              false
            )
            serverTreeAfterFirstSync.title = tree1.title
            expectTreeEqual(
              serverTreeAfterFirstSync,
              tree1,
              false,
              false
            )
            tree2AfterFirstSync.title = tree1.title
            expectTreeEqual(
              tree2AfterFirstSync,
              tree1,
              false,
              false
            )
            console.log('First round ok')

            const tree2 = await account2.localTree.getBookmarksTree(true)

            await localResource1.updateFolder(new Folder({...aFolder.toJSON(), id: aFolderId, parentId: cFolderId}))
            console.log(
              'acc1: MOVE a ->c'
            )

            // ---

            await localResource2.updateFolder(
              new Folder({
                ...tree2.children.find((i) => i.title === 'c'),
                parentId: tree2.children
                  .find((i) => i.title === 'a')
                  .children.find((i) => i.title === 'b').id,
              })
            )
            console.log(
              'acc2: MOVE c ->b'
            )

            await account2.sync()
            expect(account2.getData().error).to.not.be.ok

            await account1.sync()
            expect(account1.getData().error).to.not.be.ok

            const serverTreeAfterThirdSync = await getAllBookmarks(account1)

            const tree1AfterThirdSync = await account1.localTree.getBookmarksTree(
              true
            )

            serverTreeAfterThirdSync.title = tree1AfterThirdSync.title
            expectTreeEqual(
              serverTreeAfterThirdSync,
              tree1AfterThirdSync,
              false,
              false
            )

            console.log('Second round second half ok')

            console.log('acc2: final sync')
            await account2.sync()
            expect(account2.getData().error).to.not.be.ok

            const serverTreeAfterFinalSync = await getAllBookmarks(account1)

            const tree2AfterFinalSync = await account2.localTree.getBookmarksTree(
              true
            )
            tree2AfterFinalSync.title = serverTreeAfterFinalSync.title
            expectTreeEqual(
              serverTreeAfterFinalSync,
              tree2AfterFinalSync,
              false,
              false
            )
            tree1AfterThirdSync.title = tree2AfterFinalSync.title
            expectTreeEqual(
              tree2AfterFinalSync,
              tree1AfterThirdSync,
              false,
              false
            )
          })
          it('should handle complex hierarchy reversals', async function() {
            const localResource1 = await account1.getResource()
            const localResource2 = await account2.getResource()
            const localRoot1 = (await localResource1.getBookmarksTree()).id
            let aFolder
            const aFolderId = await localResource1.createFolder(aFolder = new Folder({title: 'a', parentId: localRoot1}))

            const bFolderId = await localResource1.createFolder(new Folder({ title: 'b', parentId: aFolderId }))

            const cFolderId = await localResource1.createFolder(new Folder({ title: 'c', parentId: bFolderId }))
            let dFolder
            const dFolderId = await localResource1.createFolder(dFolder = new Folder({title: 'd', parentId: localRoot1}))

            const eFolderId = await localResource1.createFolder(new Folder({ title: 'e', parentId: dFolderId }))
            await localResource1.createFolder(new Folder({
              title: 'f',
              parentId: dFolderId
            }))

            const gFolderId = await localResource1.createFolder(new Folder({ title: 'g', parentId: localRoot1 }))
            await localResource1.createBookmark(new Bookmark({title: 'url', url: 'http://ur.l/', parentId: bFolderId}))
            await localResource1.createBookmark(new Bookmark({title: 'urlalala', url: 'http://ur.la/', parentId: dFolderId}))
            await localResource1.createBookmark(new Bookmark({title: 'urlalala', url: 'http://ur2.l/', parentId: eFolderId}))
            const tree1 = await account1.localTree.getBookmarksTree(true)
            await account1.sync()
            expect(account1.getData().error).to.not.be.ok
            await account2.sync()
            expect(account1.getData().error).to.not.be.ok

            const serverTreeAfterFirstSync = await getAllBookmarks(account1)

            const tree1AfterFirstSync = await account1.localTree.getBookmarksTree(
              true
            )
            const tree2AfterFirstSync = await account2.localTree.getBookmarksTree(
              true
            )
            expectTreeEqual(
              tree1AfterFirstSync,
              tree1,
              false,
              false
            )
            serverTreeAfterFirstSync.title = tree1.title
            expectTreeEqual(
              serverTreeAfterFirstSync,
              tree1,
              false,
              false
            )
            tree2AfterFirstSync.title = tree1.title
            expectTreeEqual(
              tree2AfterFirstSync,
              tree1,
              false,
              false
            )
            console.log('First round ok')

            const tree2 = await account2.localTree.getBookmarksTree(true)

            await localResource1.updateFolder(new Folder({...aFolder.toJSON(), id: aFolderId, parentId: gFolderId}))
            console.log(
              'acc1: MOVE a ->g'
            )
            await localResource1.updateFolder(new Folder({...dFolder.toJSON(), id: dFolderId, parentId: cFolderId}))
            console.log(
              'acc1: MOVE d ->c'
            )
            // ---

            await localResource2.updateFolder(
              new Folder({
                ...tree2.children
                  .find((i) => i.title === 'a')
                  .children.find((i) => i.title === 'b')
                  .children.find((i) => i.title === 'c'),
                parentId: tree2.children
                  .find((i) => i.title === 'd')
                  .children.find((i) => i.title === 'f').id,
              })
            )
            console.log(
              'acc2: MOVE c ->f'
            )

            await localResource2.updateFolder(
              new Folder({
                ...tree2.children.find(i => i.title === 'a').children.find(i => i.title === 'b'),
                parentId: tree2.children.find(i => i.title === 'd').children.find(i => i.title === 'e').id
              })
            )
            console.log(
              'acc2: MOVE b ->e'
            )

            await account2.sync()
            expect(account2.getData().error).to.not.be.ok

            await account1.sync()
            expect(account1.getData().error).to.not.be.ok

            const serverTreeAfterThirdSync = await getAllBookmarks(account1)

            const tree1AfterThirdSync = await account1.localTree.getBookmarksTree(
              true
            )

            serverTreeAfterThirdSync.title = tree1AfterThirdSync.title
            expectTreeEqual(
              serverTreeAfterThirdSync,
              tree1AfterThirdSync,
              false,
              false
            )

            console.log('Second round second half ok')

            console.log('acc2: final sync')
            await account2.sync()
            expect(account2.getData().error).to.not.be.ok

            const serverTreeAfterFinalSync = await getAllBookmarks(account1)

            const tree2AfterFinalSync = await account2.localTree.getBookmarksTree(
              true
            )
            tree2AfterFinalSync.title = serverTreeAfterFinalSync.title
            expectTreeEqual(
              serverTreeAfterFinalSync,
              tree2AfterFinalSync,
              false,
              false
            )
            tree1AfterThirdSync.title = tree2AfterFinalSync.title
            expectTreeEqual(
              tree2AfterFinalSync,
              tree1AfterThirdSync,
              false,
              false
            )
          })
          it('should handle complex hierarchy reversals 2', async function() {
            if (ACCOUNT_DATA.type === 'linkwarden' || ACCOUNT_DATA.type === 'karakeep') {
              return this.skip()
            }
            const localResource1 = await account1.getResource()
            const localRoot1 = (await localResource1.getBookmarksTree()).id
            const localResource2 = await account2.getResource()
            (await localResource2.getBookmarksTree()).id
            let aFolder
            const aFolderId = await localResource1.createFolder(aFolder = new Folder({title: 'a', parentId: localRoot1}))
            let gFolder
            const gFolderId = await localResource1.createFolder(gFolder = new Folder({title: 'g', parentId: aFolderId}))

            const bFolderId = await localResource1.createFolder(new Folder({ title: 'b', parentId: localRoot1 }))

            const cFolderId = await localResource1.createFolder(new Folder({ title: 'c', parentId: bFolderId }))

            const dFolderId = await localResource1.createFolder(new Folder({ title: 'd', parentId: cFolderId }))

            const eFolderId = await localResource1.createFolder(new Folder({ title: 'e', parentId: localRoot1 }))
            await localResource1.createFolder(new Folder({title: 'f', parentId: eFolderId}))
            await localResource1.createFolder(new Folder({title: 'h', parentId: bFolderId}))

            const tree1 = await account1.localTree.getBookmarksTree(true)
            await account1.sync()
            expect(account1.getData().error).to.not.be.ok
            await account2.sync()
            expect(account1.getData().error).to.not.be.ok

            const serverTreeAfterFirstSync = await getAllBookmarks(account1)

            const tree1AfterFirstSync = await account1.localTree.getBookmarksTree(
              true
            )
            const tree2AfterFirstSync = await account2.localTree.getBookmarksTree(
              true
            )
            expectTreeEqual(
              tree1AfterFirstSync,
              tree1,
              false,
              false
            )
            serverTreeAfterFirstSync.title = tree1.title
            expectTreeEqual(
              serverTreeAfterFirstSync,
              tree1,
              false,
              false
            )
            tree2AfterFirstSync.title = tree1.title
            expectTreeEqual(
              tree2AfterFirstSync,
              tree1,
              false,
              false
            )
            console.log('First round ok')

            const tree2 = await account2.localTree.getBookmarksTree(true)

            await localResource1.updateFolder(new Folder({...aFolder, id: aFolderId, parentId: dFolderId}))
            console.log(
              'acc1: MOVE a ->d'
            )
            await localResource1.removeFolder(new Folder({...gFolder, id: gFolderId}))
            console.log(
              'acc1: REMOVE g'
            )

            // ---

            await localResource2.updateFolder(
              new Folder({
                ...tree2.children.find(i => i.title === 'b').children.find(i => i.title === 'c'),
                parentId: tree2.children.find(i => i.title === 'b').children.find(i => i.title === 'h').id,
              })
            )
            console.log(
              'acc2: MOVE c ->h'
            )

            await localResource2.updateFolder(
              new Folder({
                ...tree2.children.find((i) => i.title === 'b'),
                parentId: tree2.children.find(i => i.title === 'e').children.find(i => i.title === 'f').id,
              })
            )
            console.log(
              'acc2: MOVE b ->f'
            )

            await localResource2.updateFolder(
              new Folder({
                ...tree2.children.find((i) => i.title === 'e'),
                parentId: tree2.children.find(i => i.title === 'a').children.find(i => i.title === 'g').id,
              })
            )
            console.log(
              'acc2: MOVE e ->g'
            )

            await account2.sync()
            expect(account2.getData().error).to.not.be.ok

            await account1.sync()
            expect(account1.getData().error).to.not.be.ok

            const serverTreeAfterThirdSync = await getAllBookmarks(account1)

            const tree1AfterThirdSync = await account1.localTree.getBookmarksTree(
              true
            )

            serverTreeAfterThirdSync.title = tree1AfterThirdSync.title
            expectTreeEqual(
              serverTreeAfterThirdSync,
              tree1AfterThirdSync,
              false,
              false
            )

            console.log('Second round second half ok')

            console.log('acc2: final sync')
            await account2.sync()
            expect(account2.getData().error).to.not.be.ok

            const serverTreeAfterFinalSync = await getAllBookmarks(account1)

            const tree2AfterFinalSync = await account2.localTree.getBookmarksTree(
              true
            )
            tree2AfterFinalSync.title = serverTreeAfterFinalSync.title
            expectTreeEqual(
              serverTreeAfterFinalSync,
              tree2AfterFinalSync,
              false,
              false
            )
            tree1AfterThirdSync.title = tree2AfterFinalSync.title
            expectTreeEqual(
              tree2AfterFinalSync,
              tree1AfterThirdSync,
              false,
              false
            )
          })
          it('should handle faux hierarchy reversals', async function() {
            const localResource1 = await account1.getResource()
            const localRoot1 = (await localResource1.getBookmarksTree()).id
            const localResource2 = await account2.getResource()
            (await localResource2.getBookmarksTree()).id
            let aFolder
            const aFolderId = await localResource1.createFolder(aFolder = new Folder({title: 'a', parentId: localRoot1}))

            const bFolderId = await localResource1.createFolder(new Folder({ title: 'b', parentId: localRoot1 }))

            const cFolderId = await localResource1.createFolder(new Folder({ title: 'c', parentId: bFolderId }))
            await localResource1.createFolder(new Folder({title: 'd', parentId: localRoot1}))
            let eFolder
            const eFolderId = await localResource1.createFolder(eFolder = new Folder({title: 'e', parentId: localRoot1}))
            await localResource1.createBookmark(new Bookmark({title: 'url', url: 'http://ur.l/', parentId: cFolderId}))
            await localResource1.createBookmark(new Bookmark({title: 'urlalala', url: 'http://ur.la/', parentId: bFolderId}))
            const tree1 = await account1.localTree.getBookmarksTree(true)
            await account1.sync()
            expect(account1.getData().error).to.not.be.ok
            await account2.sync()
            expect(account1.getData().error).to.not.be.ok

            const serverTreeAfterFirstSync = await getAllBookmarks(account1)

            const tree1AfterFirstSync = await account1.localTree.getBookmarksTree(
              true
            )
            const tree2AfterFirstSync = await account2.localTree.getBookmarksTree(
              true
            )
            expectTreeEqual(
              tree1AfterFirstSync,
              tree1,
              false,
              false
            )
            serverTreeAfterFirstSync.title = tree1.title
            expectTreeEqual(
              serverTreeAfterFirstSync,
              tree1,
              false,
              false
            )
            tree2AfterFirstSync.title = tree1.title
            expectTreeEqual(
              tree2AfterFirstSync,
              tree1,
              false,
              false
            )
            console.log('First round ok')

            const tree2 = await account2.localTree.getBookmarksTree(true)

            await localResource1.updateFolder(
              new Folder({
                ...aFolder, id: aFolderId, parentId: cFolderId
              })
            )
            console.log(
              'acc1: MOVE a ->c'
            )

            await localResource1.removeFolder(new Folder({...eFolder, id: eFolderId }))
            console.log(
              'acc1: REMOVE e'
            )

            // ---


            const newFolderId = await localResource2.createFolder(new Folder({
              title: 'new',
              parentId: tree2.children.find(i => i.title === 'e').id
            }))

            await localResource2.createBookmark(
              new Bookmark({
                title: 'urlabyrinth',
                url: 'http://ur2.l/',
                parentId: newFolderId,
              })
            )
            console.log('acc2: CREATE new ->e')

            await localResource2.updateFolder(new Folder({
              ...tree2.children.find(i => i.title === 'b').children.find(i => i.title === 'c'),
              parentId: newFolderId,
            }))
            console.log(
              'acc2: MOVE c ->new'
            )

            await localResource2.updateFolder(
              new Folder({
                ...tree2.children.find((i) => i.title === 'b'),
                parentId: tree2.children.find((i) => i.title === 'a').id,
              })
            )
            console.log(
              'acc2: MOVE b ->a'
            )

            await localResource2.updateFolder(
              new Folder({
                ...tree2.children.find((i) => i.title === 'e'),
                parentId: tree2.children.find((i) => i.title === 'd').id,
              })
            )
            console.log(
              'acc2: MOVE e ->d'
            )

            await account2.sync()
            expect(account2.getData().error).to.not.be.ok

            await account1.sync()
            expect(account1.getData().error).to.not.be.ok

            const serverTreeAfterThirdSync = await getAllBookmarks(account1)

            const tree1AfterThirdSync = await account1.localTree.getBookmarksTree(
              true
            )

            serverTreeAfterThirdSync.title = tree1AfterThirdSync.title
            expectTreeEqual(
              serverTreeAfterThirdSync,
              tree1AfterThirdSync,
              false,
              false
            )

            console.log('Second round second half ok')

            console.log('acc2: final sync')
            await account2.sync()
            expect(account2.getData().error).to.not.be.ok

            const serverTreeAfterFinalSync = await getAllBookmarks(account1)

            const tree2AfterFinalSync = await account2.localTree.getBookmarksTree(
              true
            )
            tree2AfterFinalSync.title = serverTreeAfterFinalSync.title
            expectTreeEqual(
              serverTreeAfterFinalSync,
              tree2AfterFinalSync,
              false,
              false
            )
            tree1AfterThirdSync.title = tree2AfterFinalSync.title
            expectTreeEqual(
              tree2AfterFinalSync,
              tree1AfterThirdSync,
              false,
              false
            )
          })
          it('should handle complex move-remove interactions', async function() {
            if (ACCOUNT_DATA.type === 'nextcloud-bookmarks') {
              // Not sure why, but this fails sometimes. Likely because of the bookmark ID trick
              this.skip()
              return
            }
            const localResource1 = await account1.getResource()
            const localResource2 = await account2.getResource()
            const localRoot1 = (await localResource1.getBookmarksTree()).id
            let zFolder
            const zFolderId = await localResource1.createFolder(zFolder = new Folder({title: 'z', parentId: localRoot1}))
            let aFolder
            const aFolderId = await localResource1.createFolder(aFolder = new Folder({title: 'a', parentId: zFolderId}))

            const bFolderId = await localResource1.createFolder(new Folder({ title: 'b', parentId: localRoot1 }))

            const cFolderId = await localResource1.createFolder(new Folder({ title: 'c', parentId: localRoot1 }))
            await localResource1.createBookmark(new Bookmark({title: 'url', url: 'http://ur.l/', parentId: aFolderId}))
            let bookmark2
            const bookmark2Id = await localResource1.createBookmark(bookmark2 = new Bookmark({title: 'urlalala', url: 'http://ur.la/', parentId: bFolderId}))

            const tree1 = await account1.localTree.getBookmarksTree(true)
            await account1.sync()
            expect(account1.getData().error).to.not.be.ok
            await account2.sync()
            expect(account1.getData().error).to.not.be.ok

            const serverTreeAfterFirstSync = await getAllBookmarks(account1)

            const tree1AfterFirstSync = await account1.localTree.getBookmarksTree(
              true
            )
            const tree2AfterFirstSync = await account2.localTree.getBookmarksTree(
              true
            )
            expectTreeEqual(
              tree1AfterFirstSync,
              tree1,
              false,
              false
            )
            serverTreeAfterFirstSync.title = tree1.title
            expectTreeEqual(
              serverTreeAfterFirstSync,
              tree1,
              false,
              false
            )
            tree2AfterFirstSync.title = tree1.title
            expectTreeEqual(
              tree2AfterFirstSync,
              tree1,
              false,
              false
            )
            console.log('First round ok')


            const newFolderId = await localResource1.createFolder(new Folder({ title: 'new', parentId: aFolderId }))
            await localResource1.updateBookmark(new Bookmark({...bookmark2, id: bookmark2Id, parentId: newFolderId}))
            await localResource1.updateFolder(new Folder({...aFolder, id: aFolderId, parentId: bFolderId}))
            await localResource1.updateFolder(new Folder({...zFolder, id: zFolderId, parentId: cFolderId}))

            // ---

            const tree2 = await account2.localTree.getBookmarksTree(true)

            await localResource2.removeFolder(new Folder({
              ...tree2.children.find(i => i.title === 'z')
            }))

            await account2.sync()
            expect(account2.getData().error).to.not.be.ok

            await account1.sync()
            expect(account1.getData().error).to.not.be.ok

            const serverTreeAfterThirdSync = await getAllBookmarks(account1)

            const tree1AfterThirdSync = await account1.localTree.getBookmarksTree(
              true
            )

            serverTreeAfterThirdSync.title = tree1AfterThirdSync.title
            expectTreeEqual(
              serverTreeAfterThirdSync,
              tree1AfterThirdSync,
              false,
              false
            )

            console.log('Second round second half ok')

            console.log('acc2: final sync')
            await account2.sync()
            expect(account2.getData().error).to.not.be.ok

            const serverTreeAfterFinalSync = await getAllBookmarks(account1)

            const tree2AfterFinalSync = await account2.localTree.getBookmarksTree(
              true
            )
            tree2AfterFinalSync.title = serverTreeAfterFinalSync.title
            expectTreeEqual(
              serverTreeAfterFinalSync,
              tree2AfterFinalSync,
              false,
              false
            )
            tree1AfterThirdSync.title = tree2AfterFinalSync.title
            expectTreeEqual(
              tree2AfterFinalSync,
              tree1AfterThirdSync,
              false,
              false
            )
          })
          it('should synchronize ordering', async function() {
            if (ACCOUNT_DATA.type === 'linkwarden' || ACCOUNT_DATA.type === 'karakeep') {
              return this.skip()
            }
            expect(
              (await getAllBookmarks(account1)).children
            ).to.have.lengthOf(0)

            const localResource1 = await account1.getResource()
            const localRoot1 = (await localResource1.getBookmarksTree()).id

            const fooFolderId = await localResource1.createFolder(new Folder({ title: 'foo', parentId: localRoot1 }))

            const folder1Id = await localResource1.createFolder(new Folder({ title: 'folder1', parentId: fooFolderId }))

            const folder2Id = await localResource1.createFolder(new Folder({ title: 'folder2', parentId: fooFolderId }))
            let bookmark1
            const bookmark1Id = await localResource1.createBookmark(bookmark1 = new Bookmark({title: 'url1', url: 'http://ur.l/', parentId: fooFolderId}))
            let bookmark2
            const bookmark2Id = await localResource1.createBookmark(bookmark2 = new Bookmark({title: 'url2', url: 'http://ur.ll/', parentId: fooFolderId}))
            await account1.sync()
            expect(account1.getData().error).to.not.be.ok

            await account2.sync()
            expect(account2.getData().error).to.not.be.ok

            const localTree1 = await account1.localTree.getBookmarksTree(true)
            const localTree2 = await account2.localTree.getBookmarksTree(true)
            localTree2.title = localTree1.title
            expectTreeEqual(localTree1, localTree2, true, true)

            await localResource1.orderFolder(fooFolderId, [
              {type: 'bookmark', id: bookmark1Id},
              {type: 'folder', id: folder1Id},
              {type: 'bookmark', id: bookmark2Id},
              {type: 'folder', id: folder2Id},
            ])

            await account1.sync()
            expect(account1.getData().error).to.not.be.ok

            await account2.sync()
            expect(account2.getData().error).to.not.be.ok

            await account1.sync()
            expect(account1.getData().error).to.not.be.ok

            const secondLocalTree1 = await account1.localTree.getBookmarksTree(
              true
            )
            expectTreeEqual(
              secondLocalTree1,
              new Folder({
                title: secondLocalTree1.title,
                children: [
                  new Folder({
                    title: 'foo',
                    children: [
                      new Bookmark({
                        title: 'url1',
                        url: bookmark1.url
                      }),
                      new Folder({
                        title: 'folder1',
                        children: []
                      }),
                      new Bookmark({
                        title: 'url2',
                        url: bookmark2.url
                      }),
                      new Folder({
                        title: 'folder2',
                        children: []
                      })
                    ]
                  })
                ]
              }),
              true,
              true
            )

            const secondLocalTree2 = await account2.localTree.getBookmarksTree(
              true
            )
            secondLocalTree2.title = secondLocalTree1.title
            expectTreeEqual(secondLocalTree1, secondLocalTree2, true, true)
          })

          it('should synchronize ordering (2)', async function() {
            if (ACCOUNT_DATA.type === 'linkwarden' || ACCOUNT_DATA.type === 'karakeep') {
              return this.skip()
            }
            expect(
              (await getAllBookmarks(account1)).children
            ).to.have.lengthOf(0)

            const localResource1 = await account1.getResource()
            const localResource2 = await account2.getResource()

            const localRoot1 = (await localResource1.getBookmarksTree()).id

            const fooFolderId = await localResource1.createFolder(new Folder({ title: 'foo', parentId: localRoot1 }))

            const folder11Id = await localResource1.createFolder(new Folder({
              title: 'folder11',
              parentId: fooFolderId
            }))

            const folder12Id = await localResource1.createFolder(new Folder({
              title: 'folder12',
              parentId: fooFolderId
            }))
            let bookmark11
            const bookmark11Id = await localResource1.createBookmark(bookmark11 = new Bookmark({title: 'url11', url: 'http://ur.l/', parentId: fooFolderId}))
            let bookmark12
            const bookmark12Id = await localResource1.createBookmark(bookmark12 = new Bookmark({title: 'url12', url: 'http://ur.ll/', parentId: fooFolderId}))

            await account1.sync()
            expect(account1.getData().error).to.not.be.ok

            await account2.sync()
            expect(account2.getData().error).to.not.be.ok

            console.log('Checking local folder after initial sync')

            const localTree1 = await account1.localTree.getBookmarksTree(true)
            const localTree2 = await account2.localTree.getBookmarksTree(true)
            localTree2.title = localTree1.title
            expectTreeEqual(localTree1, localTree2, true, true)

            const localTree1Foo = localTree1.findItemFilter(
              ItemType.FOLDER,
              (item) => item.title === 'foo'
            )
            const localTree2Foo = localTree2.findItemFilter(ItemType.FOLDER, item => item.title === 'foo')

            let newBookmark1
            const newBookmark1Id = await localResource1.createBookmark(
              newBookmark1 = new Bookmark({
                title: 'newBookmark1',
                url: 'http://ur.lllll/',
                parentId: localTree1Foo.id,
              })
            )

            await localResource1.orderFolder(localTree1Foo.id, [
              { type: 'bookmark', id: newBookmark1Id },
              { type: 'bookmark', id: bookmark12Id },
              { type: 'bookmark', id: bookmark11Id },
              { type: 'folder', id: folder12Id },
              { type: 'folder', id: folder11Id },
            ])

            let newBookmark2
            const newBookmark2Id = await localResource2.createBookmark(
              (newBookmark2 = new Bookmark({
                title: 'newBookmark2',
                url: 'http://ur.llllll/',
                parentId: localTree2Foo.id,
              }))
            )

            await localResource2.orderFolder(localTree2Foo.id, [
              {
                type: 'folder',
                id: localTree2Foo.children.find(
                  (item) => item.title === 'folder11'
                ).id,
              },
              {
                type: 'folder',
                id: localTree2Foo.children.find(
                  (item) => item.title === 'folder12'
                ).id,
              },
              {
                type: 'bookmark',
                id: localTree2Foo.children.find(
                  (item) => item.title === 'url11'
                ).id,
              },
              { type: 'bookmark', id: newBookmark2Id },
              {
                type: 'bookmark',
                id: localTree2Foo.children.find(
                  (item) => item.title === 'url12'
                ).id,
              },
            ])

            await account1.sync()
            expect(account1.getData().error).to.not.be.ok

            await account2.sync()
            expect(account2.getData().error).to.not.be.ok

            await account1.sync()
            expect(account1.getData().error).to.not.be.ok

            const secondLocalTree1 = await account1.localTree.getBookmarksTree(
              true
            )

            expectTreeEqual(
              secondLocalTree1,
              new Folder({
                title: secondLocalTree1.title,
                children: [
                  new Folder({
                    title: 'foo',
                    children: [
                      new Bookmark({
                        title: 'newBookmark1',
                        url: newBookmark1.url
                      }),
                      new Bookmark({
                        title: 'url12',
                        url: bookmark12.url
                      }),
                      new Bookmark({
                        title: 'url11',
                        url: bookmark11.url
                      }),
                      new Folder({
                        title: 'folder12',
                        children: []
                      }),
                      new Bookmark({
                        title: 'newBookmark2',
                        url: newBookmark2.url
                      }),
                      new Folder({
                        title: 'folder11',
                        children: []
                      }),
                    ]
                  }),
                ]
              }),
              true,
              true
            )

            const secondLocalTree2 = await account2.localTree.getBookmarksTree(
              true
            )
            secondLocalTree2.title = secondLocalTree1.title
            expectTreeEqual(secondLocalTree1, secondLocalTree2, true, true)
          })

          // Skipping this, because nextcloud adapter currently
          // isn't able to track bookmarks across dirs, thus in this
          // scenario both bookmarks survive :/
          it('should propagate moves using "last write wins"', async function() {
            if (ACCOUNT_DATA.type === 'nextcloud-bookmarks' || ACCOUNT_DATA.type === 'karakeep') {
              return this.skip()
            }
            const localResource1 = await account1.getResource()
            const localRoot1 = (await localResource1.getBookmarksTree()).id
            const localResource2 = await account2.getResource()
            const localRoot2 = (await localResource2.getBookmarksTree()).id


            const fooFolderId = await localResource1.createFolder(new Folder({ title: 'foo', parentId: localRoot1 }))

            const barFolderId = await localResource1.createFolder(new Folder({ title: 'bar', parentId: fooFolderId }))
            let bookmark1
            const bookmark1Id = await localResource1.createBookmark(bookmark1 = new Bookmark({title: 'url', url: 'http://ur.l/', parentId: barFolderId}))

            const tree1 = await account1.localTree.getBookmarksTree(true)
            await account1.sync()
            await account2.sync()

            const serverTreeAfterFirstSync = await getAllBookmarks(account1)
            const tree1AfterFirstSync = await account1.localTree.getBookmarksTree(
              true
            )
            const tree2AfterFirstSync = await account2.localTree.getBookmarksTree(
              true
            )
            expectTreeEqual(
              tree1AfterFirstSync,
              tree1,
              false
            )
            serverTreeAfterFirstSync.title = tree1.title
            expectTreeEqual(
              serverTreeAfterFirstSync,
              tree1,
              false
            )
            tree2AfterFirstSync.title = tree1.title
            expectTreeEqual(
              tree2AfterFirstSync,
              tree1,
              false
            )
            console.log('First round ok')

            await localResource1.updateBookmark(new Bookmark({
              ...bookmark1,
              id: bookmark1Id,
              parentId: fooFolderId,
            }))
            console.log('acc1: Moved bookmark from bar into foo')

            const tree1BeforeSecondSync = await account1.localTree.getBookmarksTree(
              true
            )
            await account1.sync()

            const serverTreeAfterSecondSync = await getAllBookmarks(account1)
            const tree1AfterSecondSync = await account1.localTree.getBookmarksTree(
              true
            )
            expectTreeEqual(
              tree1AfterSecondSync,
              tree1BeforeSecondSync,
              false
            )
            serverTreeAfterSecondSync.title = tree1AfterSecondSync.title
            expectTreeEqual(
              serverTreeAfterSecondSync,
              tree1AfterSecondSync,
              false
            )
            console.log('Second round first half ok')

            const bm2 = (await account2.localTree.getBookmarksTree(true))
              .children[0].children[0].children[0]

            await localResource2.updateBookmark(
              new Bookmark({
                ...bm2,
                parentId: localRoot2
              })
            )

            console.log('acc2: Moved bookmark from bar into root')
            const tree2BeforeThirdSync = await account2.localTree.getBookmarksTree(
              true
            )
            await account2.sync()

            const serverTreeAfterThirdSync = await getAllBookmarks(account1)
            const tree2AfterThirdSync = await account2.localTree.getBookmarksTree(
              true
            )
            console.log('Checking local tree of acc2')
            expectTreeEqual(
              tree2AfterThirdSync,
              tree2BeforeThirdSync,
              false
            )
            console.log('All good')
            console.log('Checking server tree')
            serverTreeAfterThirdSync.title = tree2BeforeThirdSync.title
            expectTreeEqual(
              serverTreeAfterThirdSync,
              tree2BeforeThirdSync,
              false
            )
            console.log('Second round second half ok')

            console.log('acc1: final sync')
            await account1.sync()

            const serverTreeAfterFinalSync = await getAllBookmarks(account1)
            const tree1AfterFinalSync = await account1.localTree.getBookmarksTree(
              true
            )
            expectTreeEqual(
              tree1AfterFinalSync,
              tree2AfterThirdSync,
              false
            )
            tree2AfterThirdSync.title = serverTreeAfterFinalSync.title
            expectTreeEqual(
              tree2AfterThirdSync,
              serverTreeAfterFinalSync,
              false
            )
          })
        })
      })
  })
})