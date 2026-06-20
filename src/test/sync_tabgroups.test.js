/* global IS_BROWSER */
import Account from '../lib/Account'
import { Bookmark, Folder } from '../lib/Tree'
import * as AsyncParallel from 'async-parallel'
import Controller from '../lib/Controller'
import {
  awaitTabsUpdated, DUMP_LOGS,
  expect,
  expectTreeEqual,
  filterBookmarksInTree,
  getAllBookmarks,
  getEnv,
  seedTestRandom,
  stringifyAccountData, withSyncConnection
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
        context('with tab groups', function() {
          if (!IS_BROWSER) {
            return
          }
          if (ACCOUNT_DATA.type === 'linkwarden' || ACCOUNT_DATA.type === 'karakeep') {
            return
          }
          this.timeout(600000)
          let browser

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
          let account
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
                windowType: 'normal' // no devtools or panels or popups
              })
              await browser.tabs.remove(tabs.filter(tab => tab.url.startsWith('http')).map(tab => tab.id))
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
                await AsyncParallel.each(tree.children, async child => {
                  if (child instanceof Folder) {
                    await account.server.removeFolder(child)
                  } else {
                    await account.server.removeBookmark(child)
                  }
                })
              })
            }
            if (ACCOUNT_DATA.type === 'google-drive') {
              const fileList = await account.server.listFiles('name = ' + "'" + ACCOUNT_DATA.bookmark_file + "'")
              const files = fileList.files
              for (const file of files) {
                await account.server.deleteFile(file.id)
              }
              if (files.length > 1) {
                throw new Error('Google Drive sync left more than one file behind')
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

          it('should create a tab group with two new tabs', async function() {
            // Skip if browser doesn't support tab groups
            if (typeof browser.tabGroups === 'undefined') {
              return this.skip()
            }

            // Create two tabs
            const tab1 = await browser.tabs.create({
              url: TEST_URL + '#test1'
            })
            const tab2 = await browser.tabs.create({
              url: TEST_URL + '#test2'
            })
            await awaitTabsUpdated()

            // Group the tabs
            const groupId = await browser.tabs.group({
              tabIds: [tab1.id, tab2.id]
            })

            // Set the group title
            await browser.tabGroups.update(groupId, {
              title: 'Test Group'
            })
            await awaitTabsUpdated()

            // Sync
            await account.sync()
            expect(account.getData().error).to.not.be.ok

            await awaitTabsUpdated()

            // Verify the result
            const tree = await getAllBookmarks(account)
            expectTreeEqual(
              tree,
              new Folder({
                title: tree.title,
                children: [
                  new Folder({
                    title: 'Window 0',
                    children: [
                      new Folder({
                        title: 'Test Group',
                        children: [
                          new Bookmark({ title: TEST_URL_TITLE, url: TEST_URL + '#test1' }),
                          new Bookmark({ title: TEST_URL_TITLE, url: TEST_URL + '#test2' })
                        ]
                      })
                    ]
                  })
                ]
              }),
              false
            )

            const localTree = await account.localTabs.getBookmarksTree(true)
            filterBookmarksInTree(localTree, b => b.url.startsWith('http'))
            expectTreeEqual(
              localTree,
              new Folder({
                title: localTree.title,
                children: [
                  new Folder({
                    title: 'Window 0',
                    children: [
                      new Folder({
                        title: 'Test Group',
                        children: [
                          new Bookmark({ title: TEST_URL_TITLE, url: TEST_URL + '#test1' }),
                          new Bookmark({ title: TEST_URL_TITLE, url: TEST_URL + '#test2' })
                        ]
                      })
                    ]
                  })
                ]
              }),
              false
            )
          })

          it('should create two tabs, then add them both to a tab group', async function() {
            // Skip if browser doesn't support tab groups
            if (typeof browser.tabGroups === 'undefined') {
              return this.skip()
            }

            // Create two tabs
            const tab1 = await browser.tabs.create({
              url: TEST_URL + '#test1'
            })
            const tab2 = await browser.tabs.create({
              url: TEST_URL + '#test2'
            })
            await awaitTabsUpdated()

            // Sync first to create the tabs on the server
            await account.sync()
            expect(account.getData().error).to.not.be.ok

            await awaitTabsUpdated()

            // Verify the initial state
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

            const localTree = await account.localTabs.getBookmarksTree(true)
            filterBookmarksInTree(localTree, b => b.url.startsWith('http'))
            expectTreeEqual(
              localTree,
              new Folder({
                title: localTree.title,
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

            // Now group the tabs
            const groupId = await browser.tabs.group({
              tabIds: [tab1.id, tab2.id]
            })

            // Set the group title
            await browser.tabGroups.update(groupId, {
              title: 'Test Group'
            })
            await awaitTabsUpdated()

            // Sync again
            await account.sync()
            expect(account.getData().error).to.not.be.ok

            await awaitTabsUpdated()

            // Verify the result
            tree = await getAllBookmarks(account)
            expectTreeEqual(
              tree,
              new Folder({
                title: tree.title,
                children: [
                  new Folder({
                    title: 'Window 0',
                    children: [
                      new Folder({
                        title: 'Test Group',
                        children: [
                          new Bookmark({ title: TEST_URL_TITLE, url: TEST_URL + '#test1' }),
                          new Bookmark({ title: TEST_URL_TITLE, url: TEST_URL + '#test2' })
                        ]
                      })
                    ]
                  })
                ]
              }),
              false
            )

            const localTreeAfter = await account.localTabs.getBookmarksTree(true)
            filterBookmarksInTree(localTreeAfter, b => b.url.startsWith('http'))
            expectTreeEqual(
              localTreeAfter,
              new Folder({
                title: localTreeAfter.title,
                children: [
                  new Folder({
                    title: 'Window 0',
                    children: [
                      new Folder({
                        title: 'Test Group',
                        children: [
                          new Bookmark({ title: TEST_URL_TITLE, url: TEST_URL + '#test1' }),
                          new Bookmark({ title: TEST_URL_TITLE, url: TEST_URL + '#test2' })
                        ]
                      })
                    ]
                  })
                ]
              }),
              false
            )
          })

          it('should move one tab out of a tab group', async function() {
            // Skip if browser doesn't support tab groups
            if (typeof browser.tabGroups === 'undefined') {
              return this.skip()
            }

            // Create two tabs
            const tab1 = await browser.tabs.create({
              url: TEST_URL + '#test1'
            })
            const tab2 = await browser.tabs.create({
              url: TEST_URL + '#test2'
            })
            await awaitTabsUpdated()

            // Group the tabs
            const groupId = await browser.tabs.group({
              tabIds: [tab1.id, tab2.id]
            })

            // Set the group title
            await browser.tabGroups.update(groupId, {
              title: 'Test Group'
            })
            await awaitTabsUpdated()

            // Sync
            await account.sync()
            expect(account.getData().error).to.not.be.ok

            await awaitTabsUpdated()

            // Verify the initial state
            let tree = await getAllBookmarks(account)
            expectTreeEqual(
              tree,
              new Folder({
                title: tree.title,
                children: [
                  new Folder({
                    title: 'Window 0',
                    children: [
                      new Folder({
                        title: 'Test Group',
                        children: [
                          new Bookmark({ title: TEST_URL_TITLE, url: TEST_URL + '#test1' }),
                          new Bookmark({ title: TEST_URL_TITLE, url: TEST_URL + '#test2' })
                        ]
                      })
                    ]
                  })
                ]
              }),
              false,
              !ACCOUNT_DATA.noCache,
            )

            const localTree = await account.localTabs.getBookmarksTree(true)
            filterBookmarksInTree(localTree, b => b.url.startsWith('http'))
            expectTreeEqual(
              localTree,
              new Folder({
                title: localTree.title,
                children: [
                  new Folder({
                    title: 'Window 0',
                    children: [
                      new Folder({
                        title: 'Test Group',
                        children: [
                          new Bookmark({ title: TEST_URL_TITLE, url: TEST_URL + '#test1' }),
                          new Bookmark({ title: TEST_URL_TITLE, url: TEST_URL + '#test2' })
                        ]
                      })
                    ]
                  })
                ]
              }),
              false,
              !ACCOUNT_DATA.noCache,
            )

            // Move one tab out of the group
            await browser.tabs.ungroup([tab1.id])
            await awaitTabsUpdated()

            // Sync again
            await account.sync()
            expect(account.getData().error).to.not.be.ok

            await awaitTabsUpdated()

            // Verify the result
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
                      new Folder({
                        title: 'Test Group',
                        children: [
                          new Bookmark({ title: TEST_URL_TITLE, url: TEST_URL + '#test2' })
                        ]
                      })
                    ]
                  })
                ]
              }),
              false,
              !ACCOUNT_DATA.noCache,
            )

            const localTreeAfter = await account.localTabs.getBookmarksTree(true)
            filterBookmarksInTree(localTreeAfter, b => b.url.startsWith('http'))
            expectTreeEqual(
              localTreeAfter,
              new Folder({
                title: localTreeAfter.title,
                children: [
                  new Folder({
                    title: 'Window 0',
                    children: [
                      new Bookmark({ title: TEST_URL_TITLE, url: TEST_URL + '#test1' }),
                      new Folder({
                        title: 'Test Group',
                        children: [
                          new Bookmark({ title: TEST_URL_TITLE, url: TEST_URL + '#test2' })
                        ]
                      })
                    ]
                  })
                ]
              }),
              false,
              !ACCOUNT_DATA.noCache,
            )
          })

          it('should reorder tabs and tab groups', async function() {
            // Skip if browser doesn't support tab groups
            if (typeof browser.tabGroups === 'undefined') {
              return this.skip()
            }

            // Create tabs and groups
            const tab1 = await browser.tabs.create({
              url: TEST_URL + '#test1'
            })
            const tab2 = await browser.tabs.create({
              url: TEST_URL + '#test2'
            })
            const tab3 = await browser.tabs.create({
              url: TEST_URL + '#test3'
            })
            await awaitTabsUpdated()

            // Create first group with tab1
            const groupId1 = await browser.tabs.group({
              tabIds: [tab1.id]
            })
            await browser.tabGroups.update(groupId1, {
              title: 'Group 1'
            })

            // Create second group with tab2
            const groupId2 = await browser.tabs.group({
              tabIds: [tab2.id]
            })
            await browser.tabGroups.update(groupId2, {
              title: 'Group 2'
            })
            await awaitTabsUpdated()

            // Sync
            await account.sync()
            expect(account.getData().error).to.not.be.ok

            await awaitTabsUpdated()

            // Verify the initial state
            let tree = await getAllBookmarks(account)
            expectTreeEqual(
              tree,
              new Folder({
                title: tree.title,
                children: [
                  new Folder({
                    title: 'Window 0',
                    children: [
                      new Folder({
                        title: 'Group 1',
                        children: [
                          new Bookmark({ title: TEST_URL_TITLE, url: TEST_URL + '#test1' })
                        ]
                      }),
                      new Folder({
                        title: 'Group 2',
                        children: [
                          new Bookmark({ title: TEST_URL_TITLE, url: TEST_URL + '#test2' })
                        ]
                      }),
                      new Bookmark({ title: TEST_URL_TITLE, url: TEST_URL + '#test3' })
                    ]
                  })
                ]
              }),
              false,
              !ACCOUNT_DATA.noCache,
            )

            const localTree = await account.localTabs.getBookmarksTree(true)
            filterBookmarksInTree(localTree, b => b.url.startsWith('http'))
            expectTreeEqual(
              localTree,
              new Folder({
                title: localTree.title,
                children: [
                  new Folder({
                    title: 'Window 0',
                    children: [
                      new Folder({
                        title: 'Group 1',
                        children: [
                          new Bookmark({ title: TEST_URL_TITLE, url: TEST_URL + '#test1' })
                        ]
                      }),
                      new Folder({
                        title: 'Group 2',
                        children: [
                          new Bookmark({ title: TEST_URL_TITLE, url: TEST_URL + '#test2' })
                        ]
                      }),
                      new Bookmark({ title: TEST_URL_TITLE, url: TEST_URL + '#test3' })
                    ]
                  })
                ]
              }),
              false,
              !ACCOUNT_DATA.noCache,
            )

            // Reorder the tabs and groups
            // Move tab3 to index 0
            await browser.tabs.move(tab3.id, { index: 0 })
            // Move group2 to index 1
            await browser.tabGroups.move(groupId2, { index: 1 })
            await awaitTabsUpdated()

            // Sync again
            await account.sync()
            expect(account.getData().error).to.not.be.ok

            await awaitTabsUpdated()

            // Verify the result
            tree = await getAllBookmarks(account)
            expectTreeEqual(
              tree,
              new Folder({
                title: tree.title,
                children: [
                  new Folder({
                    title: 'Window 0',
                    children: [
                      new Bookmark({ title: TEST_URL_TITLE, url: TEST_URL + '#test3' }),
                      new Folder({
                        title: 'Group 2',
                        children: [
                          new Bookmark({ title: TEST_URL_TITLE, url: TEST_URL + '#test2' })
                        ]
                      }),
                      new Folder({
                        title: 'Group 1',
                        children: [
                          new Bookmark({ title: TEST_URL_TITLE, url: TEST_URL + '#test1' })
                        ]
                      })
                    ]
                  })
                ]
              }),
              false,
              !ACCOUNT_DATA.noCache,
            )

            const localTreeAfter = await account.localTabs.getBookmarksTree(true)
            filterBookmarksInTree(localTreeAfter, b => b.url.startsWith('http'))
            expectTreeEqual(
              localTreeAfter,
              new Folder({
                title: localTreeAfter.title,
                children: [
                  new Folder({
                    title: 'Window 0',
                    children: [
                      new Bookmark({ title: TEST_URL_TITLE, url: TEST_URL + '#test3' }),
                      new Folder({
                        title: 'Group 2',
                        children: [
                          new Bookmark({ title: TEST_URL_TITLE, url: TEST_URL + '#test2' })
                        ]
                      }),
                      new Folder({
                        title: 'Group 1',
                        children: [
                          new Bookmark({ title: TEST_URL_TITLE, url: TEST_URL + '#test1' })
                        ]
                      })
                    ]
                  })
                ]
              }),
              false,
              !ACCOUNT_DATA.noCache,
            )
          })

          it('should create a tab group on the server and sync to local tabs', async function() {
            // Skip if browser doesn't support tab groups
            if (typeof browser.tabGroups === 'undefined') {
              return this.skip()
            }

            if (ACCOUNT_DATA.noCache) {
              return this.skip()
            }

            // Create two tabs
            await browser.tabs.create({
              url: TEST_URL + '#test1'
            })
            await browser.tabs.create({
              url: TEST_URL + '#test2'
            })
            await awaitTabsUpdated()

            // Sync first to create the tabs on the server
            await account.sync()
            expect(account.getData().error).to.not.be.ok

            await awaitTabsUpdated()

            // Verify the initial state
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
              false,
              !ACCOUNT_DATA.noCache,
            )

            const localTreeBefore = await account.localTabs.getBookmarksTree(true)
            filterBookmarksInTree(localTreeBefore, b => b.url.startsWith('http'))
            expectTreeEqual(
              localTreeBefore,
              new Folder({
                title: localTreeBefore.title,
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
              false,
              !ACCOUNT_DATA.noCache,
            )

            // Create a tab group on the server by modifying the bookmark tree
            await withSyncConnection(account, async() => {
              // Get the current tree
              const serverTree = await account.server.getBookmarksTree(true)

              // Create a new folder for the tab group
              const windowFolder = serverTree.children[0]
              const tabGroupFolder = new Folder({
                title: 'Server Group',
                parentId: windowFolder.id
              })

              // Add the folder to the server
              const newFolderId = await account.server.createFolder(tabGroupFolder)

              // Move the bookmarks into the new folder
              for (const bookmark of windowFolder.children) {
                if (bookmark instanceof Bookmark) {
                  await account.server.updateBookmark(new Bookmark({
                    ...bookmark,
                    parentId: newFolderId
                  }))
                }
              }
            })

            // Sync to propagate server changes to local tabs
            await account.sync()
            expect(account.getData().error).to.not.be.ok

            await awaitTabsUpdated()

            // Verify the local tab state
            const localTree = await account.localTabs.getBookmarksTree(true)
            filterBookmarksInTree(localTree, b => b.url.startsWith('http'))
            expectTreeEqual(
              localTree,
              new Folder({
                title: localTree.title,
                children: [
                  new Folder({
                    title: 'Window 0',
                    children: [
                      new Folder({
                        title: 'Server Group',
                        children: [
                          new Bookmark({ title: TEST_URL_TITLE, url: TEST_URL + '#test1' }),
                          new Bookmark({ title: TEST_URL_TITLE, url: TEST_URL + '#test2' })
                        ]
                      })
                    ]
                  })
                ]
              }),
              false,
              !ACCOUNT_DATA.noCache,
            )
            console.log('localTree ok')

            // Verify the server state
            tree = await getAllBookmarks(account)
            expectTreeEqual(
              tree,
              new Folder({
                title: tree.title,
                children: [
                  new Folder({
                    title: 'Window 0',
                    children: [
                      new Folder({
                        title: 'Server Group',
                        children: [
                          new Bookmark({ title: TEST_URL_TITLE, url: TEST_URL + '#test1' }),
                          new Bookmark({ title: TEST_URL_TITLE, url: TEST_URL + '#test2' })
                        ]
                      })
                    ]
                  })
                ]
              }),
              false,
              !ACCOUNT_DATA.noCache,
            )
          })

          it('should rename a tab group on the server and sync to local tabs', async function() {
            // Skip if browser doesn't support tab groups
            if (typeof browser.tabGroups === 'undefined') {
              return this.skip()
            }

            if (ACCOUNT_DATA.noCache) {
              return this.skip()
            }

            // Create two tabs
            const tab1 = await browser.tabs.create({
              url: TEST_URL + '#test1'
            })
            const tab2 = await browser.tabs.create({
              url: TEST_URL + '#test2'
            })
            await awaitTabsUpdated()

            // Group the tabs
            const groupId = await browser.tabs.group({
              tabIds: [tab1.id, tab2.id]
            })

            // Set the group title
            await browser.tabGroups.update(groupId, {
              title: 'Original Group'
            })
            await awaitTabsUpdated()

            // Sync to propagate to the server
            await account.sync()
            expect(account.getData().error).to.not.be.ok

            await awaitTabsUpdated()

            // Verify the initial state
            let tree = await getAllBookmarks(account)
            expectTreeEqual(
              tree,
              new Folder({
                title: tree.title,
                children: [
                  new Folder({
                    title: 'Window 0',
                    children: [
                      new Folder({
                        title: 'Original Group',
                        children: [
                          new Bookmark({ title: TEST_URL_TITLE, url: TEST_URL + '#test1' }),
                          new Bookmark({ title: TEST_URL_TITLE, url: TEST_URL + '#test2' })
                        ]
                      })
                    ]
                  })
                ]
              }),
              false,
              !ACCOUNT_DATA.noCache,
            )

            // Rename the tab group on the server
            await withSyncConnection(account, async() => {
              // Get the current tree
              const serverTree = await account.server.getBookmarksTree(true)

              // Find the tab group folder
              const windowFolder = serverTree.children[0]
              const tabGroupFolder = windowFolder.children[0]

              // Update the folder title
              await account.server.updateFolder({
                ...tabGroupFolder,
                title: 'Renamed Group'
              })
            })

            // Sync to propagate server changes to local tabs
            await account.sync()
            expect(account.getData().error).to.not.be.ok

            await awaitTabsUpdated()

            // Verify the local tab state
            const localTree = await account.localTabs.getBookmarksTree(true)
            filterBookmarksInTree(localTree, b => b.url.startsWith('http'))
            expectTreeEqual(
              localTree,
              new Folder({
                title: localTree.title,
                children: [
                  new Folder({
                    title: 'Window 0',
                    children: [
                      new Folder({
                        title: 'Renamed Group',
                        children: [
                          new Bookmark({ title: TEST_URL_TITLE, url: TEST_URL + '#test1' }),
                          new Bookmark({ title: TEST_URL_TITLE, url: TEST_URL + '#test2' })
                        ]
                      })
                    ]
                  })
                ]
              }),
              false,
              !ACCOUNT_DATA.noCache,
            )

            // Verify the server state
            tree = await getAllBookmarks(account)
            expectTreeEqual(
              tree,
              new Folder({
                title: tree.title,
                children: [
                  new Folder({
                    title: 'Window 0',
                    children: [
                      new Folder({
                        title: 'Renamed Group',
                        children: [
                          new Bookmark({ title: TEST_URL_TITLE, url: TEST_URL + '#test1' }),
                          new Bookmark({ title: TEST_URL_TITLE, url: TEST_URL + '#test2' })
                        ]
                      })
                    ]
                  })
                ]
              }),
              false,
              !ACCOUNT_DATA.noCache,
            )
          })

          it('should move tabs out of a group on the server and sync to local tabs', async function() {
            // Skip if browser doesn't support tab groups
            if (typeof browser.tabGroups === 'undefined') {
              return this.skip()
            }
            if (ACCOUNT_DATA.noCache) {
              return this.skip()
            }

            // Create two tabs
            const tab1 = await browser.tabs.create({
              url: TEST_URL + '#test1'
            })
            const tab2 = await browser.tabs.create({
              url: TEST_URL + '#test2'
            })
            await awaitTabsUpdated()

            // Group the tabs
            const groupId = await browser.tabs.group({
              tabIds: [tab1.id, tab2.id]
            })

            // Set the group title
            await browser.tabGroups.update(groupId, {
              title: 'Test Group'
            })
            await awaitTabsUpdated()

            // Sync to propagate to the server
            await account.sync()
            expect(account.getData().error).to.not.be.ok

            await awaitTabsUpdated()

            // Verify the initial state
            let tree = await getAllBookmarks(account)
            expectTreeEqual(
              tree,
              new Folder({
                title: tree.title,
                children: [
                  new Folder({
                    title: 'Window 0',
                    children: [
                      new Folder({
                        title: 'Test Group',
                        children: [
                          new Bookmark({ title: TEST_URL_TITLE, url: TEST_URL + '#test1' }),
                          new Bookmark({ title: TEST_URL_TITLE, url: TEST_URL + '#test2' })
                        ]
                      })
                    ]
                  })
                ]
              }),
              false,
              !ACCOUNT_DATA.noCache,
            )

            // Move tabs out of the group on the server
            await withSyncConnection(account, async() => {
              // Get the current tree
              const serverTree = await account.server.getBookmarksTree(true)

              // Find the tab group folder and window folder
              const windowFolder = serverTree.children[0]
              const tabGroupFolder = windowFolder.children[0]

              // Move the bookmarks out of the group
              for (const bookmark of tabGroupFolder.children) {
                await account.server.updateBookmark(new Bookmark({
                  ...bookmark,
                  parentId: windowFolder.id
                }))
              }

              // Remove the now-empty group folder
              await account.server.removeFolder(tabGroupFolder)
            })

            // Sync to propagate server changes to local tabs
            await account.sync()
            expect(account.getData().error).to.not.be.ok

            await awaitTabsUpdated()

            // Verify the local tab state
            const localTree = await account.localTabs.getBookmarksTree(true)
            filterBookmarksInTree(localTree, b => b.url.startsWith('http'))
            expectTreeEqual(
              localTree,
              new Folder({
                title: localTree.title,
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
              false,
              !ACCOUNT_DATA.noCache,
            )

            // Verify the server state
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
                      new Bookmark({ title: TEST_URL_TITLE, url: TEST_URL + '#test2' })
                    ]
                  })
                ]
              }),
              false,
              !ACCOUNT_DATA.noCache,
            )
          })
        })
      })
  })
})