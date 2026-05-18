import Account from '../lib/Account'
import { Bookmark, Folder, ItemLocation } from '../lib/Tree'
import browser from '../lib/browser-api'
import * as AsyncParallel from 'async-parallel'
import Controller from '../lib/Controller'
import BrowserTree from '../lib/browser/BrowserTree'
import {
  ClientsideAdditionFailsafeError,
  ClientsideDeletionFailsafeError,
  ServersideAdditionFailsafeError, ServersideDeletionFailsafeError
} from '../errors/Error'
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

  const { BROWSER, SEED, ACCOUNTS, APP_VERSION } = getEnv()
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
          it('should create local bookmarks on the server', async function() {
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
          it('should create empty local folders on the server', async function() {
            const localRoot = account.getData().localRoot
            const fooFolder = await browser.bookmarks.create({
              title: 'foo',
              parentId: localRoot
            })
            await browser.bookmarks.create({
              title: 'bar',
              parentId: fooFolder.id
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
                        children: []
                      })
                    ]
                  })
                ]
              }),
              false
            )
          })
          it('should create local javascript bookmarks on the server', async function() {
            if (ACCOUNT_DATA.type === 'karakeep') {
              return this.skip()
            }
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
              url: 'javascript:void(0)',
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
              false,
              Boolean(account.server.orderFolder)
            )

            const bookmark2 = await browser.bookmarks.create({
              title: 'url2',
              url: 'javascript:void(1)',
              parentId: barFolder.id
            })
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
                    children: [
                      new Folder({
                        title: 'bar',
                        children: [
                          new Bookmark({ title: 'url', url: bookmark.url }),
                          new Bookmark({ title: 'url2', url: bookmark2.url }),
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

            const newData = { title: 'blah' }
            await browser.bookmarks.update(bookmark.id, newData)
            await account.sync() // update on server
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
                          new Bookmark({
                            title: newData.title,
                            url: bookmark.url
                          })
                        ]
                      })
                    ]
                  })
                ]
              }),
              false
            )
          })
          it('should update the server on local changes of duplicates', async function() {
            if (ACCOUNT_DATA.noCache) {
              return this.skip()
            }

            const localRoot = account.getData().localRoot
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
              parentId: fooFolder.id
            })
            const bookmark2 = await browser.bookmarks.create({
              title: 'url',
              url: 'http://ur.l/',
              parentId: barFolder.id
            })
            await account.sync() // propagate to server
            expect(account.getData().error).to.not.be.ok

            const newData = { title: 'blah' }
            await browser.bookmarks.update(bookmark2.id, newData)
            await account.sync() // update on server
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
                          new Bookmark({
                            title: newData.title,
                            url: bookmark1.url
                          })
                        ]
                      }),
                      new Bookmark({
                        title: ACCOUNT_DATA.type === 'nextcloud-bookmarks' || ACCOUNT_DATA.type === 'karakeep' ? newData.title : bookmark2.title,
                        url: bookmark1.url
                      }),
                    ]
                  })
                ]
              }),
              false
            )
          })
          it('should update the server on local changes of url collisions', async function() {
            if (ACCOUNT_DATA.noCache) {
              return this.skip()
            }

            const localRoot = account.getData().localRoot
            const fooFolder = await browser.bookmarks.create({
              title: 'foo',
              parentId: localRoot
            })
            const barFolder = await browser.bookmarks.create({
              title: 'bar',
              parentId: fooFolder.id
            })
            const bookmark1 = await browser.bookmarks.create({
              title: 'ur1l',
              url: 'http://ur1.l/',
              parentId: fooFolder.id
            })
            const bookmark2 = await browser.bookmarks.create({
              title: 'url',
              url: 'http://ur.l/',
              parentId: barFolder.id
            })
            await account.sync() // propagate to server
            expect(account.getData().error).to.not.be.ok

            const newData = { url: 'http://ur.l/' }
            await browser.bookmarks.update(bookmark1.id, newData)
            await account.sync() // update on server
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
                          new Bookmark({
                            title: (ACCOUNT_DATA.type === 'karakeep') ? bookmark1.title : bookmark2.title,
                            url: bookmark2.url
                          })
                        ]
                      }),
                      new Bookmark({
                        title: (ACCOUNT_DATA.type === 'nextcloud-bookmarks') ? bookmark2.title : bookmark1.title,
                        url: newData.url
                      }),
                    ]
                  })
                ]
              }),
              false
            )
          })
          it('should update the server on local removals', async function() {
            if (ACCOUNT_DATA.noCache) {
              return this.skip()
            }

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

            await browser.bookmarks.remove(bookmark.id)
            await account.sync() // update on server
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
                        children: []
                      })
                    ]
                  })
                ]
              }),
              false
            )
          })
          it('should update the server on local removals and recreations', async function() {
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

            await browser.bookmarks.remove(bookmark.id)
            await account.sync() // update on server
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
                        children: []
                      })
                    ]
                  })
                ]
              }),
              false
            )

            const bookmark2 = await browser.bookmarks.create({
              title: 'url',
              url: 'http://ur.l/',
              parentId: barFolder.id
            })

            await account.sync() // update on server
            expect(account.getData().error).to.not.be.ok

            const tree2 = await getAllBookmarks(account)
            expectTreeEqual(
              tree2,
              new Folder({
                title: tree2.title,
                children: [
                  new Folder({
                    title: 'foo',
                    children: [
                      new Folder({
                        title: 'bar',
                        children: [
                          new Bookmark({
                            url: bookmark2.url,
                            title: bookmark2.title
                          })
                        ]
                      })
                    ]
                  })
                ]
              }),
              false
            )
          })
          it('should update the server on local folder moves', async function() {
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

            await browser.bookmarks.move(barFolder.id, { parentId: localRoot })
            await account.sync() // update on server
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
                      new Bookmark({ title: 'test', url: 'http://ureff.l/' })
                    ]
                  }),
                  new Folder({
                    title: 'bar',
                    children: [
                      new Bookmark({ title: 'url', url: 'http://ur.l/' })
                    ]
                  })
                ]
              }),
              false
            )
          })
          it('should create server bookmarks locally', async function() {
            const adapter = account.server
            const serverTree = await getAllBookmarks(account)
            let fooFolderId, barFolderId, serverMark
            await withSyncConnection(account, async() => {
              fooFolderId = await adapter.createFolder(new Folder({ parentId: serverTree.id, title: 'foo' }))
              barFolderId = await adapter.createFolder(new Folder({ parentId: fooFolderId, title: 'bar' }))
              serverMark = {
                title: 'url',
                url: 'http://ur.l/',
                parentId: barFolderId
              }

              await adapter.createBookmark(
                new Bookmark(serverMark)
              )
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
                          new Bookmark({
                            title: serverMark.title,
                            url: serverMark.url
                          })
                        ]
                      })
                    ]
                  })
                ]
              }),
              false
            )
          })
          it('should create empty server folders locally', async function() {
            const adapter = account.server
            const serverTree = await getAllBookmarks(account)
            await withSyncConnection(account, async() => {
              const fooFolderId = await adapter.createFolder(new Folder({ parentId: serverTree.id, title: 'foo' }))
              await adapter.createFolder(new Folder({ parentId: fooFolderId, title: 'bar' }))
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
                        children: []
                      })
                    ]
                  })
                ]
              }),
              false
            )
          })
          it('should update local bookmarks on server changes', async function() {
            if (ACCOUNT_DATA.noCache) {
              return this.skip()
            }
            const adapter = account.server

            const serverTree = await getAllBookmarks(account)
            let fooFolderId, barFolderId, serverMarkId, serverMark
            await withSyncConnection(account, async() => {
              fooFolderId = await adapter.createFolder(new Folder({ parentId: serverTree.id, title: 'foo' }))
              barFolderId = await adapter.createFolder(new Folder({ parentId: fooFolderId, title: 'bar' }))
              serverMark = {
                title: 'url',
                url: 'http://ur.l/',
                parentId: barFolderId
              }

              serverMarkId = await adapter.createBookmark(
                new Bookmark(serverMark)
              )
            })

            await account.sync() // propage creation
            expect(account.getData().error).to.not.be.ok

            const newServerMark = {
              ...serverMark,
              title: 'blah',
              id: serverMarkId
            }
            await withSyncConnection(account, async() => {
              await adapter.updateBookmark(new Bookmark(newServerMark))
            })

            await account.sync() // propage update
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
                          new Bookmark({
                            title: newServerMark.title,
                            url: newServerMark.url
                          })
                        ]
                      })
                    ]
                  })
                ]
              }),
              false
            )
          })
          it('should update local bookmarks on server removals', async function() {
            if (ACCOUNT_DATA.noCache) {
              return this.skip()
            }
            const adapter = account.server

            const serverTree = await getAllBookmarks(account)
            if (adapter.onSyncStart) await adapter.onSyncStart()
            const fooFolderId = await adapter.createFolder(new Folder({ parentId: serverTree.id, title: 'foo' }))
            const barFolderId = await adapter.createFolder(new Folder({ parentId: fooFolderId, title: 'bar' }))
            const serverMark = {
              title: 'url',
              url: 'http://ur.l/',
              parentId: barFolderId
            }

            const serverMarkId = await adapter.createBookmark(
              new Bookmark(serverMark)
            )
            if (adapter.onSyncComplete) await adapter.onSyncComplete()

            await account.sync() // propage creation
            expect(account.getData().error).to.not.be.ok

            await withSyncConnection(account, async() => {
              await adapter.removeBookmark({ ...serverMark, id: serverMarkId })
            })

            await account.sync() // propage update
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
                        children: []
                      })
                    ]
                  })
                ]
              }),
              false
            )
          })
          it('should not delete additions while sync is running', async function() {
            const localRoot = account.getData().localRoot
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

            const syncPromise = account.sync() // propagate to server
            await new Promise(resolve => setTimeout(resolve, 1000))
            await browser.bookmarks.create({
              title: 'url2',
              url: 'http://secondur.l/',
              parentId: fooFolder.id
            })
            await syncPromise

            await account.sync() // update on server
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
                        children: [new Bookmark({
                          title: 'url',
                          url: 'http://ur.l/',
                        })]
                      }),
                      new Bookmark({
                        title: 'url2',
                        url: 'http://secondur.l/',
                      }),
                    ]
                  }),
                ]
              }),
              false
            )
          })
          it('should be able to handle duplicates', async function() {
            const localRoot = account.getData().localRoot
            const bookmarkData = {
              title: 'url',
              url: 'http://ur.l/'
            }
            const fooFolder = await browser.bookmarks.create({
              title: 'foo',
              parentId: localRoot
            })
            await browser.bookmarks.create({
              ...bookmarkData,
              parentId: fooFolder.id
            })
            const barFolder = await browser.bookmarks.create({
              title: 'bar',
              parentId: fooFolder.id
            })
            await browser.bookmarks.create({
              ...bookmarkData,
              parentId: barFolder.id
            })
            await account.sync() // propagate to server
            expect(account.getData().error).to.not.be.ok

            await browser.bookmarks.move(barFolder.id, { parentId: localRoot })
            await account.sync() // update on server
            expect(account.getData().error).to.not.be.ok

            const tree = await getAllBookmarks(account)
            expectTreeEqual(
              tree,
              new Folder({
                title: tree.title,
                children: [
                  new Folder({
                    title: 'foo',
                    children: [new Bookmark(bookmarkData)]
                  }),
                  new Folder({
                    title: 'bar',
                    children: [new Bookmark(bookmarkData)]
                  })
                ]
              }),
              false,
              Boolean(account.server.orderFolder)
            )
          })
          it('should deduplicate unnormalized URLs', async function() {
            const adapter = account.server

            // create bookmark on server
            const serverTree = await getAllBookmarks(account)
            if (adapter.onSyncStart) await adapter.onSyncStart()
            const fooFolderId = await adapter.createFolder(new Folder({
              parentId: serverTree.id,
              title: 'foo',
              location: ItemLocation.SERVER
            }))
            const serverMark1 = {
              title: 'url',
              url: 'http://ur.l/foo/bar?a=b&foo=b%C3%A1r+foo',
              location: ItemLocation.SERVER
            }
            const serverMark2 = {
              title: 'url2',
              url: 'http://ur2.l/foo/bar?a=b&foo=b%C3%A1r+foo',
              location: ItemLocation.SERVER
            }
            await adapter.createBookmark(
              new Bookmark({ ...serverMark1, parentId: fooFolderId })
            )
            await adapter.createBookmark(
              new Bookmark({ ...serverMark2, parentId: fooFolderId })
            )
            if (adapter.onSyncComplete) await adapter.onSyncComplete()

            // create bookmark locally
            const localRoot = account.getData().localRoot
            const localMark1 = {
              title: 'url',
              url: 'http://ur.l/foo/bar?a=b&foo=bár+foo'
            }
            const localMark2 = {
              title: 'url2',
              url: 'http://ur2.l/foo/bar?a=b&foo=bár+foo'
            }
            const fooFolder = await browser.bookmarks.create({
              title: 'foo',
              parentId: localRoot
            })
            await browser.bookmarks.create({
              ...localMark1,
              parentId: fooFolder.id
            })
            await browser.bookmarks.create({
              ...localMark2,
              parentId: fooFolder.id
            })

            await account.sync() // propagate to server
            expect(account.getData().error).to.not.be.ok

            // Sync again, so client can deduplicate
            // necessary if using bookmarks < v0.12 or WebDAV
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
                      new Bookmark(serverMark1),
                      new Bookmark(serverMark2)
                    ]
                  })
                ]
              }),
              false,
              Boolean(account.server.orderFolder)
            )
          })
          it('should deduplicate unnormalized URLs without getting stuck', async function() {
            if (ACCOUNT_DATA.type === 'nextcloud-bookmarks' && (APP_VERSION !== 'stable' && APP_VERSION !== 'master' && APP_VERSION !== 'stable3')) {
              this.skip()
            }

            // create bookmark locally
            const localRoot = account.getData().localRoot
            const localMark1 = {
              title: 'url',
              url: 'http://nextcloud.com/'
            }
            const localMark2 = {
              title: 'url2',
              url: 'https://nextcloud.com'
            }
            const fooFolder = await browser.bookmarks.create({
              title: 'foo',
              parentId: localRoot
            })
            await browser.bookmarks.create({
              ...localMark1,
              parentId: fooFolder.id
            })
            await browser.bookmarks.create({
              ...localMark2,
              parentId: fooFolder.id
            })

            await account.sync() // propagate to server
            expect(account.getData().error).to.not.be.ok

            expect(account.getData().error).to.not.be.ok

            // Sync again, so client can deduplicate
            // necessary if using bookmarks < v0.12 or WebDAV
            await account.sync()
            expect(account.getData().error).to.not.be.ok

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
                      new Bookmark(localMark1),
                      new Bookmark(localMark2)
                    ]
                  })
                ]
              }),
              false,
              Boolean(account.server.orderFolder)
            )
          })
          it('should not fail when moving both folders and contents', async function() {
            if (ACCOUNT_DATA.noCache) {
              return this.skip()
            }

            const localRoot = account.getData().localRoot
            const fooFolder = await browser.bookmarks.create({
              title: 'foo',
              parentId: localRoot
            })
            const bookmark1 = await browser.bookmarks.create({
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

            await browser.bookmarks.move(barFolder.id, { parentId: localRoot })
            await browser.bookmarks.move(fooFolder.id, {
              parentId: barFolder.id
            })
            await browser.bookmarks.move(bookmark1.id, {
              parentId: barFolder.id
            })
            await account.sync() // update on server
            expect(account.getData().error).to.not.be.ok

            const tree = await getAllBookmarks(account)
            expectTreeEqual(
              tree,
              new Folder({
                title: tree.title,
                children: [
                  new Folder({
                    title: 'bar',
                    children: [
                      new Bookmark({ title: 'url', url: 'http://ur.l/' }),
                      new Folder({
                        title: 'foo',
                        children: [],
                      }),
                      new Bookmark({ title: 'test', url: 'http://ureff.l/' }),
                    ]
                  })
                ]
              }),
              false,
              Boolean(account.server.orderFolder)
            )
          })
          it('should not fail when both moving folders and deleting their contents', async function() {
            if (ACCOUNT_DATA.noCache) {
              return this.skip()
            }

            const localRoot = account.getData().localRoot
            const fooFolder = await browser.bookmarks.create({
              title: 'foo',
              parentId: localRoot
            })
            const bookmark1 = await browser.bookmarks.create({
              title: 'test',
              url: 'http://ureff.l/',
              parentId: fooFolder.id
            })
            const bookmark2 = await browser.bookmarks.create({
              title: 'url',
              url: 'http://uawdgr.l/',
              parentId: fooFolder.id
            })
            const barFolder = await browser.bookmarks.create({
              title: 'bar',
              parentId: fooFolder.id
            })
            const bookmark3 = await browser.bookmarks.create({
              title: 'url',
              url: 'http://urzur.l/',
              parentId: barFolder.id
            })
            const bookmark4 = await browser.bookmarks.create({
              title: 'url',
              url: 'http://uadgr.l/',
              parentId: barFolder.id
            })
            await account.sync() // propagate to server
            expect(account.getData().error).to.not.be.ok

            await browser.bookmarks.move(barFolder.id, { parentId: localRoot })
            await browser.bookmarks.move(fooFolder.id, {
              parentId: barFolder.id
            })
            await browser.bookmarks.remove(bookmark3.id)
            await account.sync() // update on server
            expect(account.getData().error).to.not.be.ok

            const tree = await getAllBookmarks(account)
            expectTreeEqual(
              tree,
              new Folder({
                title: tree.title,
                children: [
                  new Folder({
                    title: 'bar',
                    children: [
                      new Bookmark(bookmark4),
                      new Folder({
                        title: 'foo',
                        children: [
                          new Bookmark(bookmark1),
                          new Bookmark(bookmark2)
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
          it('should handle strange characters well', async function() {
            const localRoot = account.getData().localRoot
            const fooFolder = await browser.bookmarks.create({
              title: 'foo!"§$%&/()=?"',
              parentId: localRoot
            })
            const barFolder = await browser.bookmarks.create({
              title: "bar=?*'Ä_:-^;<script>",
              parentId: fooFolder.id
            })
            const bookmark = await browser.bookmarks.create({
              title: 'url|!"=)/§_:;Ä\'*ü"',
              url: 'http://ur.l/?a&b=<script>',
              parentId: barFolder.id
            })
            await account.sync()
            expect(account.getData().error).to.not.be.ok

            await account.sync()
            expect(account.getData().error).to.not.be.ok

            const tree = await getAllBookmarks(account)
            expectTreeEqual(
              tree,
              new Folder({
                title: tree.title,
                children: [
                  new Folder({
                    title: 'foo!"§$%&/()=?"',
                    children: [
                      new Folder({
                        title: "bar=?*'Ä_:-^;<script>",
                        children: [
                          new Bookmark({
                            title: 'url|!"=)/§_:;Ä\'*ü"',
                            url: bookmark.url
                          })
                        ]
                      })
                    ]
                  })
                ]
              }),
              false
            )
          })
          it('should be able to delete a server folder', async function() {
            if (ACCOUNT_DATA.noCache) {
              return this.skip()
            }

            const localRoot = account.getData().localRoot
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
            await account.sync()
            expect(account.getData().error).to.not.be.ok

            await browser.bookmarks.removeTree(fooFolder.id)

            await account.sync()
            expect(account.getData().error).to.not.be.ok

            const tree = await getAllBookmarks(account)
            expectTreeEqual(
              tree,
              new Folder({
                title: tree.title,
                children: []
              }),
              false
            )
          })
          it('should be able to delete a local folder', async function() {
            if (ACCOUNT_DATA.noCache) {
              return this.skip()
            }
            const adapter = account.server

            const localRoot = account.getData().localRoot
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
            await account.sync()
            expect(account.getData().error).to.not.be.ok

            let tree = await getAllBookmarks(account)
            await withSyncConnection(account, async() => {
              await adapter.removeFolder({ id: tree.children[0].id })
            })

            await account.sync()
            expect(account.getData().error).to.not.be.ok

            tree = await getAllBookmarks(account)
            expectTreeEqual(
              tree,
              new Folder({
                title: tree.title,
                children: []
              }),
              false
            )
          })
          it('should be ok if both server and local bookmark are removed', async function() {
            const adapter = account.server
            let serverTree = await getAllBookmarks(account)
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

            await account.sync() // propagate creation
            expect(account.getData().error).to.not.be.ok

            await withSyncConnection(account, async() => {
              await adapter.removeBookmark({ ...serverMark, id: serverMarkId })
            })
            await account.sync() // propagate update

            expect(account.getData().error).to.not.be.ok
            const localTree = await account.localTree.getBookmarksTree(true)

            serverTree = await getAllBookmarks(account)

            // Root must also be equal in the assertion
            localTree.title = serverTree.title

            expectTreeEqual(localTree, serverTree)
          })
          it('should ignore duplicates in the same folder', async function() {
            if (ACCOUNT_DATA.type !== 'nextcloud-bookmarks') {
              return this.skip()
            }
            const localRoot = account.getData().localRoot

            const barFolder = await browser.bookmarks.create({
              title: 'bar',
              parentId: localRoot
            })
            await browser.bookmarks.create({
              title: 'url',
              url: 'http://ur.l/',
              parentId: barFolder.id
            })
            await browser.bookmarks.create({
              title: 'url',
              url: 'http://ur.l/',
              parentId: barFolder.id
            })
            await account.sync() // propagate to server
            expect(account.getData().error).to.not.be.ok

            const tree = await getAllBookmarks(account)
            expectTreeEqual(
              tree,
              new Folder({
                title: tree.title,
                children: [
                  new Folder({
                    title: 'bar',
                    children: [
                      new Bookmark({ title: 'url', url: 'http://ur.l/' })
                    ]
                  })
                ]
              }),
              false
            )

            const localTree = await account.localTree.getBookmarksTree(true)
            expectTreeEqual(
              localTree,
              new Folder({
                title: localTree.title,
                children: [
                  new Folder({
                    title: 'bar',
                    children: [
                      new Bookmark({ title: 'url', url: 'http://ur.l/' }),
                      new Bookmark({ title: 'url', url: 'http://ur.l/' })
                    ]
                  })
                ]
              }),
              false
            )
          })
          it('should move items successfully even into new folders', async function() {
            const localRoot = account.getData().localRoot

            const barFolder = await browser.bookmarks.create({
              title: 'bar',
              parentId: localRoot
            })
            const fooFolder = await browser.bookmarks.create({
              title: 'foo',
              parentId: localRoot
            })
            const bookmark1 = await browser.bookmarks.create({
              title: 'url',
              url: 'http://ur.l/',
              parentId: barFolder.id
            })
            await account.sync() // propagate to server
            expect(account.getData().error).to.not.be.ok

            const subFolder = await browser.bookmarks.create({
              title: 'sub',
              parentId: fooFolder.id
            })
            await browser.bookmarks.move(bookmark1.id, { parentId: subFolder.id })

            await account.sync() // propagate to server
            expect(account.getData().error).to.not.be.ok

            const tree = await getAllBookmarks(account)
            expectTreeEqual(
              tree,
              new Folder({
                title: tree.title,
                children: [
                  new Folder({
                    title: 'bar',
                    children: []
                  }),
                  new Folder({
                    title: 'foo',
                    children: [
                      new Folder({
                        title: 'sub',
                        children: [
                          new Bookmark({ title: 'url', url: 'http://ur.l/' })
                        ]
                      })
                    ]
                  })
                ]
              }),
              false,
              Boolean(account.server.orderFolder)
            )

            const localTree = await account.localTree.getBookmarksTree(true)
            expectTreeEqual(
              localTree,
              new Folder({
                title: localTree.title,
                children: [
                  new Folder({
                    title: 'bar',
                    children: []
                  }),
                  new Folder({
                    title: 'foo',
                    children: [
                      new Folder({
                        title: 'sub',
                        children: [
                          new Bookmark({ title: 'url', url: 'http://ur.l/' })
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
          it('should move items successfully when mixing creation and moving (1)', async function() {
            const localRoot = account.getData().localRoot

            const barFolder = await browser.bookmarks.create({
              title: 'bar',
              parentId: localRoot
            })
            const fooFolder = await browser.bookmarks.create({
              title: 'foo',
              parentId: localRoot
            })
            await browser.bookmarks.create({
              title: 'url',
              url: 'http://ur.l/',
              parentId: barFolder.id
            })
            await account.sync() // propagate to server
            expect(account.getData().error).to.not.be.ok

            const topFolder = await browser.bookmarks.create({
              title: 'top',
              parentId: localRoot
            })
            const subFolder = await browser.bookmarks.create({
              title: 'sub',
              parentId: topFolder.id
            })
            await browser.bookmarks.move(fooFolder.id, { parentId: subFolder.id })
            await browser.bookmarks.move(barFolder.id, { parentId: fooFolder.id })

            await account.sync() // propagate to server
            expect(account.getData().error).to.not.be.ok

            const tree = await getAllBookmarks(account)
            expectTreeEqual(
              tree,
              new Folder({
                title: tree.title,
                children: [
                  new Folder({
                    title: 'top',
                    children: [
                      new Folder({
                        title: 'sub',
                        children: [
                          new Folder({
                            title: 'foo',
                            children: [
                              new Folder({
                                title: 'bar',
                                children: [
                                  new Bookmark({
                                    title: 'url',
                                    url: 'http://ur.l/'
                                  })
                                ]
                              })
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

            const localTree = await account.localTree.getBookmarksTree(true)
            expectTreeEqual(
              localTree,
              new Folder({
                title: localTree.title,
                children: [
                  new Folder({
                    title: 'top',
                    children: [
                      new Folder({
                        title: 'sub',
                        children: [
                          new Folder({
                            title: 'foo',
                            children: [
                              new Folder({
                                title: 'bar',
                                children: [
                                  new Bookmark({
                                    title: 'url',
                                    url: 'http://ur.l/'
                                  })
                                ]
                              })
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
          it('should move items successfully when mixing creation and moving (2)', async function() {
            const localRoot = account.getData().localRoot

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
              parentId: cFolder.id
            })
            await browser.bookmarks.create({
              title: 'url',
              url: 'http://ur.l/',
              parentId: dFolder.id
            })
            await account.sync() // propagate to server
            expect(account.getData().error).to.not.be.ok

            const eFolder = await browser.bookmarks.create({
              title: 'e',
              parentId: localRoot
            })
            await browser.bookmarks.move(bFolder.id, { parentId: eFolder.id })
            const fFolder = await browser.bookmarks.create({
              title: 'f',
              parentId: bFolder.id
            })
            await browser.bookmarks.move(cFolder.id, { parentId: fFolder.id })

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
                    children: []
                  }),
                  new Folder({
                    title: 'e',
                    children: [
                      new Folder({
                        title: 'b',
                        children: [
                          new Folder({
                            title: 'f',
                            children: [
                              new Folder({
                                title: 'c',
                                children: [
                                  new Folder({
                                    title: 'd',
                                    children: [
                                      new Bookmark({
                                        title: 'url',
                                        url: 'http://ur.l/'
                                      })
                                    ]
                                  })
                                ]
                              })
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

            const localTree = await account.localTree.getBookmarksTree(true)
            expectTreeEqual(
              localTree,
              new Folder({
                title: localTree.title,
                children: [
                  new Folder({
                    title: 'a',
                    children: []
                  }),
                  new Folder({
                    title: 'e',
                    children: [
                      new Folder({
                        title: 'b',
                        children: [
                          new Folder({
                            title: 'f',
                            children: [
                              new Folder({
                                title: 'c',
                                children: [
                                  new Folder({
                                    title: 'd',
                                    children: [
                                      new Bookmark({
                                        title: 'url',
                                        url: 'http://ur.l/'
                                      })
                                    ]
                                  })
                                ]
                              })
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
          it('should move items without creating a folder loop', async function() {
            if (APP_VERSION !== 'stable' && APP_VERSION !== 'master') {
              this.skip()
            }
            const localRoot = account.getData().localRoot

            const aFolder = await browser.bookmarks.create({
              title: 'a',
              parentId: localRoot
            })
            const bFolder = await browser.bookmarks.create({
              title: 'b',
              parentId: localRoot
            })
            await browser.bookmarks.create({
              title: 'url',
              url: 'http://ur.l/',
              parentId: bFolder.id
            })
            await account.sync() // propagate to server
            expect(account.getData().error).to.not.be.ok

            await account.sync() // sync to server again for order to kick in
            expect(account.getData().error).to.not.be.ok

            // move b into a in client
            await browser.bookmarks.move(bFolder.id, { parentId: aFolder.id })

            // move a into b on server
            await withSyncConnection(account, async() => {
              const initialTree = await account.server.getBookmarksTree(true)
              const aFolder = initialTree.children[0]
              const bFolder = initialTree.children[1]
              aFolder.parentId = bFolder.id
              await account.server.updateFolder(aFolder)
            })

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
                          new Bookmark({
                            title: 'url',
                            url: 'http://ur.l/',
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

            const localTree = await account.localTree.getBookmarksTree(true)
            localTree.title = tree.title
            expectTreeEqual(
              localTree,
              tree,
              false,
              Boolean(account.server.orderFolder)
            )
          })
          it('should move items without confusing folders', async function() {
            const localRoot = account.getData().localRoot

            const aFolder = await browser.bookmarks.create({
              title: 'a',
              parentId: localRoot
            })
            const bFolder = await browser.bookmarks.create({
              title: 'b',
              parentId: localRoot
            })
            const dFolder = await browser.bookmarks.create({
              title: 'd',
              parentId: localRoot
            })
            const cFolder1 = await browser.bookmarks.create({
              title: 'c',
              parentId: aFolder.id
            })
            await browser.bookmarks.create({
              title: 'url',
              url: 'http://ur.l/',
              parentId: cFolder1.id
            })
            const cFolder2 = await browser.bookmarks.create({
              title: 'c',
              parentId: bFolder.id
            })
            await browser.bookmarks.create({
              title: 'test',
              url: 'http://urrr.l/',
              parentId: cFolder2.id
            })

            await account.sync() // propagate to server
            expect(account.getData().error).to.not.be.ok

            await account.sync() // make sure order is propagated
            expect(account.getData().error).to.not.be.ok

            await account.init()

            // move b into a in client
            await browser.bookmarks.move(cFolder1.id, { parentId: localRoot })
            await browser.bookmarks.move(cFolder2.id, { parentId: dFolder.id })

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
                    children: []
                  }),
                  new Folder({
                    title: 'b',
                    children: []
                  }),
                  new Folder({
                    title: 'd',
                    children: [
                      new Folder({
                        title: 'c',
                        children: [
                          new Bookmark({
                            title: 'test',
                            url: 'http://urrr.l/',
                          })
                        ]
                      })
                    ]
                  }),
                  new Folder({
                    title: 'c',
                    children: [
                      new Bookmark({
                        title: 'url',
                        url: 'http://ur.l/',
                      })
                    ]
                  }),
                ]
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
          it('should move items without confusing folders (2)', async function() {
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

            await account.init() // Remove the cache

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
          it('should integrate existing items from both sides', async function() {
            const localRoot = account.getData().localRoot

            const adapter = account.server

            const aFolder = await browser.bookmarks.create({
              title: 'a',
              parentId: localRoot
            })
            const bFolder = await browser.bookmarks.create({
              title: 'b',
              parentId: aFolder.id
            })
            const bookmark1 = await browser.bookmarks.create({
              title: 'url',
              url: 'http://ur.l/',
              parentId: aFolder.id
            })
            const bookmark2 = await browser.bookmarks.create({
              title: 'url2',
              url: 'http://ur.l/dalfk',
              parentId: bFolder.id
            })

            let aFolderId, bookmark1Id, bFolderId, bookmark2Id
            await withSyncConnection(account, async() => {
              aFolderId = await adapter.createFolder(
                new Folder({
                  parentId: (await adapter.getBookmarksTree()).id,
                  title: 'a'
                })
              )
              bookmark1Id = await adapter.createBookmark(
                new Bookmark({
                  title: 'url',
                  url: 'http://ur.l',
                  parentId: aFolderId
                })
              )

              bFolderId = await adapter.createFolder(new Folder({ parentId: aFolderId, title: 'b' }))
              bookmark2Id = await adapter.createBookmark(
                new Bookmark({
                  title: 'url2',
                  url: 'http://ur.l/dalfk',
                  parentId: bFolderId
                })
              )
            })

            await account.sync() // propagate to server
            expect(account.getData().error).to.not.be.ok

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
                          new Bookmark({
                            title: 'url2',
                            url: 'http://ur.l/dalfk'
                          })
                        ]
                      }),
                      new Bookmark({ title: 'url', url: 'http://ur.l/' }),
                    ]
                  })
                ]
              }),
              false,
              false /* checkOrder */
            )

            expect(tree.findBookmark(bookmark1Id)).to.be.ok
            expect(tree.findBookmark(bookmark2Id)).to.be.ok

            const localTree = await account.localTree.getBookmarksTree(true)
            expectTreeEqual(
              localTree,
              new Folder({
                title: localTree.title,
                children: [
                  new Folder({
                    title: 'a',
                    children: [
                      new Folder({
                        title: 'b',
                        children: [
                          new Bookmark({
                            title: 'url2',
                            url: 'http://ur.l/dalfk'
                          })
                        ]
                      }),
                      new Bookmark({ title: 'url', url: 'http://ur.l/' }),
                    ]
                  })
                ]
              }),
              false,
              false /* checkOrder */
            )

            expect(localTree.findBookmark(bookmark1.id)).to.be.ok
            expect(localTree.findBookmark(bookmark2.id)).to.be.ok
          })
          it('should error when deleting too much local data (failsafe)', async function() {
            if (ACCOUNT_DATA.noCache) {
              this.skip()
            }

            const localRoot = account.getData().localRoot
            const fooFolder = await browser.bookmarks.create({
              title: 'foo',
              parentId: localRoot
            })
            const barFolder = await browser.bookmarks.create({
              title: 'bar',
              parentId: fooFolder.id
            })
            // We need more than 5 bookmarks to be above the negligibility threshold
            await Promise.all([
              'http://ur.l/',
              'http://ur.ll/',
              'http://ur2.l/',
              'http://ur3.l/',
              'http://ur4.l/',
              'http://ur5.l/',
              'http://ur6.l/',
              'http://ur7.l/',
              'http://ur8.l/',
              'http://ur9.l/',
              'http://ur10.l/',
            ].map(url => browser.bookmarks.create({
              title: 'url',
              url,
              parentId: barFolder.id
            })))
            await account.sync()
            expect(account.getData().error).to.not.be.ok

            // Remove everything on the server
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

            await account.sync()
            expect(account.getData().error).to.be.ok // should have errored
            expect(account.getData().error).to.include((new ClientsideDeletionFailsafeError()).code)
          })
          it('should error when adding too much local data (failsafe)', async function() {
            if (ACCOUNT_DATA.noCache) {
              this.skip()
            }

            const localRoot = account.getData().localRoot
            const fooFolder = await browser.bookmarks.create({
              title: 'foo',
              parentId: localRoot
            })
            const barFolder = await browser.bookmarks.create({
              title: 'bar',
              parentId: fooFolder.id
            })
            // Create 6 bookmarks to be above the negligibility threshold
            await Promise.all([
              'http://ur.1l/',
              'http://ur2.l/',
              'http://ur3.l/',
              'http://ur4.l/',
              'http://ur5.l/',
              'http://ur6.l/'
            ].map(url => browser.bookmarks.create({
              title: 'url',
              url,
              parentId: barFolder.id
            })))
            await account.sync()
            expect(account.getData().error).to.not.be.ok

            // Simulate an extreme increase of bookmarks
            const tree = await getAllBookmarks(account)
            await withSyncConnection(account, async() => {
              await Promise.all([
                'http://ur.1l/',
                'http://ur2.l/',
                'http://ur3.l/',
                'http://ur4.l/',
                'http://ur5.l/',
                'http://ur6.l/',
                'http://ur7.l/',
                'http://ur8.l/',
                'http://ur9.l/',
                'http://ur10.l/',
                'http://ur.11l/',
                'http://ur12.l/',
                'http://ur13.l/',
                'http://ur14.l/',
                'http://ur15.l/',
                'http://ur16.l/',
                'http://ur17.l/',
                'http://ur18.l/',
                'http://ur19.l/',
                'http://ur20.l/',
              ].map(url => account.server.createBookmark(new Bookmark({
                title: 'url',
                url,
                parentId: tree.id
              }))))
            })

            await account.sync()
            expect(account.getData().error).to.be.ok // should have errored
            expect(account.getData().error).to.include((new ClientsideAdditionFailsafeError()).code)
          })
          it('should error when deleting too much remote data (failsafe)', async function() {
            if (ACCOUNT_DATA.noCache) {
              this.skip()
            }

            const localRoot = account.getData().localRoot
            const fooFolder = await browser.bookmarks.create({
              title: 'foo',
              parentId: localRoot
            })
            const barFolder = await browser.bookmarks.create({
              title: 'bar',
              parentId: fooFolder.id
            })
            // We need more than 5 bookmarks to be above the negligibility threshold
            await Promise.all([
              'http://ur.l/',
              'http://ur.ll/',
              'http://ur2.l/',
              'http://ur3.l/',
              'http://ur4.l/',
              'http://ur5.l/',
              'http://ur6.l/',
              'http://ur7.l/',
              'http://ur8.l/',
              'http://ur9.l/',
              'http://ur10.l/',
            ].map(url => browser.bookmarks.create({
              title: 'url',
              url,
              parentId: barFolder.id
            })))
            await account.sync()
            expect(account.getData().error).to.not.be.ok

            // Remove everything
            await browser.bookmarks.removeTree(barFolder.id)

            await account.sync()
            expect(account.getData().error).to.be.ok // should have errored
            expect(account.getData().error).to.include((new ServersideDeletionFailsafeError()).code)
          })
          it('should error when adding too much remote data (failsafe)', async function() {
            if (ACCOUNT_DATA.noCache) {
              this.skip()
            }

            const localRoot = account.getData().localRoot
            const fooFolder = await browser.bookmarks.create({
              title: 'foo',
              parentId: localRoot
            })
            const barFolder = await browser.bookmarks.create({
              title: 'bar',
              parentId: fooFolder.id
            })
            // Create 6 bookmarks to be above the negligibility threshold
            await Promise.all([
              'http://ur1.ll/',
              'http://ur2.ll/',
              'http://ur3.ll/',
              'http://ur4.ll/',
              'http://ur5.ll/',
              'http://ur6.ll/'
            ].map(url => browser.bookmarks.create({
              title: 'url',
              url,
              parentId: barFolder.id
            })))
            await account.sync()
            expect(account.getData().error).to.not.be.ok

            // Simulate an extreme increase of bookmarks
            // More than 20 bookmarks need to be added at once to trigger the failsafe
            await Promise.all([
              'http://ur1.l/',
              'http://ur2.l/',
              'http://ur3.l/',
              'http://ur4.l/',
              'http://ur5.l/',
              'http://ur6.l/',
              'http://ur7.l/',
              'http://ur8.l/',
              'http://ur9.l/',
              'http://ur10.l/',
              'http://ur11.l/',
              'http://ur12.l/',
              'http://ur13.l/',
              'http://ur14.l/',
              'http://ur15.l/',
              'http://ur16.l/',
              'http://ur17.l/',
              'http://ur18.l/',
              'http://ur19.l/',
              'http://ur20.l/',
              'http://ur21.l/',
            ].map(url => browser.bookmarks.create({
              title: 'url',
              url,
              parentId: barFolder.id
            })))

            await account.sync()
            expect(account.getData().error).to.be.ok // should have errored
            expect(account.getData().error).to.include((new ServersideAdditionFailsafeError()).code)
          })
          it('should leave alone unaccepted bookmarks entirely', async function() {
            if (!~ACCOUNT_DATA.type.indexOf('nextcloud')) {
              return this.skip()
            }
            const localRoot = account.getData().localRoot

            const barFolder = await browser.bookmarks.create({
              title: 'bar',
              parentId: localRoot
            })
            const fooFolder = await browser.bookmarks.create({
              title: 'foo',
              parentId: barFolder.id
            })
            await browser.bookmarks.create({
              title: 'url',
              url: 'http://ur.l/',
              parentId: barFolder.id
            })
            await browser.bookmarks.create({
              title: 'url2',
              url: 'chrome://extensions/',
              parentId: fooFolder.id
            })
            await account.sync() // propagate to server
            expect(account.getData().error).to.not.be.ok

            await account.sync() // propagate to server -- if we had cached the unacceptables, they'd be deleted now
            expect(account.getData().error).to.not.be.ok

            const tree = await getAllBookmarks(account)
            expectTreeEqual(
              tree,
              new Folder({
                title: tree.title,
                children: [
                  new Folder({
                    title: 'bar',
                    children: [
                      new Bookmark({ title: 'url', url: 'http://ur.l/' }),
                      new Folder({
                        title: 'foo',
                        children: []
                      })
                    ]
                  })
                ]
              }),
              false,
              false
            )

            const localTree = await account.localTree.getBookmarksTree(true)
            expectTreeEqual(
              localTree,
              new Folder({
                title: localTree.title,
                children: [
                  new Folder({
                    title: 'bar',
                    children: [
                      new Bookmark({ title: 'url', url: 'http://ur.l/' }),
                      new Folder({
                        title: 'foo',
                        children: [
                          new Bookmark({
                            title: 'url2',
                            url: 'chrome://extensions/'
                          })
                        ]
                      })
                    ]
                  })
                ]
              }),
              false,
              false
            )
          })
          it('should convert vertical and horizontal separators', async function() {
            if (BROWSER !== 'firefox') {
              this.skip()
              return
            }

            // Remove all nodes except the system nodes:
            const deleteNonSysNodes = async(delNodeId) => {
              let delChildren = await browser.bookmarks.getChildren(delNodeId)
              for (const delChild of delChildren) {
                await deleteNonSysNodes(delChild.id)
              }
              if (!delNodeId.endsWith('_____')) {
                await browser.bookmarks.remove(delNodeId)
              }
            }
            await deleteNonSysNodes('root________')

            await browser.bookmarks.create({
              title: 'url1',
              url: 'http://url1/',
              parentId: 'menu________'
            })
            await browser.bookmarks.create({
              type: 'separator',
              parentId: 'menu________'
            })
            const toolbarNameNormalFolder = await browser.bookmarks.create({
              title: BrowserTree.TITLE_BOOKMARKS_BAR,
              parentId: 'menu________'
            })
            await browser.bookmarks.create({
              title: 'url2',
              url: 'http://url2/',
              parentId: toolbarNameNormalFolder.id
            })
            await browser.bookmarks.create({
              type: 'separator',
              parentId: toolbarNameNormalFolder.id
            })

            await browser.bookmarks.create({
              title: 'url3',
              url: 'http://url3/',
              parentId: 'toolbar_____'
            })
            await browser.bookmarks.create({
              type: 'separator',
              parentId: 'toolbar_____'
            })
            const onToolbarNormalFolder = await browser.bookmarks.create({
              title: 'A Folder',
              parentId: 'toolbar_____'
            })
            await browser.bookmarks.create({
              title: 'url4',
              url: 'http://url4/',
              parentId: onToolbarNormalFolder.id
            })
            await browser.bookmarks.create({
              type: 'separator',
              parentId: onToolbarNormalFolder.id
            })

            let brTree = new BrowserTree('Dummy Storage', 'root________')
            let bmTree = await brTree.getBookmarksTree()

            expectTreeEqual(
              bmTree,
              new Folder({
                title: undefined,
                children: [
                  new Folder({
                    title: 'Bookmarks Menu',
                    children: [
                      new Bookmark({ title: 'url1', url: 'http://url1/' }),
                      new Bookmark({ title: '⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯', url: 'https://separator.floccus.org/?id=242649' }),
                      new Folder({
                        title: 'Bookmarks Bar',
                        children: [
                          new Bookmark({ title: 'url2', url: 'http://url2/' }),
                          new Bookmark({ title: '⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯', url: 'https://separator.floccus.org/?id=591710' }),
                        ]
                      }),
                    ]
                  }),
                  new Folder({
                    title: 'Bookmarks Bar',
                    children: [
                      new Bookmark({ title: 'url3', url: 'http://url3/' }),
                      new Bookmark({ title: '', url: 'https://separator.floccus.org/vertical.html?id=616887' }),
                      new Folder({
                        title: 'A Folder',
                        children: [
                          new Bookmark({ title: 'url4', url: 'http://url4/' }),
                          new Bookmark({ title: '⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯', url: 'https://separator.floccus.org/?id=890296' }),
                        ]
                      }),
                    ]
                  })
                ]
              }),
              true
            )
            await deleteNonSysNodes('root________')
          })
          it('should sync separators', async function() {
            if (ACCOUNT_DATA.noCache) {
              this.skip()
              return
            }
            if (BROWSER !== 'firefox') {
              this.skip()
              return
            }
            if (ACCOUNT_DATA.type === 'linkwarden' || ACCOUNT_DATA.type === 'karakeep') {
              return this.skip()
            }
            const localRoot = account.getData().localRoot
            const barFolder = await browser.bookmarks.create({
              title: 'bar',
              parentId: localRoot
            })
            const fooFolder = await browser.bookmarks.create({
              title: 'foo',
              parentId: barFolder.id
            })
            await browser.bookmarks.create({
              title: 'url',
              url: 'http://ur.l/',
              parentId: fooFolder.id
            })
            await browser.bookmarks.create({
              type: 'separator',
              parentId: fooFolder.id
            })
            await browser.bookmarks.create({
              title: 'url2',
              url: 'http://ur2.l',
              parentId: fooFolder.id
            })
            await browser.bookmarks.create({
              type: 'separator',
              parentId: fooFolder.id
            })

            await account.sync() // propagate to server
            expect(account.getData().error).to.not.be.ok

            let tree = await getAllBookmarks(account)
            let localTree = await account.localTree.getBookmarksTree(true)
            expectTreeEqual(
              localTree,
              new Folder({
                title: localTree.title,
                children: [
                  new Folder({
                    title: 'bar',
                    children: [
                      new Folder({
                        title: 'foo',
                        children: [
                          new Bookmark({ title: 'url', url: 'http://ur.l/' }),
                          new Bookmark({ title: '⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯', url: 'https://separator.floccus.org/?id=467366' }),
                          new Bookmark({ title: 'url2', url: 'http://ur2.l' }),
                          new Bookmark({ title: '⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯', url: 'https://separator.floccus.org/?id=731368' })
                        ]
                      })
                    ]
                  })
                ]
              }),
              false
            )
            expectTreeEqual(
              tree,
              new Folder({
                title: tree.title,
                children: [
                  new Folder({
                    title: 'bar',
                    children: [
                      new Folder({
                        title: 'foo',
                        children: [
                          new Bookmark({ title: 'url', url: 'http://ur.l/' }),
                          new Bookmark({ title: '⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯', url: 'https://separator.floccus.org/?id=467366' }),
                          new Bookmark({ title: 'url2', url: 'http://ur2.l' }),
                          new Bookmark({ title: '⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯', url: 'https://separator.floccus.org/?id=731368' })
                        ]
                      })
                    ]
                  })
                ]
              }),
              false
            )

            console.log('initial sync done')

            await withSyncConnection(account, async() => {
              // move first separator
              await account.server.updateBookmark(new Bookmark({
                ...tree.children[0].children[0].children[1],
                parentId: tree.children[0].id
              }))
            })

            console.log('move done')

            await account.sync() // propagate to browser
            expect(account.getData().error).to.not.be.ok

            localTree = await account.localTree.getBookmarksTree(true)
            expectTreeEqual(
              localTree,
              new Folder({
                title: localTree.title,
                children: [
                  new Folder({
                    title: 'bar',
                    children: [
                      new Folder({
                        title: 'foo',
                        children: [
                          new Bookmark({ title: 'url', url: 'http://ur.l/' }),
                          new Bookmark({ title: 'url2', url: 'http://ur2.l' }),
                          new Bookmark({ title: '⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯', url: 'https://separator.floccus.org/?id=467366' })
                        ]
                      }),
                      new Bookmark({ title: '⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯', url: 'https://separator.floccus.org/?id=379999' })
                    ]
                  })
                ]
              }),
              false
            )
            tree = await getAllBookmarks(account)
            expectTreeEqual(
              tree,
              new Folder({
                title: tree.title,
                children: [
                  new Folder({
                    title: 'bar',
                    children: [
                      new Folder({
                        title: 'foo',
                        children: [
                          new Bookmark({ title: 'url', url: 'http://ur.l/' }),
                          new Bookmark({ title: 'url2', url: 'http://ur2.l' }),
                          new Bookmark({ title: '⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯', url: 'https://separator.floccus.org/?id=731368' })
                        ]
                      }),
                      new Bookmark({ title: '⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯', url: 'https://separator.floccus.org/?id=467366' })
                    ]
                  })
                ]
              }),
              false
            )
          })
          it('should sync separators 2', async function() {
            if (ACCOUNT_DATA.noCache) {
              this.skip()
              return
            }
            if (BROWSER !== 'firefox') {
              this.skip()
              return
            }
            if (ACCOUNT_DATA.type === 'linkwarden' || ACCOUNT_DATA.type === 'karakeep') {
              return this.skip()
            }
            const localRoot = account.getData().localRoot

            const barFolder = await browser.bookmarks.create({
              title: 'bar',
              parentId: localRoot
            })
            const fooFolder = await browser.bookmarks.create({
              title: 'foo',
              parentId: barFolder.id
            })
            await browser.bookmarks.create({
              title: 'url',
              url: 'http://ur.l/',
              parentId: fooFolder.id
            })
            await browser.bookmarks.create({
              type: 'separator',
              parentId: fooFolder.id
            })
            await browser.bookmarks.create({
              title: 'url2',
              url: 'http://ur2.l',
              parentId: fooFolder.id
            })
            await browser.bookmarks.create({
              type: 'separator',
              parentId: fooFolder.id
            })

            await account.sync() // propagate to server
            expect(account.getData().error).to.not.be.ok

            let tree = await getAllBookmarks(account)
            let localTree = await account.localTree.getBookmarksTree(true)
            expectTreeEqual(
              localTree,
              new Folder({
                title: localTree.title,
                children: [
                  new Folder({
                    title: 'bar',
                    children: [
                      new Folder({
                        title: 'foo',
                        children: [
                          new Bookmark({ title: 'url', url: 'http://ur.l/' }),
                          new Bookmark({ title: '⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯', url: 'https://separator.floccus.org/?id=467366' }),
                          new Bookmark({ title: 'url2', url: 'http://ur2.l' }),
                          new Bookmark({ title: '⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯', url: 'https://separator.floccus.org/?id=731368' })
                        ]
                      }),
                    ]
                  }),
                ]
              }),
              false
            )
            expectTreeEqual(
              tree,
              new Folder({
                title: tree.title,
                children: [
                  new Folder({
                    title: 'bar',
                    children: [
                      new Folder({
                        title: 'foo',
                        children: [
                          new Bookmark({ title: 'url', url: 'http://ur.l/' }),
                          new Bookmark({ title: '⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯', url: 'https://separator.floccus.org/?id=467366' }),
                          new Bookmark({ title: 'url2', url: 'http://ur2.l' }),
                          new Bookmark({ title: '⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯', url: 'https://separator.floccus.org/?id=731368' })
                        ]
                      }),
                    ]
                  }),
                ]
              }),
              false
            )

            console.log('initial sync done')

            await withSyncConnection(account, async() => {
              // remove first separator
              await account.server.removeBookmark(tree.children[0].children[0].children[1])
            })
            await account.sync() // propagate to browser
            expect(account.getData().error).to.not.be.ok

            localTree = await account.localTree.getBookmarksTree(true)
            expectTreeEqual(
              localTree,
              new Folder({
                title: localTree.title,
                children: [
                  new Folder({
                    title: 'bar',
                    children: [
                      new Folder({
                        title: 'foo',
                        children: [
                          new Bookmark({ title: 'url', url: 'http://ur.l/' }),
                          new Bookmark({ title: 'url2', url: 'http://ur2.l' }),
                          new Bookmark({ title: '⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯', url: 'https://separator.floccus.org/?id=467366' })
                        ]
                      }),
                    ]
                  }),

                ]
              }),
              false
            )
          })
          it('should sync root folder successfully', async function() {
            const [root] = await browser.bookmarks.getTree()
            await account.setData({ localRoot: root.id, rootPath: '' })
            account = await Account.get(account.id)

            const barFolder = await browser.bookmarks.create({
              title: 'bar',
              parentId: root.children[0].id
            })
            await browser.bookmarks.create({
              title: 'foo',
              parentId: barFolder.id
            })
            await browser.bookmarks.create({
              title: 'url',
              url: 'http://ur.l/',
              parentId: barFolder.id
            })
            await account.sync() // propagate to server
            expect(account.getData().error).to.not.be.ok

            await account.sync() // propagate to server -- if we had cached the unacceptables, they'd be deleted now
            expect(account.getData().error).to.not.be.ok

            const tree = await getAllBookmarks(account)
            const newRoot = await account.localTree.getBookmarksTree()
            tree.title = newRoot.title
            expectTreeEqual(
              tree,
              newRoot,
              false,
              false
            )

            // Switch it back to something harmless, so we don't attempt to clean up the root folder
            await account.setData({ localRoot: barFolder.id })
            account = await Account.get(account.id)
          })
          it('should sync root folder ignoring unsupported folders', async function() {
            const [root] = await browser.bookmarks.getTree()

            await Promise.all(
              root.children.flatMap(child => child.children.map(child => browser.bookmarks.removeTree(child.id)))
            )

            const originalFolderId = account.getData().localRoot
            await account.setData({ localRoot: root.id, rootPath: '' })
            account = await Account.get(account.id)
            const adapter = account.server

            let bookmark
            let serverTree = await getAllBookmarks(account)
            await withSyncConnection(account, async() => {
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
                title: 'url2',
                url: 'http://ur2.l/',
                parentId: barFolderId,
                location: ItemLocation.SERVER
              }
              const id = await adapter.createBookmark(
                new Bookmark(serverMark)
              )
              bookmark = { ...serverMark, id }
            })

            const secondBookmarkFolderTitle = root.children[0].title
            await browser.bookmarks.create({
              title: 'url',
              url: 'http://ur.l/',
              parentId: root.children[0].id
            })

            await account.sync()
            expect(account.getData().error).to.not.be.ok

            serverTree = await getAllBookmarks(account)
            const newRoot = await account.localTree.getBookmarksTree()
            expect(serverTree.children).to.have.lengthOf(newRoot.children.length + 1)

            await withSyncConnection(account, async() => {
              bookmark.parentId = serverTree.children.find(folder => folder.title !== 'foo').id
              const fooFolder = serverTree.children.find(folder => folder.title === 'foo')
              await adapter.updateBookmark(new Bookmark(bookmark))
              // toLowerCase to accommodate chrome (since we normalize the title)
              const secondBookmark = serverTree.children.find(folder => folder.title.toLowerCase() === secondBookmarkFolderTitle.toLowerCase()).children.find(item => item.type === 'bookmark')
              secondBookmark.parentId = fooFolder.id
              await adapter.updateBookmark(secondBookmark)
            })

            await account.sync()
            expect(account.getData().error).to.not.be.ok

            serverTree = await getAllBookmarks(account)
            const localTreeAfterSync = await account.localTree.getBookmarksTree()
            expect(serverTree.children).to.have.lengthOf(localTreeAfterSync.children.length + 1)

            // Switch it back to something harmless, so we don't attempt to clean up the root folder
            await account.setData({ localRoot: originalFolderId })
            account = await Account.get(account.id)
          })
          it('should synchronize ordering', async function() {
            if (ACCOUNT_DATA.noCache) {
              return this.skip()
            }
            if (ACCOUNT_DATA.type === 'linkwarden' || ACCOUNT_DATA.type === 'karakeep') {
              return this.skip()
            }

            const localRoot = account.getData().localRoot
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
            await account.sync()
            expect(account.getData().error).to.not.be.ok

            await browser.bookmarks.move(bookmark1.id, { index: 0 })
            await browser.bookmarks.move(folder1.id, { index: 1 })
            await browser.bookmarks.move(bookmark2.id, { index: 2 })
            await browser.bookmarks.move(folder2.id, { index: 3 })

            await account.sync()
            expect(account.getData().error).to.not.be.ok

            const localTree = await account.localTree.getBookmarksTree(true)
            expectTreeEqual(
              localTree,
              new Folder({
                title: localTree.title,
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
              false,
              true
            )

            const tree = await getAllBookmarks(account)
            expectTreeEqual(
              tree,
              new Folder({
                title: tree.title,
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
              false,
              true
            )
          })
          it('should not be confused by changes while syncing', async function() {
            if (ACCOUNT_DATA.noCache) {
              return this.skip()
            }

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

            const bookmark2 = await browser.bookmarks.create({
              title: 'url2',
              url: 'http://ur2.l/',
              parentId: barFolder.id
            })

            // Make changes while sync is happening
            let bookmark3
            const getBookmarksTree = account.localTree.getBookmarksTree
            account.localTree.getBookmarksTree = async() => {
              const result = await getBookmarksTree.call(account.localTree)
              console.log('CHANGING TREE NOW WHILE SYNCING')
              await browser.bookmarks.remove(bookmark2.id)
              bookmark3 = await browser.bookmarks.create({
                title: 'url3',
                url: 'http://ur3.l/',
                parentId: barFolder.id
              })
              account.localTree.getBookmarksTree = getBookmarksTree
              return result
            }
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
                          new Bookmark({
                            title: bookmark.title,
                            url: bookmark.url
                          }),
                          new Bookmark({
                            title: bookmark2.title,
                            url: bookmark2.url
                          }),
                        ]
                      })
                    ]
                  })
                ]
              }),
              false,
              Boolean(account.server.orderFolder),
            )
            const localTree = await account.localTree.getBookmarksTree(true)
            expectTreeEqual(
              localTree,
              new Folder({
                title: localTree.title,
                children: [
                  new Folder({
                    title: 'foo',
                    children: [
                      new Folder({
                        title: 'bar',
                        children: [
                          new Bookmark({
                            title: bookmark.title,
                            url: bookmark.url
                          }),
                          new Bookmark({
                            title: bookmark3.title,
                            url: bookmark3.url
                          }),
                        ]
                      })
                    ]
                  })
                ]
              }),
              false,
              Boolean(account.server.orderFolder),
            )

            // Sync again to check if bookmark 3 gets picked
            await account.sync()
            expect(account.getData().error).to.not.be.ok

            const tree2 = await getAllBookmarks(account)
            expectTreeEqual(
              tree2,
              new Folder({
                title: tree2.title,
                children: [
                  new Folder({
                    title: 'foo',
                    children: [
                      new Folder({
                        title: 'bar',
                        children: [
                          new Bookmark({
                            title: bookmark.title,
                            url: bookmark.url
                          }),
                          new Bookmark({
                            title: bookmark3.title,
                            url: bookmark3.url
                          }),
                        ]
                      })
                    ]
                  })
                ]
              }),
              false,
              Boolean(account.server.orderFolder)
            )
            const localTree2 = await account.localTree.getBookmarksTree(true)
            localTree2.title = tree2.title
            expectTreeEqual(
              localTree2,
              tree2,
              false,
              Boolean(account.server.orderFolder)
            )
          })
        })
      })
  })
})
