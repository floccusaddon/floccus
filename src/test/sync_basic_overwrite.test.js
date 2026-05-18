import Account from '../lib/Account'
import { Bookmark, Folder, ItemLocation } from '../lib/Tree'
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

  const {
    SEED,
    ACCOUNTS,
  } = getEnv()
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
        context('with one client', function() {
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
              await browser.bookmarks.removeTree(account.getData().localRoot)
            } catch (e) {
              console.error(e)
            }
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

          context('with overwrite mode', function() {
            it('should create local bookmarks on the server', async function() {
              await account.setData({
                strategy: 'overwrite'
              })
              expect(
                (await getAllBookmarks(account)).children
              ).to.have.lengthOf(0)

              const localRoot = account.getData().localRoot
              const fooFolder = await browser.bookmarks.create({
                title: 'foo',
                parentId: localRoot
              })
              const barFolder = await browser.bookmarks.create({
                title: 'bar',
                parentId: fooFolder.id
              })
              const bookmark = await browser.bookmarks.create({
                title: 'url',
                url: 'http://ur.l/',
                parentId: barFolder.id
              })
              await account.sync()
              expect(account.getData().error).to.not.be.ok

              const tree = await getAllBookmarks(account)
              expectTreeEqual(
                tree,
                new Folder({
                  title: tree.title,
                  children: [
                    new Folder({
                      title: 'foo',
                      children: [
                        new Folder({
                          title: 'bar',
                          children: [
                            new Bookmark({ title: 'url', url: bookmark.url })
                          ]
                        })
                      ]
                    })
                  ]
                }),
                false
              )
            })
            it('should create local bookmarks on the server respecting moves', async function() {
              await account.setData({
                strategy: 'overwrite'
              })
              expect(
                (await getAllBookmarks(account)).children
              ).to.have.lengthOf(0)

              const localRoot = account.getData().localRoot
              const fooFolder = await browser.bookmarks.create({
                title: 'foo',
                parentId: localRoot
              })
              const barFolder = await browser.bookmarks.create({
                title: 'bar',
                parentId: fooFolder.id
              })
              const bookmark = await browser.bookmarks.create({
                title: 'url',
                url: 'http://ur.l/',
                parentId: barFolder.id
              })
              await account.sync()
              expect(account.getData().error).to.not.be.ok

              const tree = await getAllBookmarks(account)
              expectTreeEqual(
                tree,
                new Folder({
                  title: tree.title,
                  children: [
                    new Folder({
                      title: 'foo',
                      children: [
                        new Folder({
                          title: 'bar',
                          children: [
                            new Bookmark({ title: 'url', url: bookmark.url })
                          ]
                        })
                      ]
                    })
                  ]
                }),
                false
              )

              const bazFolder = await browser.bookmarks.create({
                title: 'baz',
                parentId: localRoot
              })
              const barazFolder = await browser.bookmarks.create({
                title: 'baraz',
                parentId: bazFolder.id
              })
              await browser.bookmarks.move(barFolder.id, { parentId: barazFolder.id })
              await account.sync()
              expect(account.getData().error).to.not.be.ok

              const tree2 = await getAllBookmarks(account)
              expectTreeEqual(
                tree2,
                new Folder({
                  title: tree.title,
                  children: [
                    new Folder({
                      title: 'foo',
                      children: []
                    }),
                    new Folder({
                      title: 'baz',
                      children: [
                        new Folder({
                          title: 'baraz',
                          children: [
                            new Folder({
                              title: 'bar',
                              children: [
                                new Bookmark({ title: 'url', url: bookmark.url })
                              ]
                            })
                          ]
                        })
                      ]
                    })
                  ]
                }),
                false,
                Boolean(account.server.orderFolder)
              )
            })
            it('should update the server on local changes', async function() {
              if (ACCOUNT_DATA.noCache) {
                return this.skip()
              }
              expect(
                (await getAllBookmarks(account)).children
              ).to.have.lengthOf(0)

              const localRoot = account.getData().localRoot
              const fooFolder = await browser.bookmarks.create({
                title: 'foo',
                parentId: localRoot
              })
              const barFolder = await browser.bookmarks.create({
                title: 'bar',
                parentId: fooFolder.id
              })
              const bookmark = await browser.bookmarks.create({
                title: 'url',
                url: 'http://ur.l/',
                parentId: barFolder.id
              })
              await account.sync() // propagate to server
              expect(account.getData().error).to.not.be.ok

              await account.setData({
                strategy: 'overwrite'
              })

              const newData = { title: 'blah' }
              await browser.bookmarks.update(bookmark.id, newData)
              const originalTree = await account.localTree.getBookmarksTree(true)
              await account.sync() // update on server
              expect(account.getData().error).to.not.be.ok

              const tree = await getAllBookmarks(account)
              originalTree.title = tree.title
              expectTreeEqual(
                tree,
                originalTree,
                false
              )
            })
            it('should update the server on local removals', async function() {
              expect(
                (await getAllBookmarks(account)).children
              ).to.have.lengthOf(0)

              const localRoot = account.getData().localRoot
              const fooFolder = await browser.bookmarks.create({
                title: 'foo',
                parentId: localRoot
              })
              const barFolder = await browser.bookmarks.create({
                title: 'bar',
                parentId: fooFolder.id
              })
              const bookmark = await browser.bookmarks.create({
                title: 'url',
                url: 'http://ur.l/',
                parentId: barFolder.id
              })
              await account.sync() // propagate to server
              expect(account.getData().error).to.not.be.ok

              await account.setData({
                strategy: 'overwrite'
              })

              await browser.bookmarks.remove(bookmark.id)
              const originalTree = await account.localTree.getBookmarksTree(true)
              await account.sync() // update on server
              expect(account.getData().error).to.not.be.ok

              const tree = await getAllBookmarks(account)
              originalTree.title = tree.title
              expectTreeEqual(
                tree,
                originalTree,
                false
              )
            })
            it('should update the server on local folder moves', async function() {
              expect(
                (await getAllBookmarks(account)).children
              ).to.have.lengthOf(0)

              const localRoot = account.getData().localRoot
              const fooFolder = await browser.bookmarks.create({
                title: 'foo',
                parentId: localRoot
              })
              await browser.bookmarks.create({
                title: 'test',
                url: 'http://ureff.l/',
                parentId: fooFolder.id
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
              await account.sync() // propagate to server
              expect(account.getData().error).to.not.be.ok

              await account.setData({
                strategy: 'overwrite'
              })

              await browser.bookmarks.move(barFolder.id, {
                parentId: localRoot
              })
              const originalTree = await account.localTree.getBookmarksTree(true)
              await account.sync() // update on server
              expect(account.getData().error).to.not.be.ok

              const tree = await getAllBookmarks(account)
              originalTree.title = tree.title
              expectTreeEqual(
                tree,
                originalTree,
                false
              )
            })
            it("shouldn't create server bookmarks locally", async function() {
              await account.setData({
                strategy: 'overwrite'
              })
              const adapter = account.server
              const originalTree = await account.localTree.getBookmarksTree(true)
              const serverTree = await getAllBookmarks(account)

              if (adapter.onSyncStart) await adapter.onSyncStart()
              const fooFolderId = await adapter.createFolder(new Folder({
                parentId: serverTree.id,
                title: 'foo',
                location: ItemLocation.SERVER
              }))
              const barFolderId = await adapter.createFolder(new Folder({
                parentId: fooFolderId,
                title: 'bar',
                location: ItemLocation.SERVER
              }))
              const serverMark = {
                title: 'url',
                url: 'http://ur.l/',
                parentId: barFolderId,
                location: ItemLocation.SERVER
              }
              await adapter.createBookmark(
                new Bookmark(serverMark)
              )
              if (adapter.onSyncComplete) await adapter.onSyncComplete()

              await account.sync()
              expect(account.getData().error).to.not.be.ok

              const tree = await account.localTree.getBookmarksTree(true)
              originalTree.title = tree.title
              expectTreeEqual(
                tree,
                originalTree,
                false
              )
            })
            it("shouldn't update local bookmarks on server changes", async function() {
              const adapter = account.server
              const serverTree = await getAllBookmarks(account)

              if (adapter.onSyncStart) await adapter.onSyncStart()
              const fooFolderId = await adapter.createFolder(new Folder({
                parentId: serverTree.id,
                title: 'foo',
                location: ItemLocation.SERVER
              }))
              const barFolderId = await adapter.createFolder(new Folder({
                parentId: fooFolderId,
                title: 'bar',
                location: ItemLocation.SERVER
              }))
              const serverMark = {
                title: 'url',
                url: 'http://ur.l/',
                parentId: barFolderId,
                location: ItemLocation.SERVER
              }
              const serverMarkId = await adapter.createBookmark(
                new Bookmark(serverMark)
              )
              if (adapter.onSyncComplete) await adapter.onSyncComplete()

              await account.sync() // propage creation
              expect(account.getData().error).to.not.be.ok
              const originalTree = await account.localTree.getBookmarksTree(true)
              await account.setData({
                strategy: 'overwrite'
              })

              const newServerMark = {
                ...serverMark,
                title: 'blah',
                id: serverMarkId,
                location: ItemLocation.SERVER
              }
              await withSyncConnection(account, async() => {
                await adapter.updateBookmark(new Bookmark(newServerMark))
              })

              await account.sync() // propage update
              expect(account.getData().error).to.not.be.ok

              const tree = await account.localTree.getBookmarksTree(true)
              originalTree.title = tree.title
              expectTreeEqual(
                tree,
                originalTree,
                false
              )
            })
            it("shouldn't update local bookmarks on server removals", async function() {
              const adapter = account.server
              const serverTree = await getAllBookmarks(account)
              if (adapter.onSyncStart) await adapter.onSyncStart()
              const fooFolderId = await adapter.createFolder(new Folder({
                parentId: serverTree.id,
                title: 'foo',
                location: ItemLocation.SERVER
              }))
              const barFolderId = await adapter.createFolder(new Folder({
                parentId: fooFolderId,
                title: 'bar',
                location: ItemLocation.SERVER
              }))
              const serverMark = {
                title: 'url',
                url: 'http://ur.l/',
                parentId: barFolderId,
                location: ItemLocation.SERVER
              }
              const serverMarkId = await adapter.createBookmark(
                new Bookmark(serverMark)
              )
              if (adapter.onSyncComplete) await adapter.onSyncComplete()

              await account.sync() // propage creation
              expect(account.getData().error).to.not.be.ok
              const originalTree = await account.localTree.getBookmarksTree(true)
              await account.setData({
                strategy: 'overwrite'
              })

              await withSyncConnection(account, async() => {
                await adapter.removeBookmark({ ...serverMark, id: serverMarkId })
              })

              await account.sync() // propage update
              expect(account.getData().error).to.not.be.ok

              const tree = await account.localTree.getBookmarksTree(true)
              originalTree.title = tree.title
              expectTreeEqual(
                tree,
                originalTree,
                false
              )
            })
            it('should move items without confusing folders', async function() {
              const localRoot = account.getData().localRoot

              const folder1 = await browser.bookmarks.create({
                title: 'a',
                parentId: localRoot
              })
              const folder2 = await browser.bookmarks.create({
                title: 'b',
                parentId: folder1.id
              })
              const folder3 = await browser.bookmarks.create({
                title: 'c',
                parentId: folder2.id
              })
              const folder4 = await browser.bookmarks.create({
                title: 'd',
                parentId: localRoot
              })
              const folder5 = await browser.bookmarks.create({
                title: 'e',
                parentId: folder4.id,
              })
              const folder6 = await browser.bookmarks.create({
                title: 'f',
                parentId: folder5.id,
              })
              const folderX = await browser.bookmarks.create({
                title: 'X',
                parentId: folder3.id,
              })
              await browser.bookmarks.create({
                title: 'url',
                url: 'http://ur.l/',
                parentId: folderX.id
              })
              const folderX2 = await browser.bookmarks.create({
                title: 'X',
                parentId: folder6.id,
              })
              await browser.bookmarks.create({
                title: 'test',
                url: 'http://urrr.l/',
                parentId: folderX2.id
              })
              const test2Bm = await browser.bookmarks.create({
                title: 'test2',
                url: 'http://urrr2.l/',
                parentId: folder1.id
              })

              await account.sync() // propagate to server
              expect(account.getData().error).to.not.be.ok

              await account.sync() // make sure order is propagated
              expect(account.getData().error).to.not.be.ok

              await account.init() // remove cache

              await browser.bookmarks.move(folderX.id, { parentId: folder2.id })
              await browser.bookmarks.move(folderX2.id, { parentId: folder5.id })
              await browser.bookmarks.move(test2Bm.id, { parentId: folderX.id })

              await account.sync() // propagate to server
              expect(account.getData().error).to.not.be.ok

              const tree = await getAllBookmarks(account)
              expectTreeEqual(
                tree,
                new Folder({
                  title: tree.title,
                  children: [
                    new Folder({
                      title: 'a',
                      children: [
                        new Folder({
                          title: 'b',
                          children: [
                            new Folder({
                              title: 'c',
                              children: [],
                            }),
                            new Folder({
                              title: 'X',
                              children: [
                                new Bookmark({
                                  title: 'url',
                                  url: 'http://ur.l/',
                                }),
                                new Bookmark({
                                  title: 'test2',
                                  url: 'http://urrr2.l/',
                                }),
                              ],
                            }),
                          ],
                        }),
                      ],
                    }),
                    new Folder({
                      title: 'd',
                      children: [
                        new Folder({
                          title: 'e',
                          children: [
                            new Folder({
                              title: 'f',
                              children: [],
                            }),
                            new Folder({
                              title: 'X',
                              children: [
                                new Bookmark({
                                  title: 'test',
                                  url: 'http://urrr.l/',
                                }),
                              ],
                            }),
                          ],
                        }),
                      ],
                    }),
                  ],
                }),
                false,
                false
              )

              const localTree = await account.localTree.getBookmarksTree(true)
              localTree.title = tree.title
              expectTreeEqual(
                localTree,
                tree,
                false,
                false
              )
            })
          })
        })
      })
  })
})
