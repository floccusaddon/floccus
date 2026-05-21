/* global IS_BROWSER */
import Account from '../lib/Account'
import { Bookmark, Folder, ItemLocation } from '../lib/Tree'
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

const browser = null

describe('Floccus', function() {
  this.timeout(120000) // no test should run longer than 120s
  this.slow(20000) // 20s is slow

  const {
    ACCOUNTS,
    SEED,
  } = getEnv()
  random.use(seedrandom(SEED))

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
            await clearLocalResource(account)
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

          context('with slave mode', function() {
            it("shouldn't create local bookmarks on the server", async function() {
              await account.setData({ strategy: 'slave' })
              expect(
                (await getAllBookmarks(account)).children
              ).to.have.lengthOf(0)

              const localResource = await account.getResource()
              const localRoot = (await localResource.getBookmarksTree(true)).id
              let fooFolder
              const fooFolderId = await localResource.createFolder(fooFolder = new Folder({title: 'foo', parentId: localRoot}))
              let barFolder
              const barFolderId = await localResource.createFolder(barFolder = new Folder({title: 'bar', parentId: fooFolderId}))
              await localResource.createBookmark(new Bookmark({title: 'url', url: 'http://ur.l/', parentId: barFolderId}))
              await account.sync()
              expect(account.getData().error).to.not.be.ok

              const tree = await getAllBookmarks(account)
              expect(tree.children).to.have.lengthOf(0)
            })
            it("shouldn't update the server on local changes", async function() {
              expect(
                (await getAllBookmarks(account)).children
              ).to.have.lengthOf(0)

              const localResource = await account.getResource()
              const localRoot = (await localResource.getBookmarksTree(true)).id
              let fooFolder
              const fooFolderId = await localResource.createFolder(fooFolder = new Folder({title: 'foo', parentId: localRoot}))
              let barFolder
              const barFolderId = await localResource.createFolder(barFolder = new Folder({title: 'bar', parentId: fooFolderId}))
              let bookmark
              const bookmarkId = await localResource.createBookmark(bookmark = new Bookmark({title: 'url', url: 'http://ur.l/', parentId: barFolderId}))
              await account.sync() // propagate to server
              expect(account.getData().error).to.not.be.ok

              const originalTree = await getAllBookmarks(account)
              await account.setData({ strategy: 'slave' })

              const newData = { title: 'blah' }
              await localResource.updateBookmark(new Bookmark({...bookmark.toJSON(), id: bookmarkId, newData}))
              await account.sync() // update on server
              expect(account.getData().error).to.not.be.ok

              const tree = await getAllBookmarks(account)
              expectTreeEqual(
                tree,
                originalTree,
                false
              )
            })
            it("shouldn't update the server on local removals", async function() {
              expect(
                (await getAllBookmarks(account)).children
              ).to.have.lengthOf(0)

              const localResource = await account.getResource()
              const localRoot = (await localResource.getBookmarksTree(true)).id
              let fooFolder
              const fooFolderId = await localResource.createFolder(fooFolder = new Folder({title: 'foo', parentId: localRoot}))
              let barFolder
              const barFolderId = await localResource.createFolder(barFolder = new Folder({title: 'bar', parentId: fooFolderId}))
              let bookmark
              const bookmarkId = await localResource.createBookmark(bookmark = new Bookmark({title: 'url', url: 'http://ur.l/', parentId: barFolderId}))
              await account.sync() // propagate to server
              expect(account.getData().error).to.not.be.ok

              const originalTree = await getAllBookmarks(account)
              await account.setData({ strategy: 'slave' })

              await localResource.removeBookmark(new Bookmark({...bookmark.toJSON(), id: bookmarkId}))
              await account.sync() // update on server
              expect(account.getData().error).to.not.be.ok

              const tree = await getAllBookmarks(account)
              expectTreeEqual(
                tree,
                originalTree,
                false
              )
            })
            it("shouldn't update the server on local folder moves", async function() {
              expect(
                (await getAllBookmarks(account)).children
              ).to.have.lengthOf(0)

              const localResource = await account.getResource()
              const localRoot = (await localResource.getBookmarksTree(true)).id
              let fooFolder
              const fooFolderId = await localResource.createFolder(fooFolder = new Folder({title: 'foo', parentId: localRoot}))
              await localResource.createBookmark(new Bookmark({title: 'test', url: 'http://ureff.l/', parentId: fooFolderId}))
              let barFolder
              const barFolderId = await localResource.createFolder(barFolder = new Folder({title: 'bar', parentId: fooFolderId}))
              await localResource.createBookmark(new Bookmark({title: 'url', url: 'http://ur.l/', parentId: barFolderId}))
              await account.sync() // propagate to server
              expect(account.getData().error).to.not.be.ok

              const originalTree = await getAllBookmarks(account)
              await account.setData({ strategy: 'slave' })

              await localResource.updateFolder(new Folder({...barFolder.toJSON(), id: barFolderId, parentId: localRoot}))
              await account.sync() // update on server
              expect(account.getData().error).to.not.be.ok

              const tree = await getAllBookmarks(account)
              expectTreeEqual(
                tree,
                originalTree,
                false
              )
            })
            it('should create server bookmarks locally', async function() {
              await account.setData({ strategy: 'slave' })
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
              await adapter.createBookmark(
                new Bookmark(serverMark)
              )
              if (adapter.onSyncComplete) await adapter.onSyncComplete()

              await account.sync()
              expect(account.getData().error).to.not.be.ok

              const tree = await account.localTree.getBookmarksTree(true)
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
            it('should update local bookmarks on server changes', async function() {
              if (ACCOUNT_DATA.noCache) {
                return this.skip()
              }
              await account.setData({ strategy: 'slave' })
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
              await account.setData({ strategy: 'slave' })
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

              await withSyncConnection(account, async() => {
                await adapter.removeBookmark({ ...serverMark, id: serverMarkId })
              })

              await account.sync() // propage update
              expect(account.getData().error).to.not.be.ok

              const tree = await account.localTree.getBookmarksTree(true)
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
            it('should sync root folder ignoring unsupported folders', async function() {
              if (!IS_BROWSER) {
                this.skip()
                return
              }
              const {default: browser} = await import('../lib/browser-api.js')
              const [root] = await browser.bookmarks.getTree()

              await Promise.all(
                root.children.flatMap(child => child.children.map(child => browser.bookmarks.removeTree(child.id)))
              )

              const originalFolderId = account.getData().localRoot
              await account.setData({ localRoot: root.id, rootPath: '' })
              account = await Account.get(account.id)
              const adapter = account.server

              expect(
                (await getAllBookmarks(account)).children
              ).to.have.lengthOf(0)

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

              await account.setData({ strategy: 'slave' })

              await account.sync()
              expect(account.getData().error).to.not.be.ok

              serverTree = await getAllBookmarks(account)
              const localTreeAfterSync = await account.localTree.getBookmarksTree()
              expect(serverTree.children).to.have.lengthOf(localTreeAfterSync.children.length + 1)

              // Switch it back to something harmless, so we don't attempt to clean up the root folder
              await account.setData({ localRoot: originalFolderId })
              account = await Account.get(account.id)
            })
          })
        })
      })
  })
})