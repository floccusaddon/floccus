import Account from '../lib/Account'
import { Bookmark, Folder } from '../lib/Tree'
import * as AsyncParallel from 'async-parallel'
import Controller from '../lib/Controller'
import {
  clearLocalResource,
  DUMP_LOGS,
  expect, expectTreeEqual, getAllBookmarks, getEnv, randomlyManipulateTree,
  randomlyManipulateTreeWithDeletions, seedTestRandom, stringifyAccountData,
  syncAccountWithInterrupts, testRandom, withSyncConnection
} from './utils'

describe('Floccus', function() {
  const { SEED, ACCOUNTS, RANDOM_MANIPULATION_ITERATIONS } = getEnv()
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
    describe(`${stringifyAccountData(ACCOUNT_DATA)} benchmark ${ACCOUNT_DATA.serverRoot ? 'subfolder' : 'root'}`, function() {
      let _expectTreeEqual = expectTreeEqual
      context('with two clients', function() {
        this.timeout(120 * 60000) // timeout after 2h
        const BENCHMARK_SIZE = 1000
        let account1, account2, RUN_INTERRUPTS = false
        // Deterministic, count-based interrupts: instead of cancelling the sync after a
        // random wall-clock timeout (whose landing point depends on machine speed and so
        // is not reproducible), we cancel after a seeded number of executed actions. The
        // counts are precomputed once from the PRNG and then cycled through, so the
        // interrupt schedule is independent of how many random draws the tree
        // manipulations consume in between.
        const MAX_INTERRUPT_ACTIONS = 1000
        let interruptCounts = []
        let i = 0
        const nextInterruptCount = () => {
          if (!interruptCounts.length) {
            interruptCounts = new Array(1000).fill(0).map((_, index) =>
              // Allow between 1 action and an increasing bound (growing over stretches of
              // 20, then resetting). Draws larger than the remaining plan simply let that
              // sync complete uninterrupted, mirroring the old "long timeout" behaviour.
              testRandom.int(1, Math.round(1 + (MAX_INTERRUPT_ACTIONS - 1) * ((index + 1) % 20) / 20))
            )
          }
          return interruptCounts[(i++) % 1000]
        }
        // Arm the next interrupt on each freshly created sync process, but only while
        // interrupts are enabled. Retries (after E026/E027) create new sync processes and
        // therefore consume the next count, giving repeated deterministic interrupts.
        const armInterrupt = (syncProcess) => {
          if (RUN_INTERRUPTS) {
            syncProcess.setInterruptAfterActions(nextInterruptCount())
          }
        }
        const stopInterrupts = () => {
          interruptCounts = []
          i = 0
        }
        let expectTreeEqual
        beforeEach('set up accounts', async function() {
          expectTreeEqual = (tree1, tree2, ignoreEmptyFolders, checkOrder) => _expectTreeEqual(tree1, tree2, ignoreEmptyFolders, !!checkOrder)

          // reset random seed
          seedTestRandom(SEED)
          stopInterrupts()

          account1 = await Account.create({...ACCOUNT_DATA, failsafe: false})
          await account1.init()
          account2 = await Account.create({...ACCOUNT_DATA, failsafe: false})
          await account2.init()

          account1.onSyncProcessCreated = armInterrupt
          account2.onSyncProcessCreated = armInterrupt

          if (ACCOUNT_DATA.type.startsWith('fake')) {
            // Wire both accounts to the same fake db
            // We do not set the cache properties to the same object, because we want to only write onSynComplete
            let fakeServerDb = new Folder(
              { id: '', title: 'root', location: 'Server' }
            )
            account1.server.bookmarksCache = new Folder(
              { id: '', title: 'root', location: 'Server' }
            )
            account2.server.bookmarksCache = new Folder(
              { id: '', title: 'root', location: 'Server' }
            )
            account1.server.onSyncStart = () => {
              account1.server.bookmarksCache = fakeServerDb.copy(false)
            }
            account1.server.onSyncComplete = () => {
              fakeServerDb = account1.server.bookmarksCache.copy(false)
            }
            account2.server.onSyncStart = () => {
              account2.server.bookmarksCache = fakeServerDb.copy(false)
            }
            account2.server.onSyncComplete = () => {
              fakeServerDb = account2.server.bookmarksCache.copy(false)
            }
            account2.server.__defineSetter__('highestId', (id) => {
              account1.server.highestId = id
            })
            account2.server.__defineGetter__('highestId', () => account1.server.highestId)
          }
          if (ACCOUNT_DATA.noCache) {
            account1.storage.setCache = () => {
              // noop
            }
            account1.storage.setMappings = () => {
              // noop
            }
            account2.storage.setCache = () => {
              // noop
            }
            account2.storage.setMappings = () => {
              // noop
            }
          }
        })
        afterEach('clean up accounts', async function() {
          RUN_INTERRUPTS = false
          stopInterrupts()
          DUMP_LOGS(this.currentTest)
          if (ACCOUNT_DATA.type === 'git') {
            await account1.server.clearServer()
          } else if (ACCOUNT_DATA.type !== 'fake') {
            await account1.setData({
              serverRoot: null,
            })
            account1.lockTimeout = 0
            const tree = await getAllBookmarks(account1)
            await withSyncConnection(account1, async() => {
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
          await account1.delete()
          await clearLocalResource(account2)
          await account2.delete()
        })

        it('should handle deep hierarchies with lots of bookmarks', async function() {
          const localResource1 = await account1.getResource()
          const localRoot1 = (await localResource1.getBookmarksTree()).id
          let bookmarks = 0
          let folders = 0
          let magicFolder, magicBookmark
          const createTree = async(parentId, i, j) => {
            const len = Math.abs(i - j)
            for (let k = i; k < j; k++) {
              let newBookmark
              const newBookmarkId = await localResource1.createBookmark(
                newBookmark = new Bookmark({
                  title: 'url' + k,
                  url: 'http://ur.l/' + parentId + '/' + k,
                  parentId,
                })
              )
              bookmarks++
              if (bookmarks === 33) {
                magicBookmark = new Bookmark({
                  ...newBookmark,
                  id: newBookmarkId,
                })
              }
            }

            if (len < 4) return

            const step = Math.floor(len / 4)
            for (let k = i; k < j; k += step) {
              let newFolder
              const newFolderId = await localResource1.createFolder(
                (newFolder = new Folder({
                  title: 'folder' + k,
                  parentId,
                }))
              )
              newFolder.id = newFolderId
              folders++
              if (folders === 33) {
                magicFolder = newFolder
              }
              await createTree(newFolder.id, k, k + step)
            }
          }

          await createTree(localRoot1, 0, BENCHMARK_SIZE)

          const tree1Initial = await account1.localTree.getBookmarksTree(true)
          await account1.sync()
          expect(account1.getData().error).to.not.be.ok
          await account2.sync()
          expect(account2.getData().error).to.not.be.ok

          let serverTreeAfterFirstSync = await getAllBookmarks(account1)

          let tree1AfterFirstSync = await account1.localTree.getBookmarksTree(
            true
          )
          let tree2AfterFirstSync = await account2.localTree.getBookmarksTree(
            true
          )
          if (!ACCOUNT_DATA.noCache) {
            expectTreeEqual(
              tree1AfterFirstSync,
              tree1Initial,
              false
            )
            serverTreeAfterFirstSync.title = tree1Initial.title
            expectTreeEqual(
              serverTreeAfterFirstSync,
              tree1Initial,
              false
            )
            tree2AfterFirstSync.title = tree1Initial.title
            expectTreeEqual(
              tree2AfterFirstSync,
              tree1Initial,
              false
            )
          }
          serverTreeAfterFirstSync = null
          tree1AfterFirstSync = null
          tree2AfterFirstSync = null
          console.log('First round ok')

          await localResource1.updateBookmark(new Bookmark({
            ...magicBookmark,
            parentId: magicFolder.id,
          }))
          console.log('acc1: Moved bookmark')

          let tree1BeforeSecondSync = await account1.localTree.getBookmarksTree(
            true
          )
          await account1.sync()
          expect(account1.getData().error).to.not.be.ok

          let serverTreeAfterSecondSync = await getAllBookmarks(account1)

          let tree1AfterSecondSync = await account1.localTree.getBookmarksTree(
            true
          )
          if (!ACCOUNT_DATA.noCache) {
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
          }
          tree1BeforeSecondSync = null
          serverTreeAfterSecondSync = null
          console.log('Second round first half ok')

          await account2.sync()
          expect(account2.getData().error).to.not.be.ok

          let serverTreeAfterThirdSync = await getAllBookmarks(account1)

          let tree2AfterThirdSync = await account2.localTree.getBookmarksTree(
            true
          )
          if (!ACCOUNT_DATA.noCache) {
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
          }
          serverTreeAfterThirdSync = null
          console.log('Second round second half ok')

          console.log('acc1: final sync')
          await account1.sync()
          expect(account1.getData().error).to.not.be.ok

          let serverTreeAfterFinalSync = await getAllBookmarks(account1)

          let tree1AfterFinalSync = await account1.localTree.getBookmarksTree(
            true
          )
          if (!ACCOUNT_DATA.noCache) {
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
          }
          serverTreeAfterFinalSync = null
          tree1AfterFinalSync = null
        })

        it('should handle fuzzed changes from one client', async function() {
          const localResource1 = await account1.getResource()
          const localRoot1 = (await localResource1.getBookmarksTree()).id
          let bookmarks = []
          let folders = []
          const createTree = async(parentId, i, j) => {
            const len = Math.abs(i - j)
            for (let k = i; k < j; k++) {
              let newBookmark
              const newBookmarkId = await localResource1.createBookmark(
                new Bookmark({
                  title: 'url' + i + ':' + k + ':' + j,
                  url: 'http://ur.l/' + parentId + '/' + i + '/' + k + '/' + j,
                  parentId,
                })
              )
              bookmarks.push(new Bookmark({
                ...newBookmark,
                id: newBookmarkId,
              }))
            }

            if (len < 4) return

            const step = Math.floor(len / 4)
            for (let k = i; k < j; k += step) {
              let newFolder
              const newFolderId = await localResource1.createFolder(
                newFolder = new Folder({
                  title: 'folder' + i + ':' + k + ':' + (k + step),
                  parentId,
                })
              )
              folders.push(new Folder({
                ...newFolder,
                id: newFolderId,
              }))
              await createTree(newFolderId, k, k + step)
            }
          }

          await createTree(localRoot1, 0, BENCHMARK_SIZE)

          let tree1Initial = await account1.localTree.getBookmarksTree(true)
          await account1.sync()
          expect(account1.getData().error).to.not.be.ok
          console.log('Initial round account1 completed')
          await account2.sync()
          expect(account2.getData().error).to.not.be.ok
          console.log('Initial round account2 completed')

          let serverTreeAfterFirstSync = await getAllBookmarks(account1)

          let tree1AfterFirstSync = await account1.localTree.getBookmarksTree(
            true
          )
          let tree2AfterFirstSync = await account2.localTree.getBookmarksTree(
            true
          )
          if (!ACCOUNT_DATA.noCache) {
            expectTreeEqual(
              tree1AfterFirstSync,
              tree1Initial,
              false
            )

            console.log('Initial round: first tree ok')
            serverTreeAfterFirstSync.title = tree1Initial.title
            expectTreeEqual(
              serverTreeAfterFirstSync,
              tree1Initial,
              false
            )
            console.log('Initial round: server tree ok')
            tree2AfterFirstSync.title = tree1Initial.title
            expectTreeEqual(
              tree2AfterFirstSync,
              tree1Initial,
              false
            )
            console.log('Initial round: second tree ok')
          }
          tree1Initial = null
          tree1AfterFirstSync = null
          tree2AfterFirstSync = null
          serverTreeAfterFirstSync = null
          console.log('Initial round ok')

          for (let j = 0; j < 4; j++) {
            console.log('STARTING LOOP ' + j)

            let serverTreeAfterFirstSync = await getAllBookmarks(account1)

            let tree1AfterFirstSync = await account1.localTree.getBookmarksTree(
              true
            )
            let tree2AfterFirstSync = await account2.localTree.getBookmarksTree(
              true
            )
            if (!ACCOUNT_DATA.noCache) {
              tree1AfterFirstSync.title = serverTreeAfterFirstSync.title
              expectTreeEqual(
                tree1AfterFirstSync,
                serverTreeAfterFirstSync,
                false
              )
              console.log('first tree ok')
              tree2AfterFirstSync.title = serverTreeAfterFirstSync.title
              expectTreeEqual(
                tree2AfterFirstSync,
                serverTreeAfterFirstSync,
                false
              )
              console.log('Initial round: second tree ok')
            }
            serverTreeAfterFirstSync = null
            tree1AfterFirstSync = null
            tree2AfterFirstSync = null
            console.log('Initial round ok')

            await randomlyManipulateTree(account1, folders, bookmarks, 20)
            console.log(' acc1: Moved items')

            let tree1BeforeSync = await account1.localTree.getBookmarksTree(
              true
            )
            await account1.sync()
            expect(account1.getData().error).to.not.be.ok
            console.log('second round: account1 completed')

            let serverTreeAfterSync = await getAllBookmarks(account1)
            let tree1AfterSync = await account1.localTree.getBookmarksTree(true)

            if (!ACCOUNT_DATA.noCache) {
              expectTreeEqual(
                tree1AfterSync,
                tree1BeforeSync,
                false
              )
              console.log('Second round: local tree tree ok')
              serverTreeAfterSync.title = tree1AfterSync.title
              expectTreeEqual(
                serverTreeAfterSync,
                tree1AfterSync,
                false
              )
              console.log('Second round: server tree tree ok')
            }
            tree1BeforeSync = null
            serverTreeAfterSync = null
            console.log('first half ok')

            await account2.sync()
            expect(account2.getData().error).to.not.be.ok
            console.log('second round: account1 completed')

            let serverTreeAfterSecondSync = await getAllBookmarks(account1)

            let tree2AfterSecondSync = await account2.localTree.getBookmarksTree(
              true
            )
            if (!ACCOUNT_DATA.noCache) {
              expectTreeEqual(
                tree2AfterSecondSync,
                tree1AfterSync,
                false
              )
              console.log('Second round: second local tree tree ok')
              serverTreeAfterSecondSync.title = tree2AfterSecondSync.title
              expectTreeEqual(
                serverTreeAfterSecondSync,
                tree2AfterSecondSync,
                false
              )
              console.log('Second round: second server tree tree ok')
            }
            serverTreeAfterSecondSync = null
            console.log('second half ok')

            console.log('final sync')
            await account1.sync()
            expect(account1.getData().error).to.not.be.ok
            console.log('final sync completed')

            let serverTreeAfterFinalSync = await getAllBookmarks(account1)

            let tree1AfterFinalSync = await account1.localTree.getBookmarksTree(
              true
            )
            if (!ACCOUNT_DATA.noCache) {
              expectTreeEqual(
                tree1AfterFinalSync,
                tree2AfterSecondSync,
                false
              )
              console.log('Final round: local tree tree ok')
              tree2AfterSecondSync.title = serverTreeAfterFinalSync.title
              expectTreeEqual(
                tree2AfterSecondSync,
                serverTreeAfterFinalSync,
                false
              )
              console.log('Final round: server tree tree ok')
            }
            serverTreeAfterFinalSync = null
            tree1AfterFinalSync = null

            await account1.init()
            await account1.sync()
            expect(account1.getData().error).to.not.be.ok
            console.log('final sync after init completed')

            let serverTreeAfterInit = await getAllBookmarks(account1)

            let tree1AfterInit = await account1.localTree.getBookmarksTree(
              true
            )

            if (!ACCOUNT_DATA.noCache) {
              tree1AfterInit.title = serverTreeAfterInit.title
              expectTreeEqual(
                tree1AfterInit,
                serverTreeAfterInit,
                false
              )
              console.log('Final round after init: local tree ok')
              tree2AfterSecondSync.title = serverTreeAfterInit.title
              expectTreeEqual(
                tree2AfterSecondSync,
                serverTreeAfterInit,
                false
              )
              console.log('Final round after init: server tree ok')
            }
            tree1AfterInit = null
            serverTreeAfterInit = null
            tree2AfterSecondSync = null
          }
        })

        it('should handle fuzzed changes from two clients', async function() {
          const localResource1 = await account1.getResource()
          const localRoot1 = (await localResource1.getBookmarksTree()).id
          let bookmarks1 = []
          let folders1 = []

          let bookmarks2
          let folders2

          const createTree = async(parentId, i, j) => {
            const len = Math.abs(i - j)
            for (let k = i; k < j; k++) {
              let newBookmark
              const newBookmarkId = await localResource1.createBookmark(
                new Bookmark({
                  title: 'url' + i + ':' + j + ':' + k,
                  url: 'http://ur.l/' + parentId + '/' + i + '/' + j + '/' + k,
                  parentId,
                })
              )
              bookmarks1.push(new Bookmark({
                ...newBookmark,
                id: newBookmarkId,
              }))
            }

            if (len < 4) return

            const step = Math.floor(len / 4)
            for (let k = i; k < j; k += step) {
              let newFolder
              const newFolderId = await localResource1.createFolder(
                newFolder = new Folder({
                  title: 'folder' + i + ':' + k + ':' + (k + step),
                  parentId,
                })
              )
              folders1.push(new Folder({
                ...newFolder,
                id: newFolderId,
              }))
              await createTree(newFolderId, k, k + step)
            }
          }

          await createTree(localRoot1, 0, BENCHMARK_SIZE)

          let tree1Initial = await account1.localTree.getBookmarksTree(true)
          await account1.sync()
          expect(account1.getData().error).to.not.be.ok
          console.log('Initial round account1 completed')
          await account2.sync()
          expect(account2.getData().error).to.not.be.ok
          console.log('Initial round account2 completed')

          let serverTreeAfterFirstSync = await getAllBookmarks(account1)

          let tree1AfterFirstSync = await account1.localTree.getBookmarksTree(
            true
          )
          let tree2AfterFirstSync = await account2.localTree.getBookmarksTree(
            true
          )
          if (!ACCOUNT_DATA.noCache) {
            expectTreeEqual(
              tree1AfterFirstSync,
              tree1Initial,
              false
            )
            console.log('Initial round: first tree ok')
            serverTreeAfterFirstSync.title = tree1Initial.title
            expectTreeEqual(
              serverTreeAfterFirstSync,
              tree1Initial,
              false
            )
            console.log('Initial round: server tree ok')
            tree2AfterFirstSync.title = tree1Initial.title
            expectTreeEqual(
              tree2AfterFirstSync,
              tree1Initial,
              false
            )
            console.log('Initial round: second tree ok')
          }
          tree1Initial = null
          tree1AfterFirstSync = null
          serverTreeAfterFirstSync = null
          console.log('Initial round ok')

          for (let j = 0; j < 4; j++) {
            console.log('STARTING LOOP ' + j)

            let serverTreeAfterFirstSync = await getAllBookmarks(account1)

            let tree1AfterFirstSync = await account1.localTree.getBookmarksTree(
              true
            )
            let tree2AfterFirstSync = await account2.localTree.getBookmarksTree(
              true
            )
            if (!ACCOUNT_DATA.noCache) {
              tree1AfterFirstSync.title = serverTreeAfterFirstSync.title
              expectTreeEqual(
                tree1AfterFirstSync,
                serverTreeAfterFirstSync,
                false
              )
              console.log('first tree ok')
              tree2AfterFirstSync.title = serverTreeAfterFirstSync.title
              expectTreeEqual(
                tree2AfterFirstSync,
                serverTreeAfterFirstSync,
                false
              )
              console.log('Initial round: second tree ok')
            }
            tree1AfterFirstSync = null
            serverTreeAfterFirstSync = null
            console.log('Initial round ok')

            if (!bookmarks2) {
              tree2AfterFirstSync.createIndex()
              bookmarks2 = Object.values(tree2AfterFirstSync.index.bookmark)
              folders2 = Object.values(tree2AfterFirstSync.index.folder)
                // Make sure we don't delete the root folder :see_no_evil:
                .filter(item => item.id !== tree2AfterFirstSync.id)
            }

            await randomlyManipulateTree(account1, folders1, bookmarks1, RANDOM_MANIPULATION_ITERATIONS)
            await randomlyManipulateTree(account2, folders2, bookmarks2, RANDOM_MANIPULATION_ITERATIONS)

            console.log(' acc1: Moved items')

            let tree1BeforeSync = await account1.localTree.getBookmarksTree(
              true
            )
            await account1.sync()
            expect(account1.getData().error).to.not.be.ok
            console.log('second round: account1 completed')

            let serverTreeAfterSync = await getAllBookmarks(account1)

            let tree1AfterSync = await account1.localTree.getBookmarksTree(true)
            if (!ACCOUNT_DATA.noCache) {
              expectTreeEqual(
                tree1AfterSync,
                tree1BeforeSync,
                false
              )
              console.log('Second round: local tree tree ok')
              serverTreeAfterSync.title = tree1AfterSync.title
              expectTreeEqual(
                serverTreeAfterSync,
                tree1AfterSync,
                false
              )
              console.log('Second round: server tree tree ok')
            }
            tree1AfterSync = null
            serverTreeAfterSync = null
            tree1BeforeSync = null
            console.log('first half ok')

            await account2.sync()
            expect(account2.getData().error).to.not.be.ok
            console.log('second round: account1 completed')

            if (ACCOUNT_DATA.type === 'nextcloud-bookmarks') {
              // Extra round-trip for Nextcloud Bookmarks' different ID system
              await account1.sync()
              expect(account1.getData().error).to.not.be.ok
              await account2.sync()
              expect(account2.getData().error).to.not.be.ok
              console.log('Extra round-trip for Nextcloud Bookmarks completed')
            }

            let serverTreeAfterSecondSync = await getAllBookmarks(account1)

            let tree2AfterSecondSync = await account2.localTree.getBookmarksTree(
              true
            )
            if (!ACCOUNT_DATA.noCache) {
              serverTreeAfterSecondSync.title = tree2AfterSecondSync.title
              expectTreeEqual(
                serverTreeAfterSecondSync,
                tree2AfterSecondSync,
                false
              )
              console.log('Second round: second server tree tree ok')
            }
            serverTreeAfterSecondSync = null
            console.log('second half ok')

            console.log('final sync')
            await account1.sync()
            expect(account1.getData().error).to.not.be.ok
            console.log('final sync completed')

            let serverTreeAfterFinalSync = await getAllBookmarks(account1)

            let tree1AfterFinalSync = await account1.localTree.getBookmarksTree(
              true
            )
            if (!ACCOUNT_DATA.noCache) {
              expectTreeEqual(
                tree1AfterFinalSync,
                tree2AfterSecondSync,
                false
              )
              console.log('Final round: local tree tree ok')
              tree2AfterSecondSync.title = serverTreeAfterFinalSync.title
              expectTreeEqual(
                tree2AfterSecondSync,
                serverTreeAfterFinalSync,
                false
              )
              console.log('Final round: server tree tree ok')
            }
            serverTreeAfterFinalSync = null
            tree1AfterFinalSync = null

            await account1.init()
            await account1.sync()
            expect(account1.getData().error).to.not.be.ok
            console.log('final sync after init completed')

            let serverTreeAfterInit = await getAllBookmarks(account1)

            let tree1AfterInit = await account1.localTree.getBookmarksTree(
              true
            )

            if (!ACCOUNT_DATA.noCache) {
              tree1AfterInit.title = serverTreeAfterInit.title
              expectTreeEqual(
                tree1AfterInit,
                serverTreeAfterInit,
                false
              )
              console.log('Final round after init: local tree ok')
              tree2AfterSecondSync.title = serverTreeAfterInit.title
              expectTreeEqual(
                tree2AfterSecondSync,
                serverTreeAfterInit,
                false
              )
              console.log('Final round after init: server tree ok')
            }
            tree2AfterSecondSync = null
            tree1AfterInit = null
            serverTreeAfterInit = null
          }
        })

        it('should handle fuzzed changes with deletions from two clients (normal)', async function() {
          const localResource1 = await account1.getResource()
          const localRoot1 = (await localResource1.getBookmarksTree()).id
          let bookmarks1 = []
          let folders1 = []

          let bookmarks2
          let folders2

          const createTree = async(parentId, i, j) => {
            const len = Math.abs(i - j)
            for (let k = i; k < j; k++) {
              let newBookmark
              const newBookmarkId = await localResource1.createBookmark(
                newBookmark = new Bookmark({
                  title: 'url' + i + ':' + j + ':' + k,
                  url: 'http://ur.l/' + parentId + '/' + i + '/' + j + '/' + k,
                  parentId,
                })
              )
              bookmarks1.push(
                new Bookmark({
                  ...newBookmark,
                  id: newBookmarkId,
                })
              )
            }

            if (len < 4) return

            const step = Math.floor(len / 4)
            for (let k = i; k < j; k += step) {
              let newFolder
              const newFolderId = await localResource1.createFolder(
                (newFolder = new Folder({
                  title: 'folder' + i + ':' + k + ':' + (k + step),
                  parentId,
                }))
              )
              folders1.push(
                new Folder({
                  ...newFolder,
                  id: newFolderId,
                })
              )
              await createTree(newFolderId, k, k + step)
            }
          }

          await createTree(localRoot1, 0, BENCHMARK_SIZE)

          let tree1Initial = await account1.localTree.getBookmarksTree(true)
          await account1.sync()
          expect(account1.getData().error).to.not.be.ok
          console.log('Initial round account1 completed')
          await account2.sync()
          expect(account2.getData().error).to.not.be.ok
          console.log('Initial round account2 completed')

          let serverTreeAfterFirstSync = await getAllBookmarks(account1)

          let tree1AfterFirstSync = await account1.localTree.getBookmarksTree(
            true
          )
          let tree2AfterFirstSync = await account2.localTree.getBookmarksTree(
            true
          )
          if (!ACCOUNT_DATA.noCache) {
            expectTreeEqual(
              tree1AfterFirstSync,
              tree1Initial,
              false
            )
            console.log('Initial round: first tree ok')
            serverTreeAfterFirstSync.title = tree1Initial.title
            expectTreeEqual(
              serverTreeAfterFirstSync,
              tree1Initial,
              false
            )
            console.log('Initial round: server tree ok')
            tree2AfterFirstSync.title = tree1Initial.title
            expectTreeEqual(
              tree2AfterFirstSync,
              tree1Initial,
              false
            )
            console.log('Initial round: second tree ok')
          }
          tree1Initial = null
          serverTreeAfterFirstSync = null
          tree1AfterFirstSync = null
          tree2AfterFirstSync = null
          console.log('Initial round ok')

          for (let j = 0; j < 4; j++) {
            console.log('STARTING LOOP ' + j)

            let serverTreeAfterFirstSync = await getAllBookmarks(account1)

            let tree1AfterFirstSync = await account1.localTree.getBookmarksTree(
              true
            )
            let tree2AfterFirstSync = await account2.localTree.getBookmarksTree(
              true
            )
            if (!ACCOUNT_DATA.noCache) {
              tree1AfterFirstSync.title = serverTreeAfterFirstSync.title
              expectTreeEqual(
                tree1AfterFirstSync,
                serverTreeAfterFirstSync,
                false
              )
              console.log('first tree ok')
              tree2AfterFirstSync.title = serverTreeAfterFirstSync.title
              expectTreeEqual(
                tree2AfterFirstSync,
                serverTreeAfterFirstSync,
                false
              )
              console.log('Initial round: second tree ok')
            }
            serverTreeAfterFirstSync = null
            tree1AfterFirstSync = null
            console.log('Initial round ok')

            if (!bookmarks2) {
              tree2AfterFirstSync.createIndex()
              bookmarks2 = Object.values(tree2AfterFirstSync.index.bookmark)
              folders2 = Object.values(tree2AfterFirstSync.index.folder)
                // Make sure we don't delete the root folder :see_no_evil:
                .filter(item => item.id !== tree2AfterFirstSync.id)
            }

            await randomlyManipulateTreeWithDeletions(account1, folders1, bookmarks1, RANDOM_MANIPULATION_ITERATIONS)
            await randomlyManipulateTreeWithDeletions(account2, folders2, bookmarks2, RANDOM_MANIPULATION_ITERATIONS)

            console.log(' acc1&acc2: Moved items')

            let tree1BeforeSync = await account1.localTree.getBookmarksTree(
              true
            )
            await account1.sync()
            expect(account1.getData().error).to.not.be.ok
            console.log('second round: account1 completed')

            let serverTreeAfterSync = await getAllBookmarks(account1)
            let tree1AfterSync = await account1.localTree.getBookmarksTree(true)

            if (!ACCOUNT_DATA.noCache) {
              expectTreeEqual(
                tree1AfterSync,
                tree1BeforeSync,
                false
              )
              console.log('Second round: local tree tree ok')
              serverTreeAfterSync.title = tree1AfterSync.title
              expectTreeEqual(
                serverTreeAfterSync,
                tree1AfterSync,
                false
              )
              console.log('Second round: server tree tree ok')
            }
            tree1BeforeSync = null
            tree1AfterSync = null
            serverTreeAfterSync = null
            console.log('first half ok')

            await account2.sync()
            expect(account2.getData().error).to.not.be.ok

            // Sync twice, because some removal-move mixes are hard to sort out consistently
            await account2.sync()
            expect(account2.getData().error).to.not.be.ok

            console.log('second round: account2 completed')

            let serverTreeAfterSecondSync = await getAllBookmarks(account1)

            let tree2AfterSecondSync = await account2.localTree.getBookmarksTree(
              true
            )
            if (!ACCOUNT_DATA.noCache) {
              serverTreeAfterSecondSync.title = tree2AfterSecondSync.title
              expectTreeEqual(
                serverTreeAfterSecondSync,
                tree2AfterSecondSync,
                false
              )
              console.log('Second round: second server tree tree ok')
            }
            serverTreeAfterSecondSync = null
            console.log('second half ok')

            console.log('final sync')
            await account1.sync()
            expect(account1.getData().error).to.not.be.ok
            console.log('final sync completed')

            let serverTreeAfterFinalSync = await getAllBookmarks(account1)

            let tree1AfterFinalSync = await account1.localTree.getBookmarksTree(
              true
            )
            if (!ACCOUNT_DATA.noCache) {
              expectTreeEqual(
                tree1AfterFinalSync,
                tree2AfterSecondSync,
                false
              )
              console.log('Final round: local tree tree ok')
              tree2AfterSecondSync.title = serverTreeAfterFinalSync.title
              expectTreeEqual(
                tree2AfterSecondSync,
                serverTreeAfterFinalSync,
                false
              )
              console.log('Final round: server tree tree ok')
            }
            tree1AfterFinalSync = null

            await account1.init()
            await account1.sync()
            expect(account1.getData().error).to.not.be.ok
            console.log('final sync after init completed')

            let serverTreeAfterInit = await getAllBookmarks(account1)

            let tree1AfterInit = await account1.localTree.getBookmarksTree(
              true
            )

            if (!ACCOUNT_DATA.noCache) {
              tree1AfterInit.title = serverTreeAfterInit.title
              expectTreeEqual(
                tree1AfterInit,
                serverTreeAfterInit,
                false
              )
              console.log('Final round after init: local tree ok')
              tree2AfterSecondSync.title = serverTreeAfterFinalSync.title
              expectTreeEqual(
                tree2AfterSecondSync,
                serverTreeAfterInit,
                false
              )
              console.log('Final round after init: server tree ok')
            }
            serverTreeAfterInit = null
            tree1AfterInit = null
            serverTreeAfterInit = null
          }
        })
        let interruptBenchmark
        it('should handle fuzzed changes with deletions from two clients with interrupts' + (ACCOUNT_DATA.type === 'fake' ? ' (with caching)' : ''), interruptBenchmark = async function() {
          const localResource1 = await account1.getResource()
          const localRoot1 = (await localResource1.getBookmarksTree()).id
          let bookmarks1 = []
          let folders1 = []

          let bookmarks2
          let folders2

          const createTree = async(parentId, i, j) => {
            const len = Math.abs(i - j)
            for (let k = i; k < j; k++) {
              let newBookmark
              const newBookmarkId = await localResource1.createBookmark(
                newBookmark = new Bookmark({
                  title: 'url' + i + ':' + j + ':' + k,
                  url: 'http://ur.l/' + parentId + '/' + i + '/' + j + '/' + k,
                  parentId,
                })
              )
              bookmarks1.push(
                new Bookmark({
                  ...newBookmark,
                  id: newBookmarkId,
                })
              )
            }

            if (len < 4) return

            const step = Math.floor(len / 4)
            for (let k = i; k < j; k += step) {
              let newFolder
              const newFolderId = await localResource1.createFolder(
                (newFolder = new Folder({
                  title: 'folder' + i + ':' + k + ':' + (k + step),
                  parentId,
                }))
              )
              folders1.push(
                new Folder({
                  ...newFolder,
                  id: newFolderId,
                })
              )
              await createTree(newFolderId, k, k + step)
            }
          }

          await createTree(localRoot1, 0, BENCHMARK_SIZE)

          let tree1Initial = await account1.localTree.getBookmarksTree(true)
          await syncAccountWithInterrupts(account1)
          console.log('Initial round account1 completed')
          await syncAccountWithInterrupts(account2)
          console.log('Initial round account2 completed')

          let serverTreeAfterFirstSync = await getAllBookmarks(account1)

          let tree1AfterFirstSync = await account1.localTree.getBookmarksTree(
            true
          )
          let tree2AfterFirstSync = await account2.localTree.getBookmarksTree(
            true
          )
          if (!ACCOUNT_DATA.noCache) {
            expectTreeEqual(
              tree1AfterFirstSync,
              tree1Initial,
              false
            )
            console.log('Initial round: first tree ok')
            serverTreeAfterFirstSync.title = tree1Initial.title
            expectTreeEqual(
              serverTreeAfterFirstSync,
              tree1Initial,
              false
            )
            console.log('Initial round: server tree ok')
            tree2AfterFirstSync.title = tree1Initial.title
            expectTreeEqual(
              tree2AfterFirstSync,
              tree1Initial,
              false
            )
            console.log('Initial round: second tree ok')
          }
          tree1Initial = null
          serverTreeAfterFirstSync = null
          tree1AfterFirstSync = null
          tree2AfterFirstSync = null
          console.log('Initial round ok')

          for (let j = 0; j < 4; j++) {
            console.log('STARTING LOOP ' + j)

            let serverTreeAfterFirstSync = await getAllBookmarks(account1)

            let tree1AfterFirstSync = await account1.localTree.getBookmarksTree(
              true
            )
            let tree2AfterFirstSync = await account2.localTree.getBookmarksTree(
              true
            )
            if (!ACCOUNT_DATA.noCache) {
              tree1AfterFirstSync.title = serverTreeAfterFirstSync.title
              expectTreeEqual(
                tree1AfterFirstSync,
                serverTreeAfterFirstSync,
                false
              )
              console.log('first tree ok')
              tree2AfterFirstSync.title = serverTreeAfterFirstSync.title
              expectTreeEqual(
                tree2AfterFirstSync,
                serverTreeAfterFirstSync,
                false
              )
              console.log('Initial round: second tree ok')
            }
            serverTreeAfterFirstSync = null
            tree1AfterFirstSync = null
            console.log('Initial round ok')

            if (!bookmarks2) {
              tree2AfterFirstSync.createIndex()
              bookmarks2 = Object.values(tree2AfterFirstSync.index.bookmark)
              folders2 = Object.values(tree2AfterFirstSync.index.folder)
                // Make sure we don't delete the root folder :see_no_evil:
                .filter(item => item.id !== tree2AfterFirstSync.id)
            }

            await randomlyManipulateTreeWithDeletions(account1, folders1, bookmarks1, RANDOM_MANIPULATION_ITERATIONS)
            await randomlyManipulateTreeWithDeletions(account2, folders2, bookmarks2, RANDOM_MANIPULATION_ITERATIONS)

            console.log(' acc1 &acc2: Moved items')

            let tree1BeforeSync = await account1.localTree.getBookmarksTree(
              true
            )
            await syncAccountWithInterrupts(account1)
            console.log('second round: account1 completed')

            let serverTreeAfterSync = await getAllBookmarks(account1)
            let tree1AfterSync = await account1.localTree.getBookmarksTree(true)

            if (!ACCOUNT_DATA.noCache) {
              expectTreeEqual(
                tree1AfterSync,
                tree1BeforeSync,
                false
              )
              console.log('Second round: local tree tree ok')
              serverTreeAfterSync.title = tree1AfterSync.title
              expectTreeEqual(
                serverTreeAfterSync,
                tree1AfterSync,
                false
              )
              console.log('Second round: server tree tree ok')
            }
            tree1BeforeSync = null
            tree1AfterSync = null
            serverTreeAfterSync = null
            console.log('first half ok')

            RUN_INTERRUPTS = true

            await syncAccountWithInterrupts(account2)

            // Sync twice, because some removal-move mixes are hard to sort out consistently
            await syncAccountWithInterrupts(account2)

            RUN_INTERRUPTS = false

            console.log('second round: account2 completed')

            let serverTreeAfterSecondSync = await getAllBookmarks(account1)

            let tree2AfterSecondSync = await account2.localTree.getBookmarksTree(
              true
            )
            if (!ACCOUNT_DATA.noCache) {
              serverTreeAfterSecondSync.title = tree2AfterSecondSync.title
              expectTreeEqual(
                serverTreeAfterSecondSync,
                tree2AfterSecondSync,
                false
              )
              console.log('Second round: second server tree tree ok')
            }
            serverTreeAfterSecondSync = null
            console.log('second half ok')

            console.log('final sync')
            RUN_INTERRUPTS = true
            await syncAccountWithInterrupts(account1)
            RUN_INTERRUPTS = false
            console.log('final sync completed')

            let serverTreeAfterFinalSync = await getAllBookmarks(account1)

            let tree1AfterFinalSync = await account1.localTree.getBookmarksTree(
              true
            )
            if (!ACCOUNT_DATA.noCache) {
              expectTreeEqual(
                tree1AfterFinalSync,
                tree2AfterSecondSync,
                false
              )
              console.log('Final round: local tree tree ok')
              tree2AfterSecondSync.title = serverTreeAfterFinalSync.title
              expectTreeEqual(
                tree2AfterSecondSync,
                serverTreeAfterFinalSync,
                false
              )
              console.log('Final round: server tree tree ok')
            }
            tree1AfterFinalSync = null

            await account1.init()
            RUN_INTERRUPTS = true
            await syncAccountWithInterrupts(account1)
            RUN_INTERRUPTS = false
            console.log('final sync after init completed')

            let serverTreeAfterInit = await getAllBookmarks(account1)

            let tree1AfterInit = await account1.localTree.getBookmarksTree(
              true
            )

            if (!ACCOUNT_DATA.noCache) {
              tree1AfterInit.title = serverTreeAfterInit.title
              expectTreeEqual(
                tree1AfterInit,
                serverTreeAfterInit,
                false
              )
              console.log('Final round after init: local tree ok')
              tree2AfterSecondSync.title = serverTreeAfterFinalSync.title
              expectTreeEqual(
                tree2AfterSecondSync,
                serverTreeAfterInit,
                false
              )
              console.log('Final round after init: server tree ok')
            }
            serverTreeAfterInit = null
            tree1AfterInit = null
            serverTreeAfterInit = null
          }
        })

        if (ACCOUNT_DATA.type === 'fake') {
          it('should handle fuzzed changes with deletions from two clients with interrupts (no caching adapter)', async function() {
            // Wire both accounts to the same fake db
            // We set the cache properties to the same object, because we want to simulate nextcloud-bookmarks
            const bmDb = account1.server.bookmarksCache = account2.server.bookmarksCache = new Folder(
              { id: '', title: 'root', location: 'Server' }
            )
            account1.server.onSyncStart = function() { this.bookmarksCache = bmDb }
            account1.server.isAtomic = () => false
            account2.server.onSyncStart = function() { this.bookmarksCache = bmDb }
            account2.server.isAtomic = () => false
            await interruptBenchmark()
          })
        }

        it('unidirectional should handle fuzzed changes from two clients', async function() {
          await account2.setData({ strategy: 'slave'})

          const localResource1 = await account1.getResource()
          const localRoot1 = (await localResource1.getBookmarksTree()).id
          let bookmarks1 = []
          let folders1 = []

          let bookmarks2
          let folders2

          const createTree = async(parentId, i, j) => {
            const len = Math.abs(i - j)
            for (let k = i; k < j; k++) {
              let newBookmark
              const newBookmarkId = await localResource1.createBookmark(
                newBookmark = new Bookmark({
                  title: 'url' + i + ':' + j + ':' + k,
                  url: 'http://ur.l/' + parentId + '/' + i + '/' + j + '/' + k,
                  parentId,
                })
              )
              bookmarks1.push(
                new Bookmark({
                  ...newBookmark,
                  id: newBookmarkId,
                })
              )
            }

            if (len < 4) return

            const step = Math.floor(len / 4)
            for (let k = i; k < j; k += step) {
              let newFolder
              const newFolderId = await localResource1.createFolder(
                (newFolder = new Folder({
                  title: 'folder' + i + ':' + k + ':' + (k + step),
                  parentId,
                }))
              )
              folders1.push(
                new Folder({
                  ...newFolder,
                  id: newFolderId,
                })
              )
              await createTree(newFolderId, k, k + step)
            }
          }

          await createTree(localRoot1, 0, BENCHMARK_SIZE)

          let tree1Initial = await account1.localTree.getBookmarksTree(true)
          await account1.sync()
          expect(account1.getData().error).to.not.be.ok
          console.log('Initial round account1 completed')
          await account2.sync()
          expect(account2.getData().error).to.not.be.ok
          console.log('Initial round account2 completed')

          let serverTreeAfterFirstSync = await getAllBookmarks(account1)

          let tree1AfterFirstSync = await account1.localTree.getBookmarksTree(
            true
          )
          let tree2AfterFirstSync = await account2.localTree.getBookmarksTree(
            true
          )
          if (!ACCOUNT_DATA.noCache) {
            expectTreeEqual(
              tree1AfterFirstSync,
              tree1Initial,
              false
            )
            console.log('Initial round: first tree ok')
            serverTreeAfterFirstSync.title = tree1Initial.title
            expectTreeEqual(
              serverTreeAfterFirstSync,
              tree1Initial,
              false
            )
            console.log('Initial round: server tree ok')
            tree2AfterFirstSync.title = tree1Initial.title
            expectTreeEqual(
              tree2AfterFirstSync,
              tree1Initial,
              false
            )
            console.log('Initial round: second tree ok')
          }
          tree1Initial = null
          tree1AfterFirstSync = null
          serverTreeAfterFirstSync = null
          console.log('Initial round ok')

          for (let j = 0; j < 4; j++) {
            console.log('STARTING LOOP ' + j)

            let serverTreeAfterFirstSync = await getAllBookmarks(account1)

            let tree1AfterFirstSync = await account1.localTree.getBookmarksTree(
              true
            )
            let tree2AfterFirstSync = await account2.localTree.getBookmarksTree(
              true
            )
            if (!ACCOUNT_DATA.noCache) {
              tree1AfterFirstSync.title = serverTreeAfterFirstSync.title
              expectTreeEqual(
                tree1AfterFirstSync,
                serverTreeAfterFirstSync,
                false
              )
              console.log('first tree ok')
              tree2AfterFirstSync.title = serverTreeAfterFirstSync.title
              expectTreeEqual(
                tree2AfterFirstSync,
                serverTreeAfterFirstSync,
                false
              )
              console.log('Initial round: second tree ok')
            }
            tree1AfterFirstSync = null
            serverTreeAfterFirstSync = null
            console.log('Initial round ok')

            if (!bookmarks2) {
              tree2AfterFirstSync.createIndex()
              bookmarks2 = Object.values(tree2AfterFirstSync.index.bookmark)
              folders2 = Object.values(tree2AfterFirstSync.index.folder)
                // Make sure we don't delete the root folder :see_no_evil:
                .filter(item => item.id !== tree2AfterFirstSync.id)
            }

            await randomlyManipulateTree(account1, folders1, bookmarks1, 20)
            await randomlyManipulateTree(account2, folders2, bookmarks2, 20)

            console.log(' acc1: Moved items')

            let tree1BeforeSync = await account1.localTree.getBookmarksTree(
              true
            )
            await account1.sync()
            expect(account1.getData().error).to.not.be.ok
            console.log('second round: account1 completed')

            let serverTreeAfterSync = await getAllBookmarks(account1)
            let tree1AfterSync = await account1.localTree.getBookmarksTree(true)

            if (!ACCOUNT_DATA.noCache) {
              expectTreeEqual(
                tree1AfterSync,
                tree1BeforeSync,
                false
              )
              console.log('Second round: local tree tree ok')
              serverTreeAfterSync.title = tree1AfterSync.title
              expectTreeEqual(
                serverTreeAfterSync,
                tree1AfterSync,
                false
              )
              console.log('Second round: server tree tree ok')
            }
            tree1BeforeSync = null
            console.log('first half ok')

            await account2.sync()
            expect(account2.getData().error).to.not.be.ok
            console.log('second round: account1 completed')

            let serverTreeAfterSecondSync = await getAllBookmarks(account1)

            let tree2AfterSecondSync = await account2.localTree.getBookmarksTree(
              true
            )
            if (!ACCOUNT_DATA.noCache) {
              serverTreeAfterSecondSync.title = tree1AfterSync.title
              expectTreeEqual(
                serverTreeAfterSecondSync,
                tree1AfterSync,
                false
              )
              serverTreeAfterSecondSync.title = tree2AfterSecondSync.title
              expectTreeEqual(
                serverTreeAfterSecondSync,
                tree2AfterSecondSync,
                false
              )
              console.log('Second round: second server tree tree ok')
            }
            serverTreeAfterSecondSync = null
            console.log('second half ok')

            console.log('final sync')
            await account1.sync()
            expect(account1.getData().error).to.not.be.ok
            console.log('final sync completed')

            let serverTreeAfterFinalSync = await getAllBookmarks(account1)

            let tree1AfterFinalSync = await account1.localTree.getBookmarksTree(
              true
            )
            if (!ACCOUNT_DATA.noCache) {
              expectTreeEqual(
                tree1AfterFinalSync,
                tree2AfterSecondSync,
                false
              )
              console.log('Final round: local tree tree ok')
              tree2AfterSecondSync.title = serverTreeAfterFinalSync.title
              expectTreeEqual(
                tree2AfterSecondSync,
                serverTreeAfterFinalSync,
                false
              )
              console.log('Final round: server tree tree ok')
            }
            serverTreeAfterFinalSync = null
            tree1AfterFinalSync = null

            await account1.init()
            await account1.sync()
            expect(account1.getData().error).to.not.be.ok
            console.log('final sync after init completed')

            let serverTreeAfterInit = await getAllBookmarks(account1)

            let tree1AfterInit = await account1.localTree.getBookmarksTree(
              true
            )

            if (!ACCOUNT_DATA.noCache) {
              tree1AfterSync.title = serverTreeAfterInit.title
              expectTreeEqual(
                tree1AfterSync,
                serverTreeAfterInit,
                false
              )
              tree1AfterInit.title = serverTreeAfterSync.title
              expectTreeEqual(
                tree1AfterInit,
                serverTreeAfterSync,
                false
              )
              console.log('Final round after init: local tree ok')
              tree2AfterSecondSync.title = serverTreeAfterInit.title
              expectTreeEqual(
                tree2AfterSecondSync,
                serverTreeAfterInit,
                false
              )
              console.log('Final round after init: server tree ok')
            }
            tree2AfterSecondSync = null
            tree1AfterInit = null
            serverTreeAfterInit = null
          }
        })

        it('unidirectional should handle fuzzed changes with deletions from two clients', async function() {
          await account2.setData({ strategy: 'slave'})

          const localResource1 = await account1.getResource()
          const localRoot1 = (await localResource1.getBookmarksTree()).id
          let bookmarks1 = []
          let folders1 = []

          let bookmarks2
          let folders2

          const createTree = async(parentId, i, j) => {
            const len = Math.abs(i - j)
            for (let k = i; k < j; k++) {
              let newBookmark
              const newBookmarkId = await localResource1.createBookmark(
                newBookmark = new Bookmark({
                  title: 'url' + i + ':' + j + ':' + k,
                  url: 'http://ur.l/' + parentId + '/' + i + '/' + j + '/' + k,
                  parentId,
                })
              )
              bookmarks1.push(
                new Bookmark({
                  ...newBookmark,
                  id: newBookmarkId,
                })
              )
            }

            if (len < 4) return

            const step = Math.floor(len / 4)
            for (let k = i; k < j; k += step) {
              let newFolder
              const newFolderId = await localResource1.createFolder(
                (newFolder = new Folder({
                  title: 'folder' + i + ':' + k + ':' + (k + step),
                  parentId,
                }))
              )
              folders1.push(
                new Folder({
                  ...newFolder,
                  id: newFolderId,
                })
              )
              await createTree(newFolderId, k, k + step)
            }
          }

          await createTree(localRoot1, 0, BENCHMARK_SIZE)

          let tree1Initial = await account1.localTree.getBookmarksTree(true)
          await account1.sync()
          expect(account1.getData().error).to.not.be.ok
          console.log('Initial round account1 completed')
          await account2.sync()
          expect(account2.getData().error).to.not.be.ok
          console.log('Initial round account2 completed')

          let serverTreeAfterFirstSync = await getAllBookmarks(account1)

          let tree1AfterFirstSync = await account1.localTree.getBookmarksTree(
            true
          )
          let tree2AfterFirstSync = await account2.localTree.getBookmarksTree(
            true
          )
          if (!ACCOUNT_DATA.noCache) {
            tree1AfterFirstSync.title = tree1Initial.title
            expectTreeEqual(
              tree1AfterFirstSync,
              tree1Initial,
              false
            )
            console.log('Initial round: first tree ok')
            serverTreeAfterFirstSync.title = tree1Initial.title
            expectTreeEqual(
              serverTreeAfterFirstSync,
              tree1Initial,
              false
            )
            console.log('Initial round: server tree ok')
            tree2AfterFirstSync.title = tree1Initial.title
            expectTreeEqual(
              tree2AfterFirstSync,
              tree1Initial,
              false
            )
            console.log('Initial round: second tree ok')
          }
          tree1Initial = null
          serverTreeAfterFirstSync = null
          tree1AfterFirstSync = null
          tree2AfterFirstSync = null
          console.log('Initial round ok')

          for (let j = 0; j < 4; j++) {
            console.log('STARTING LOOP ' + j)

            let serverTreeAfterFirstSync = await getAllBookmarks(account1)

            let tree1AfterFirstSync = await account1.localTree.getBookmarksTree(
              true
            )
            let tree2AfterFirstSync = await account2.localTree.getBookmarksTree(
              true
            )
            if (!ACCOUNT_DATA.noCache) {
              tree1AfterFirstSync.title = serverTreeAfterFirstSync.title
              expectTreeEqual(
                tree1AfterFirstSync,
                serverTreeAfterFirstSync,
                false
              )
              console.log('first tree ok')
              tree2AfterFirstSync.title = serverTreeAfterFirstSync.title
              expectTreeEqual(
                tree2AfterFirstSync,
                serverTreeAfterFirstSync,
                false
              )
              console.log('Initial round: second tree ok')
            }
            serverTreeAfterFirstSync = null
            tree1AfterFirstSync = null
            console.log('Initial round ok')

            if (!bookmarks2) {
              tree2AfterFirstSync.createIndex()
              bookmarks2 = Object.values(tree2AfterFirstSync.index.bookmark)
              folders2 = Object.values(tree2AfterFirstSync.index.folder)
                // Make sure we don't delete the root folder :see_no_evil:
                .filter(item => item.id !== tree2AfterFirstSync.id)
            }

            await randomlyManipulateTreeWithDeletions(account1, folders1, bookmarks1, RANDOM_MANIPULATION_ITERATIONS)
            await randomlyManipulateTreeWithDeletions(account2, folders2, bookmarks2, RANDOM_MANIPULATION_ITERATIONS)

            console.log(' acc1: Moved items')

            let tree1BeforeSync = await account1.localTree.getBookmarksTree(
              true
            )
            await account1.sync()
            expect(account1.getData().error).to.not.be.ok
            console.log('second round: account1 completed')

            let serverTreeAfterSync = await getAllBookmarks(account1)
            let tree1AfterSync = await account1.localTree.getBookmarksTree(true)

            if (!ACCOUNT_DATA.noCache) {
              tree1BeforeSync.title = tree1AfterSync.title
              expectTreeEqual(
                tree1AfterSync,
                tree1BeforeSync,
                false
              )
              console.log('Second round: local tree tree ok')
              serverTreeAfterSync.title = tree1AfterSync.title
              expectTreeEqual(
                serverTreeAfterSync,
                tree1AfterSync,
                false
              )
              console.log('Second round: server tree tree ok')
            }
            tree1BeforeSync = null
            console.log('first half ok')

            await account2.sync()
            expect(account2.getData().error).to.not.be.ok

            // Sync twice, because some removal-move mixes are hard to sort out consistently
            await account2.sync()
            expect(account2.getData().error).to.not.be.ok

            console.log('second round: account2 completed')

            let serverTreeAfterSecondSync = await getAllBookmarks(account1)

            let tree2AfterSecondSync = await account2.localTree.getBookmarksTree(
              true
            )
            if (!ACCOUNT_DATA.noCache) {
              serverTreeAfterSync.title = serverTreeAfterSecondSync.title
              expectTreeEqual(
                serverTreeAfterSecondSync,
                serverTreeAfterSync,
                false
              )
              serverTreeAfterSecondSync.title = tree2AfterSecondSync.title
              expectTreeEqual(
                serverTreeAfterSecondSync,
                tree2AfterSecondSync,
                false
              )
              console.log('Second round: second server tree tree ok')
            }
            serverTreeAfterSecondSync = null
            console.log('second half ok')

            console.log('final sync')
            await account1.sync()
            expect(account1.getData().error).to.not.be.ok
            console.log('final sync completed')

            let serverTreeAfterFinalSync = await getAllBookmarks(account1)

            let tree1AfterFinalSync = await account1.localTree.getBookmarksTree(
              true
            )
            if (!ACCOUNT_DATA.noCache) {
              tree1AfterFinalSync.title = tree1AfterSync.title
              expectTreeEqual(
                tree1AfterFinalSync,
                tree1AfterSync,
                false
              )
              tree2AfterSecondSync.title = tree1AfterFinalSync.title
              expectTreeEqual(
                tree1AfterFinalSync,
                tree2AfterSecondSync,
                false
              )
              console.log('Final round: local tree tree ok')
              serverTreeAfterSync.title = serverTreeAfterFinalSync.title
              expectTreeEqual(
                serverTreeAfterFinalSync,
                serverTreeAfterSync,
                false
              )
              tree2AfterSecondSync.title = serverTreeAfterFinalSync.title
              expectTreeEqual(
                tree2AfterSecondSync,
                serverTreeAfterFinalSync,
                false
              )
              console.log('Final round: server tree tree ok')
            }
            tree1AfterFinalSync = null

            await account1.init()
            await account1.sync()
            expect(account1.getData().error).to.not.be.ok
            console.log('final sync after init completed')

            let serverTreeAfterInit = await getAllBookmarks(account1)

            let tree1AfterInit = await account1.localTree.getBookmarksTree(
              true
            )

            if (!ACCOUNT_DATA.noCache) {
              tree1AfterInit.title = serverTreeAfterInit.title
              expectTreeEqual(
                tree1AfterInit,
                serverTreeAfterInit,
                false
              )
              tree1AfterInit.title = tree1AfterSync.title
              expectTreeEqual(
                tree1AfterInit,
                tree1AfterSync,
                false
              )
              console.log('Final round after init: local tree ok')
              serverTreeAfterInit.title = serverTreeAfterSync.title
              expectTreeEqual(
                serverTreeAfterInit,
                serverTreeAfterSync,
                false
              )
              console.log('Final round after init: server tree ok')
            }
            serverTreeAfterInit = null
            tree1AfterInit = null
            serverTreeAfterInit = null
          }
        })
      })
    })
  })
})
