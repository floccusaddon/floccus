import Account from '../lib/Account'
import { Bookmark, Folder } from '../lib/Tree'
import browser from '../lib/browser-api'
import * as AsyncParallel from 'async-parallel'
import Controller from '../lib/Controller'
import {
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
            try {
              await browser.bookmarks.removeTree(account1.getData().localRoot)
            } catch (e) {
              // noop
            }
            await account1.delete()
            try {
              await browser.bookmarks.removeTree(account2.getData().localRoot)
            } catch (e) {
              // noop
            }
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
            const localRoot = account1.getData().localRoot
            const fooFolder = await browser.bookmarks.create({
              title: 'foo',
              parentId: localRoot
            })
            const barFolder = await browser.bookmarks.create({
              title: 'bar',
              parentId: fooFolder.id
            })
            await browser.bookmarks.create({
              title: 'url',
              url: 'http://ur.l/',
              parentId: barFolder.id
            })

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
            const localRoot = account1.getData().localRoot
            const fooFolder = await browser.bookmarks.create({
              title: 'foo',
              parentId: localRoot
            })
            const barFolder = await browser.bookmarks.create({
              title: 'bar',
              parentId: fooFolder.id
            })
            const bookmark1 = await browser.bookmarks.create({
              title: 'url',
              url: 'http://ur.l/',
              parentId: barFolder.id
            })
            await account1.sync()
            await account2.sync()

            const serverTree = await getAllBookmarks(account1)

            const tree1 = await account1.localTree.getBookmarksTree(true)
            const tree2 = await account2.localTree.getBookmarksTree(true)
            tree1.title = tree2.title
            expectTreeEqual(tree1, tree2)
            tree2.title = serverTree.title
            expectTreeEqual(tree2, serverTree)

            await browser.bookmarks.update(bookmark1.id, {
              title: 'NEW TITLE FROM ACC1'
            })
            await account1.sync()

            const bm2Id = (await account2.localTree.getBookmarksTree(true))
              .children[0].children[0].children[0].id
            const newBookmark2 = await browser.bookmarks.update(bm2Id, {
              title: 'NEW TITLE FROM ACC2'
            })
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
            const localRoot = account1.getData().localRoot
            const fooFolder = await browser.bookmarks.create({
              title: 'foo',
              parentId: localRoot
            })
            const barFolder = await browser.bookmarks.create({
              title: 'bar',
              parentId: fooFolder.id
            })
            const bookmark1 = await browser.bookmarks.create({
              title: 'url',
              url: 'http://ur.l/',
              parentId: barFolder.id
            })
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

            await browser.bookmarks.move(bookmark1.id, {
              parentId: fooFolder.id
            })
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
            const localRoot = account1.getData().localRoot
            const fooFolder = await browser.bookmarks.create({
              title: 'foo',
              parentId: localRoot
            })
            const barFolder = await browser.bookmarks.create({
              title: 'bar',
              parentId: fooFolder.id
            })
            await browser.bookmarks.create({
              title: 'url',
              url: 'http://ur.l/',
              parentId: barFolder.id
            })
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
            await browser.bookmarks.removeTree(tree2.children[0].children[0].id)
            await browser.bookmarks.create({
              title: 'url2',
              url: 'http://ur2.l/',
              parentId: barFolder.id
            })
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

            const localRoot = account1.getData().localRoot
            const fooFolder = await browser.bookmarks.create({
              title: 'foo',
              parentId: localRoot
            })
            const barFolder = await browser.bookmarks.create({
              title: 'bar',
              parentId: fooFolder.id
            })
            await browser.bookmarks.create({
              title: 'url',
              url: 'http://ur.l/',
              parentId: barFolder.id
            })

            const localRoot2 = account2.getData().localRoot
            const fooFolder2 = await browser.bookmarks.create({
              title: 'foo',
              parentId: localRoot2
            })
            const barFolder2 = await browser.bookmarks.create({
              title: 'bar',
              parentId: fooFolder2.id
            })

            await account1.sync()
            expect(account1.getData().error).to.not.be.ok

            await account2.sync()
            expect(account2.getData().error).to.not.be.ok

            await browser.bookmarks.create({
              title: 'foo',
              url: 'http://ur.l/',
              parentId: barFolder2.id
            })

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
            const localRoot1 = account1.getData().localRoot
            const localRoot2 = account2.getData().localRoot

            await browser.bookmarks.create({
              title: 'unrelated',
              parentId: localRoot1
            })

            await account1.sync()
            expect(account1.getData().error).to.not.be.ok
            await account2.sync()
            expect(account2.getData().error).to.not.be.ok

            const folder1 = await browser.bookmarks.create({
              title: 'shared',
              parentId: localRoot1
            })
            await browser.bookmarks.create({
              title: 'from account 1',
              url: 'https://account1.example/',
              parentId: folder1.id
            })

            const folder2 = await browser.bookmarks.create({
              title: 'shared',
              parentId: localRoot2
            })
            await browser.bookmarks.create({
              title: 'from account 2',
              url: 'https://account2.example/',
              parentId: folder2.id
            })

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
            const localRoot = account1.getData().localRoot
            const aFolder = await browser.bookmarks.create({
              title: 'a',
              parentId: localRoot
            })
            const bFolder = await browser.bookmarks.create({
              title: 'b',
              parentId: aFolder.id
            })
            const cFolder = await browser.bookmarks.create({
              title: 'c',
              parentId: localRoot
            })
            await browser.bookmarks.create({
              title: 'url',
              url: 'http://ur.l/',
              parentId: cFolder.id
            })
            await browser.bookmarks.create({
              title: 'urlalala',
              url: 'http://ur.la/',
              parentId: bFolder.id
            })
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

            await browser.bookmarks.move(aFolder.id, { parentId: cFolder.id })
            console.log(
              'acc1: MOVE a ->c'
            )

            // ---

            await browser.bookmarks.move(tree2.children.find(i => i.title === 'c').id, { parentId: tree2.children.find(i => i.title === 'a').children.find(i => i.title === 'b').id })
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
            const localRoot = account1.getData().localRoot
            const aFolder = await browser.bookmarks.create({
              title: 'a',
              parentId: localRoot
            })
            const bFolder = await browser.bookmarks.create({
              title: 'b',
              parentId: aFolder.id
            })
            const cFolder = await browser.bookmarks.create({
              title: 'c',
              parentId: bFolder.id
            })
            const dFolder = await browser.bookmarks.create({
              title: 'd',
              parentId: localRoot
            })
            const eFolder = await browser.bookmarks.create({
              title: 'e',
              parentId: dFolder.id
            })
            await browser.bookmarks.create({
              title: 'f',
              parentId: dFolder.id
            })
            const gFolder = await browser.bookmarks.create({
              title: 'g',
              parentId: localRoot
            })
            await browser.bookmarks.create({
              title: 'url',
              url: 'http://ur.l/',
              parentId: bFolder.id
            })
            await browser.bookmarks.create({
              title: 'urlalala',
              url: 'http://ur.la/',
              parentId: dFolder.id
            })
            await browser.bookmarks.create({
              title: 'urlalala',
              url: 'http://ur2.l/',
              parentId: eFolder.id
            })
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

            await browser.bookmarks.move(aFolder.id, { parentId: gFolder.id })
            console.log(
              'acc1: MOVE a ->g'
            )
            await browser.bookmarks.move(dFolder.id, { parentId: cFolder.id })
            console.log(
              'acc1: MOVE d ->c'
            )

            // ---

            await browser.bookmarks.move(tree2.children.find(i => i.title === 'a').children.find(i => i.title === 'b').children.find(i => i.title === 'c').id, { parentId: tree2.children.find(i => i.title === 'd').children.find(i => i.title === 'f').id })
            console.log(
              'acc2: MOVE c ->f'
            )

            await browser.bookmarks.move(tree2.children.find(i => i.title === 'a').children.find(i => i.title === 'b').id, { parentId: tree2.children.find(i => i.title === 'd').children.find(i => i.title === 'e').id })
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
            const localRoot = account1.getData().localRoot
            const aFolder = await browser.bookmarks.create({
              title: 'a',
              parentId: localRoot
            })
            const gFolder = await browser.bookmarks.create({
              title: 'g',
              parentId: aFolder.id
            })
            const bFolder = await browser.bookmarks.create({
              title: 'b',
              parentId: localRoot
            })
            const cFolder = await browser.bookmarks.create({
              title: 'c',
              parentId: bFolder.id
            })
            const dFolder = await browser.bookmarks.create({
              title: 'd',
              parentId: cFolder.id
            })
            const eFolder = await browser.bookmarks.create({
              title: 'e',
              parentId: localRoot
            })
            await browser.bookmarks.create({
              title: 'f',
              parentId: eFolder.id
            })
            await browser.bookmarks.create({
              title: 'h',
              parentId: bFolder.id
            })

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

            await browser.bookmarks.move(aFolder.id, { parentId: dFolder.id })
            console.log(
              'acc1: MOVE a ->d'
            )
            await browser.bookmarks.remove(gFolder.id)
            console.log(
              'acc1: REMOVE g'
            )

            // ---

            await browser.bookmarks.move(tree2.children.find(i => i.title === 'b').children.find(i => i.title === 'c').id, { parentId: tree2.children.find(i => i.title === 'b').children.find(i => i.title === 'h').id })
            console.log(
              'acc2: MOVE c ->h'
            )

            await browser.bookmarks.move(tree2.children.find(i => i.title === 'b').id, { parentId: tree2.children.find(i => i.title === 'e').children.find(i => i.title === 'f').id })
            console.log(
              'acc2: MOVE b ->f'
            )

            await browser.bookmarks.move(tree2.children.find(i => i.title === 'e').id, { parentId: tree2.children.find(i => i.title === 'a').children.find(i => i.title === 'g').id })
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
            const localRoot = account1.getData().localRoot
            const aFolder = await browser.bookmarks.create({
              title: 'a',
              parentId: localRoot
            })
            const bFolder = await browser.bookmarks.create({
              title: 'b',
              parentId: localRoot
            })
            const cFolder = await browser.bookmarks.create({
              title: 'c',
              parentId: bFolder.id
            })
            await browser.bookmarks.create({
              title: 'd',
              parentId: localRoot
            })
            const eFolder = await browser.bookmarks.create({
              title: 'e',
              parentId: localRoot
            })
            await browser.bookmarks.create({
              title: 'url',
              url: 'http://ur.l/',
              parentId: cFolder.id
            })
            await browser.bookmarks.create({
              title: 'urlalala',
              url: 'http://ur.la/',
              parentId: bFolder.id
            })
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

            await browser.bookmarks.move(aFolder.id, { parentId: cFolder.id })
            console.log(
              'acc1: MOVE a ->c'
            )

            await browser.bookmarks.remove(eFolder.id)
            console.log(
              'acc1: REMOVE e'
            )

            // ---

            const newFolder = await browser.bookmarks.create({
              title: 'new',
              parentId: tree2.children.find(i => i.title === 'e').id
            })
            await browser.bookmarks.create({
              title: 'urlabyrinth',
              url: 'http://ur2.l/',
              parentId: newFolder.id
            })
            console.log('acc2: CREATE new ->e')

            await browser.bookmarks.move(tree2.children.find(i => i.title === 'b').children.find(i => i.title === 'c').id, { parentId: newFolder.id })
            console.log(
              'acc2: MOVE c ->new'
            )

            await browser.bookmarks.move(tree2.children.find(i => i.title === 'b').id, { parentId: tree2.children.find(i => i.title === 'a').id })
            console.log(
              'acc2: MOVE b ->a'
            )

            await browser.bookmarks.move(tree2.children.find(i => i.title === 'e').id, { parentId: tree2.children.find(i => i.title === 'd').id })
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
            const localRoot = account1.getData().localRoot
            const zFolder = await browser.bookmarks.create({
              title: 'z',
              parentId: localRoot
            })
            const aFolder = await browser.bookmarks.create({
              title: 'a',
              parentId: zFolder.id
            })
            const bFolder = await browser.bookmarks.create({
              title: 'b',
              parentId: localRoot
            })
            const cFolder = await browser.bookmarks.create({
              title: 'c',
              parentId: localRoot
            })
            await browser.bookmarks.create({
              title: 'url',
              url: 'http://ur.l/',
              parentId: aFolder.id
            })
            const bookmark2 = await browser.bookmarks.create({
              title: 'urlalala',
              url: 'http://ur.la/',
              parentId: bFolder.id
            })
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

            const newFolder = await browser.bookmarks.create({
              title: 'new',
              parentId: aFolder.id
            })
            await browser.bookmarks.move(bookmark2.id, { parentId: newFolder.id })
            await browser.bookmarks.move(aFolder.id, { parentId: bFolder.id })
            await browser.bookmarks.move(zFolder.id, { parentId: cFolder.id })

            // ---

            const tree2 = await account2.localTree.getBookmarksTree(true)

            await browser.bookmarks.removeTree(tree2.children.find(i => i.title === 'z').id)

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

            const localRoot = account1.getData().localRoot
            const fooFolder = await browser.bookmarks.create({
              title: 'foo',
              parentId: localRoot
            })
            const folder1 = await browser.bookmarks.create({
              title: 'folder1',
              parentId: fooFolder.id
            })
            const folder2 = await browser.bookmarks.create({
              title: 'folder2',
              parentId: fooFolder.id
            })
            const bookmark1 = await browser.bookmarks.create({
              title: 'url1',
              url: 'http://ur.l/',
              parentId: fooFolder.id
            })
            const bookmark2 = await browser.bookmarks.create({
              title: 'url2',
              url: 'http://ur.ll/',
              parentId: fooFolder.id
            })
            await account1.sync()
            expect(account1.getData().error).to.not.be.ok

            await account2.sync()
            expect(account2.getData().error).to.not.be.ok

            const localTree1 = await account1.localTree.getBookmarksTree(true)
            const localTree2 = await account2.localTree.getBookmarksTree(true)
            localTree2.title = localTree1.title
            expectTreeEqual(localTree1, localTree2, true, true)

            await browser.bookmarks.move(bookmark1.id, { index: 0 })
            await browser.bookmarks.move(folder1.id, { index: 1 })
            await browser.bookmarks.move(bookmark2.id, { index: 2 })
            await browser.bookmarks.move(folder2.id, { index: 3 })

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

            const localRoot1 = account1.getData().localRoot
            const fooFolder = await browser.bookmarks.create({
              title: 'foo',
              parentId: localRoot1
            })
            const folder11 = await browser.bookmarks.create({
              title: 'folder11',
              parentId: fooFolder.id
            })
            const folder12 = await browser.bookmarks.create({
              title: 'folder12',
              parentId: fooFolder.id
            })
            const bookmark11 = await browser.bookmarks.create({
              title: 'url11',
              url: 'http://ur.l/',
              parentId: fooFolder.id
            })
            const bookmark12 = await browser.bookmarks.create({
              title: 'url12',
              url: 'http://ur.ll/',
              parentId: fooFolder.id
            })

            await account1.sync()
            expect(account1.getData().error).to.not.be.ok

            await account2.sync()
            expect(account2.getData().error).to.not.be.ok

            console.log('Checking local folder after initial sync')

            const localTree1 = await account1.localTree.getBookmarksTree(true)
            const localTree2 = await account2.localTree.getBookmarksTree(true)
            localTree2.title = localTree1.title
            expectTreeEqual(localTree1, localTree2, true, true)

            const localTree1Foo = localTree1.children.find(item => item.title === 'foo')
            const localTree2Foo = localTree2.children.find(item => item.title === 'foo')

            const newBookmark1 = await browser.bookmarks.create({
              title: 'newBookmark1',
              url: 'http://ur.lllll/',
              parentId: localTree1Foo.id
            })
            await browser.bookmarks.move(newBookmark1.id, { index: 0 })
            await browser.bookmarks.move(folder11.id, { index: 4 })
            await browser.bookmarks.move(folder12.id, { index: 3 })
            await browser.bookmarks.move(bookmark11.id, { index: 2 })
            await browser.bookmarks.move(bookmark12.id, { index: 1 })

            const newBookmark2 = await browser.bookmarks.create({
              title: 'newBookmark2',
              url: 'http://ur.llllll/',
              parentId: localTree2Foo.id
            })
            await browser.bookmarks.move(newBookmark2.id, { index: 3 })

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
            const localRoot = account1.getData().localRoot
            const fooFolder = await browser.bookmarks.create({
              title: 'foo',
              parentId: localRoot
            })
            const barFolder = await browser.bookmarks.create({
              title: 'bar',
              parentId: fooFolder.id
            })
            const bookmark1 = await browser.bookmarks.create({
              title: 'url',
              url: 'http://ur.l/',
              parentId: barFolder.id
            })
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

            await browser.bookmarks.move(bookmark1.id, {
              parentId: fooFolder.id
            })
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

            const bm2Id = (await account2.localTree.getBookmarksTree(true))
              .children[0].children[0].children[0].id
            await browser.bookmarks.move(bm2Id, {
              parentId: account2.getData().localRoot
            })
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