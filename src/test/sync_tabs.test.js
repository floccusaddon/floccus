/* global IS_BROWSER */
import Account from '../lib/Account'
import { Bookmark, Folder, ItemLocation } from '../lib/Tree'
import * as AsyncParallel from 'async-parallel'
import Controller from '../lib/Controller'
import {
  awaitTabsUpdated, DUMP_LOGS, expect,
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

  let {
    TEST_URL,
    SEED,
    ACCOUNTS,
  } = getEnv()
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
    describe(`${stringifyAccountData(ACCOUNT_DATA)} test ${ACCOUNT_DATA.serverRoot ? 'subfolder' : 'root'} Sync`,
      function() {
        context('with tabs', function() {
          if (!IS_BROWSER) {
            return
          }
          if (ACCOUNT_DATA.type === 'linkwarden' || ACCOUNT_DATA.type === 'karakeep') {
            return
          }
          let account, browser
          let TEST_URL_TITLE
          before(async function() {
            ({ default: browser } = await import('../lib/browser-api.js'))
            // Set up TEST_URL and TEST_URL_TITLE
            await browser.tabs.create({
              index: 1,
              url: TEST_URL
            })
            await awaitTabsUpdated()
            const tabs = await browser.tabs.query({
              windowType: 'normal' // no devtools or panels or popups
            })
            const tab = tabs.filter(tab => tab.url.startsWith('http'))[0]
            TEST_URL = tab.url
            TEST_URL_TITLE = tab.title
            await browser.tabs.remove(tab.id)
          })
          beforeEach('set up account', async function() {
            account = await Account.create(ACCOUNT_DATA)
            if (ACCOUNT_DATA.type === 'fake') {
              account.server.bookmarksCache = new Folder({
                id: '',
                title: 'root',
                location: 'Server'
              })
            }
            await account.init()
            await account.setData({ localRoot: 'tabs', rootPath: 'Tabs' })
            if (ACCOUNT_DATA.noCache) {
              account.storage.setCache = () => {
                // noop
              }
              account.storage.setMappings = () => {
                // noop
              }
            }
          })
          afterEach('clean up account', async function() {
            DUMP_LOGS(this.currentTest)
            if (!account) return
            try {
              await awaitTabsUpdated()
              const tabs = await browser.tabs.query({
                windowType: 'normal', // no devtools or panels or popups
              })
              await browser.tabs.remove(
                tabs
                  .filter(
                    (tab) =>
                      !tab.url.startsWith('chrome') &&
                      !tab.url.startsWith('moz')
                  )
                  .map((tab) => tab.id)
              )
            } catch (e) {
              console.error(e)
            }
            await awaitTabsUpdated()
            if (ACCOUNT_DATA.type === 'git') {
              await account.server.clearServer()
            } else if (ACCOUNT_DATA.type !== 'fake') {
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
            if (ACCOUNT_DATA.type === 'google-drive') {
              const fileList = await account.server.listFiles(
                'name = ' + "'" + ACCOUNT_DATA.bookmark_file + "'"
              )
              const files = fileList.files
              for (const file of files) {
                await account.server.deleteFile(file.id)
              }
              if (files.length > 1) {
                throw new Error(
                  'Google Drive sync left more than one file behind'
                )
              }
            }
            if (ACCOUNT_DATA.type === 'dropbox') {
              const fileList = await account.server.listFiles(
                ACCOUNT_DATA.bookmark_file,
                100
              )
              const files = fileList.matches
              for (const file of files) {
                await account.server.deleteFile(file.metadata.metadata.id)
              }
              if (files.length > 1) {
                throw new Error('Dropbox sync left more than one file behind')
              }
            }
            await account.delete()
          })
          it('should create local tabs on the server', async function() {
            await browser.tabs.create({
              index: 1,
              url: TEST_URL + '#test1'
            })
            await browser.tabs.create({
              index: 2,
              url: TEST_URL + '#test2'
            })
            await awaitTabsUpdated()

            await account.sync()
            expect(account.getData().error).to.not.be.ok

            const tree = await getAllBookmarks(account)
            expectTreeEqual(
              tree,
              new Folder({
                title: tree.title,
                children: [
                  new Folder({
                    title: 'Window 0',
                    children: [
                      new Bookmark({ title: TEST_URL_TITLE, url: TEST_URL + '#test1' }),
                      new Bookmark({ title: TEST_URL_TITLE, url: TEST_URL + '#test2' })
                    ]
                  })
                ]
              }),
              false
            )
          })
          it('should create server bookmarks as tabs', async function() {
            const adapter = account.server
            const serverTree = await getAllBookmarks(account)
            let windowFolderId, serverMark
            await withSyncConnection(account, async() => {
              windowFolderId = await adapter.createFolder(new Folder({
                parentId: serverTree.id,
                title: 'Window 0',
                location: ItemLocation.SERVER
              }))
              serverMark = {
                title: TEST_URL_TITLE,
                url: TEST_URL + '',
                parentId: windowFolderId,
                location: ItemLocation.SERVER
              }

              await adapter.createBookmark(
                new Bookmark(serverMark)
              )
            })

            await account.sync()
            expect(account.getData().error).to.not.be.ok

            await awaitTabsUpdated()

            const tree = await getAllBookmarks(account)
            expectTreeEqual(
              tree,
              new Folder({
                title: tree.title,
                children: [
                  new Folder({
                    title: 'Window 0',
                    children: [
                      new Bookmark({ title: TEST_URL_TITLE, url: TEST_URL + '' }),
                    ]
                  })
                ]
              }),
              false
            )
          })
          it('should update the server when pushing local changes', async function() {
            await account.setData({ strategy: 'overwrite' })

            await browser.tabs.create({
              index: 1,
              url: TEST_URL + '#test1'
            })
            const tab = await browser.tabs.create({
              index: 2,
              url: TEST_URL + '#test2'
            })
            await awaitTabsUpdated()

            await account.sync()
            expect(account.getData().error).to.not.be.ok

            let tree = await getAllBookmarks(account)
            expectTreeEqual(
              tree,
              new Folder({
                title: tree.title,
                children: [
                  new Folder({
                    title: 'Window 0',
                    children: [
                      new Bookmark({ title: TEST_URL_TITLE, url: TEST_URL + '#test1' }),
                      new Bookmark({ title: TEST_URL_TITLE, url: TEST_URL + '#test2' })
                    ]
                  })
                ]
              }),
              false
            )

            await browser.tabs.update(tab.id, { url: TEST_URL + '#test3' })
            await awaitTabsUpdated()

            await account.sync()
            expect(account.getData().error).to.not.be.ok

            tree = await getAllBookmarks(account)
            expectTreeEqual(
              tree,
              new Folder({
                title: tree.title,
                children: [
                  new Folder({
                    title: 'Window 0',
                    children: [
                      new Bookmark({ title: TEST_URL_TITLE, url: TEST_URL + '#test1' }),
                      new Bookmark({ title: TEST_URL_TITLE, url: TEST_URL + '#test3' })
                    ]
                  })
                ]
              }),
              false
            )
          })
          it('should update local tabs when pulling server changes', async function() {
            const adapter = account.server
            const serverTree = await getAllBookmarks(account)
            let windowFolderId, serverMark, serverMarkId
            await withSyncConnection(account, async() => {
              windowFolderId = await adapter.createFolder(new Folder({
                parentId: serverTree.id,
                title: 'Window 0',
                location: ItemLocation.SERVER
              }))
              serverMark = {
                title: TEST_URL_TITLE,
                url: TEST_URL + '#test1',
                parentId: windowFolderId,
                location: ItemLocation.SERVER
              }

              serverMarkId = await adapter.createBookmark(
                new Bookmark(serverMark)
              )
            })

            await account.sync()
            expect(account.getData().error).to.not.be.ok

            await awaitTabsUpdated()

            let tree = await getAllBookmarks(account)
            expectTreeEqual(
              tree,
              new Folder({
                title: tree.title,
                children: [
                  new Folder({
                    title: 'Window 0',
                    children: [
                      new Bookmark({ title: TEST_URL_TITLE, url: TEST_URL + '#test1' }),
                    ]
                  })
                ]
              }),
              false
            )

            let serverMark2
            await withSyncConnection(account, async() => {
              serverMark2 = {
                title: TEST_URL_TITLE,
                url: TEST_URL + '#test3',
                parentId: tree.children[0].id,
                location: ItemLocation.SERVER
              }
              await adapter.createBookmark(
                new Bookmark(serverMark2)
              )

              await adapter.updateBookmark(new Bookmark({
                ...serverMark,
                id: serverMarkId,
                url: TEST_URL + '#test2',
                title: TEST_URL_TITLE,
                parentId: tree.children[0].id
              }))
            })

            await account.setData({ strategy: 'slave' })

            await account.sync()
            expect(account.getData().error).to.not.be.ok

            await awaitTabsUpdated()

            tree = await getAllBookmarks(account)
            expectTreeEqual(
              tree,
              new Folder({
                title: tree.title,
                children: [
                  new Folder({
                    title: 'Window 0',
                    children: [
                      new Bookmark({ title: TEST_URL_TITLE, url: TEST_URL + '#test2' }),
                      new Bookmark({ title: TEST_URL_TITLE, url: TEST_URL + '#test3' }),
                    ]
                  })
                ]
              }),
              false
            )
          })
          it('should sync tabs correctly when merging server and local changes', async function() {
            if (ACCOUNT_DATA.noCache) {
              return this.skip()
            }
            const adapter = account.server
            const serverTree = await getAllBookmarks(account)
            let windowFolderId, serverMark, serverMarkId
            await withSyncConnection(account, async() => {
              windowFolderId = await adapter.createFolder(new Folder({
                parentId: serverTree.id,
                title: 'Window 0',
                location: ItemLocation.SERVER
              }))
              serverMark = {
                title: TEST_URL_TITLE,
                url: TEST_URL + '#test1',
                parentId: windowFolderId,
                location: ItemLocation.SERVER
              }

              serverMarkId = await adapter.createBookmark(
                new Bookmark(serverMark)
              )
            })

            await account.sync()
            expect(account.getData().error).to.not.be.ok

            await awaitTabsUpdated()

            let tree = await getAllBookmarks(account)
            expectTreeEqual(
              tree,
              new Folder({
                title: tree.title,
                children: [
                  new Folder({
                    title: 'Window 0',
                    children: [
                      new Bookmark({ title: TEST_URL_TITLE, url: TEST_URL + '#test1' }),
                    ]
                  })
                ]
              }),
              false
            )

            let serverMark2
            await withSyncConnection(account, async() => {
              serverMark2 = {
                title: TEST_URL_TITLE,
                url: TEST_URL + '#test3',
                parentId: tree.children[0].id,
                location: ItemLocation.SERVER
              }
              await adapter.createBookmark(
                new Bookmark(serverMark2)
              )

              await adapter.updateBookmark(new Bookmark({
                ...serverMark,
                id: serverMarkId,
                url: TEST_URL + '#test2',
                title: TEST_URL_TITLE,
                parentId: tree.children[0].id
              }))
            })

            await browser.tabs.create({ url: TEST_URL + '#test4' })
            await awaitTabsUpdated()

            await account.sync()
            expect(account.getData().error).to.not.be.ok

            await awaitTabsUpdated()

            tree = await getAllBookmarks(account)
            expectTreeEqual(
              tree,
              new Folder({
                title: tree.title,
                children: [
                  new Folder({
                    title: 'Window 0',
                    children: [
                      new Bookmark({ title: TEST_URL_TITLE, url: TEST_URL + '#test2' }),
                      new Bookmark({ title: TEST_URL_TITLE, url: TEST_URL + '#test3' }),
                      new Bookmark({ title: TEST_URL_TITLE, url: TEST_URL + '#test4' }),
                    ]
                  })
                ]
              }),
              false,
              false, // We're merging which doesn't guarantee an order
            )
          })
        })
      })
  })
})