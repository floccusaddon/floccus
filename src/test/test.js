import chai from 'chai'
import chaiAsPromised from 'chai-as-promised'
const AsyncParallel = require('async-parallel')

chai.use(chaiAsPromised)
const expect = chai.expect

import Account from '../lib/Account'
import { Folder, Bookmark } from '../lib/Tree'
import browser from '../lib/browser-api'

describe('Floccus', function() {
  this.timeout(60000) // no test should run longer than 60s
  this.slow(20000) // 20s is slow
  before(async function() {
    const background = await browser.runtime.getBackgroundPage()
    background.controller.setEnabled(false)
  })
  after(async function() {
    const background = await browser.runtime.getBackgroundPage()
    background.controller.setEnabled(true)
  })
  const CREDENTIALS = {
    username: 'admin',
    password: 'admin'
  }
  ;[
    Account.getDefaultValues('fake'),
    {
      type: 'nextcloud-legacy',
      url: 'http://localhost/',
      ...CREDENTIALS
    },
    {
      type: 'nextcloud-legacy',
      url: 'http://localhost/',
      serverRoot: '/my folder/some subfolder',
      ...CREDENTIALS
    },
    {
      type: 'nextcloud-legacy',
      url: 'http://localhost/',
      parallel: true,
      ...CREDENTIALS
    },
    {
      type: 'nextcloud-folders',
      url: 'http://localhost/',
      ...CREDENTIALS
    },
    {
      type: 'nextcloud-folders',
      url: 'http://localhost/',
      serverRoot: '/my folder/some subfolder',
      ...CREDENTIALS
    },
    {
      type: 'nextcloud-folders',
      url: 'http://localhost/',
      parallel: true,
      ...CREDENTIALS
    },
    {
      type: 'webdav',
      url: 'http://localhost/remote.php/webdav/',
      bookmark_file: 'bookmarks.xbel',
      ...CREDENTIALS
    },
    {
      type: 'webdav',
      url: 'http://localhost/remote.php/webdav/',
      bookmark_file: 'bookmarks.xbel',
      parallel: true,
      ...CREDENTIALS
    }
  ].forEach(ACCOUNT_DATA => {
    describe(
      ACCOUNT_DATA.type +
        ' ' +
        (ACCOUNT_DATA.serverRoot
          ? 'with serverRoot '
          : ACCOUNT_DATA.parallel
            ? 'parallel '
            : 'standard ') +
        'Account',
      function() {
        var account
        beforeEach('set up account', async function() {
          account = await Account.create(ACCOUNT_DATA)
        })
        afterEach('clean up account', async function() {
          if (account) {
            let localRoot = account.getData().localRoot
            if (localRoot) await browser.bookmarks.removeTree(localRoot)
            await account.delete()
          }
        })
        it('should create an account', async function() {
          const secondInstance = await Account.get(account.id)
          expect(secondInstance.getData()).to.deep.equal(account.getData())
        })
        it('should save and restore an account', async function() {
          await account.setData(ACCOUNT_DATA)
          expect(account.getData()).to.deep.equal(ACCOUNT_DATA)

          const secondInstance = await Account.get(account.id)
          expect(secondInstance.getData()).to.deep.equal(ACCOUNT_DATA)
        })
        it('should delete an account', async function() {
          await account.delete()
          expect(Account.get(account.id)).to.be.rejected
          account = null // so afterEach notices it's deleted already
        })
        it('should not be initialized upon creation', async function() {
          expect(await account.isInitialized()).to.be.false
        })
      }
    )
    describe(
      ACCOUNT_DATA.type +
        ' ' +
        (ACCOUNT_DATA.serverRoot
          ? 'serverRoot '
          : ACCOUNT_DATA.parallel
            ? 'parallel '
            : 'standard ') +
        'Sync ',
      function() {
        context('with one client', function() {
          var account
          beforeEach('set up account', async function() {
            account = await Account.create(ACCOUNT_DATA)
            if (ACCOUNT_DATA.type === 'fake') {
              account.server.bookmarksCache = new Folder({
                id: '',
                title: 'root'
              })
            }
            await account.init()
          })
          afterEach('clean up account', async function() {
            if (!account) return
            await browser.bookmarks.removeTree(account.getData().localRoot)
            if (ACCOUNT_DATA.type !== 'fake') {
              await account.setData({ ...account.getData(), serverRoot: null })
              if (account.server.onSyncStart) {
                await account.server.onSyncStart()
              }
              const tree = await account.server.getBookmarksTree(true)
              await AsyncParallel.each(tree.children, async child => {
                if (child instanceof Folder) {
                  await account.server.removeFolder(child.id)
                } else {
                  await account.server.removeBookmark(child.id)
                }
              })
              if (account.server.onSyncComplete) {
                await account.server.onSyncComplete()
              }
            }
            await account.delete()
          })
          it('should create local bookmarks on the server', async function() {
            var adapter = account.server
            expect(
              (await adapter.getBookmarksTree(true)).children
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

            const tree = await adapter.getBookmarksTree(true)
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
              ignoreEmptyFolders(ACCOUNT_DATA)
            )
          })
          it('should update the server on local changes', async function() {
            var adapter = account.server
            expect(
              (await adapter.getBookmarksTree(true)).children
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

            const newData = { title: 'blah' }
            await browser.bookmarks.update(bookmark.id, newData)
            await account.sync() // update on server
            expect(account.getData().error).to.not.be.ok

            const tree = await adapter.getBookmarksTree(true)
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
              ignoreEmptyFolders(ACCOUNT_DATA)
            )
          })
          it('should update the server on local removals', async function() {
            var adapter = account.server
            expect(
              (await adapter.getBookmarksTree(true)).children
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

            await browser.bookmarks.remove(bookmark.id)
            await account.sync() // update on server
            expect(account.getData().error).to.not.be.ok

            const tree = await adapter.getBookmarksTree(true)
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
              ignoreEmptyFolders(ACCOUNT_DATA)
            )
          })
          it('should update the server on local folder moves', async function() {
            var adapter = account.server
            expect(
              (await adapter.getBookmarksTree(true)).children
            ).to.have.lengthOf(0)

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
            const bookmark2 = await browser.bookmarks.create({
              title: 'url',
              url: 'http://ur.l/',
              parentId: barFolder.id
            })
            await account.sync() // propagate to server

            await browser.bookmarks.move(barFolder.id, { parentId: localRoot })
            await account.sync() // update on server
            expect(account.getData().error).to.not.be.ok

            const tree = await adapter.getBookmarksTree(true)
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
              ignoreEmptyFolders(ACCOUNT_DATA)
            )
          })
          it('should create server bookmarks locally', async function() {
            var adapter = account.server
            if (adapter.onSyncStart) await adapter.onSyncStart()
            const serverTree = await adapter.getBookmarksTree(true)
            const fooFolderId = await adapter.createFolder(serverTree.id, 'foo')
            const barFolderId = await adapter.createFolder(fooFolderId, 'bar')
            const serverMark = {
              title: 'url',
              url: 'http://ur.l/',
              parentId: barFolderId
            }
            const bookmarkId = await adapter.createBookmark(
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
              ignoreEmptyFolders(ACCOUNT_DATA)
            )
          })
          it('should update local bookmarks on server changes', async function() {
            var adapter = account.server

            if (adapter.onSyncStart) await adapter.onSyncStart()
            const serverTree = await adapter.getBookmarksTree(true)
            const fooFolderId = await adapter.createFolder(serverTree.id, 'foo')
            const barFolderId = await adapter.createFolder(fooFolderId, 'bar')
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

            if (adapter.onSyncStart) await adapter.onSyncStart()
            const newServerMark = {
              ...serverMark,
              title: 'blah',
              id: serverMarkId
            }
            await adapter.updateBookmark(new Bookmark(newServerMark))
            if (adapter.onSyncComplete) await adapter.onSyncComplete()

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
              ignoreEmptyFolders(ACCOUNT_DATA)
            )
          })
          it('should update local bookmarks on server removals', async function() {
            var adapter = account.server
            if (adapter.onSyncStart) await adapter.onSyncStart()
            const serverTree = await adapter.getBookmarksTree(true)
            const fooFolderId = await adapter.createFolder(serverTree.id, 'foo')
            const barFolderId = await adapter.createFolder(fooFolderId, 'bar')
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

            if (adapter.onSyncStart) await adapter.onSyncStart()
            await adapter.removeBookmark(serverMarkId)
            if (adapter.onSyncComplete) await adapter.onSyncComplete()

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
              ignoreEmptyFolders(ACCOUNT_DATA)
            )
          })
          it('should be able to handle duplicates', async function() {
            var adapter = account.server
            expect(
              (await adapter.getBookmarksTree(true)).children
            ).to.have.lengthOf(0)

            const localRoot = account.getData().localRoot
            const bookmarkData = {
              title: 'url',
              url: 'http://ur.l/'
            }
            const fooFolder = await browser.bookmarks.create({
              title: 'foo',
              parentId: localRoot
            })
            const bookmark1 = await browser.bookmarks.create({
              ...bookmarkData,
              parentId: fooFolder.id
            })
            const barFolder = await browser.bookmarks.create({
              title: 'bar',
              parentId: fooFolder.id
            })
            const bookmark2 = await browser.bookmarks.create({
              ...bookmarkData,
              parentId: barFolder.id
            })
            await account.sync() // propagate to server

            await browser.bookmarks.move(barFolder.id, { parentId: localRoot })
            await account.sync() // update on server
            expect(account.getData().error).to.not.be.ok

            const tree = await adapter.getBookmarksTree(true)
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
              ignoreEmptyFolders(ACCOUNT_DATA)
            )
          })
          it('should deduplicate unnormalized URLs', async function() {
            var adapter = account.server
            expect(
              (await adapter.getBookmarksTree(true)).children
            ).to.have.lengthOf(0)

            // create bookmark on server
            if (adapter.onSyncStart) await adapter.onSyncStart()
            var serverTree = await adapter.getBookmarksTree(true)
            const fooFolderId = await adapter.createFolder(serverTree.id, 'foo')
            const serverMark1 = {
              title: 'url',
              url: 'http://ur.l/foo/bar?a=b&foo=b%C3%A1r+foo'
            }
            const serverMark2 = {
              title: 'url2',
              url: 'http://ur2.l/foo/bar?a=b&foo=b%C3%A1r+foo'
            }
            const serverMarkId1 = await adapter.createBookmark(
              new Bookmark({ ...serverMark1, parentId: fooFolderId })
            )
            const serverMarkId2 = await adapter.createBookmark(
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
            const localMarkId1 = await browser.bookmarks.create({
              ...localMark1,
              parentId: fooFolder.id
            })
            const localMarkId2 = await browser.bookmarks.create({
              ...localMark2,
              parentId: fooFolder.id
            })

            await account.sync() // propagate to server

            expect(account.getData().error).to.not.be.ok

            // Sync again, so client can deduplicate
            // necessary if using bookmarks < v0.12 or WebDAV
            await account.sync()
            expect(account.getData().error).to.not.be.ok

            const tree = await adapter.getBookmarksTree(true)
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
              ignoreEmptyFolders(ACCOUNT_DATA)
            )
          })
          it('should not fail when moving both folders and contents', async function() {
            var adapter = account.server
            expect(
              (await adapter.getBookmarksTree(true)).children
            ).to.have.lengthOf(0)

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
            const bookmark2 = await browser.bookmarks.create({
              title: 'url',
              url: 'http://ur.l/',
              parentId: barFolder.id
            })
            await account.sync() // propagate to server

            await browser.bookmarks.move(barFolder.id, { parentId: localRoot })
            await browser.bookmarks.move(fooFolder.id, {
              parentId: barFolder.id
            })
            await browser.bookmarks.move(bookmark1.id, {
              parentId: barFolder.id
            })
            await account.sync() // update on server
            expect(account.getData().error).to.not.be.ok

            const tree = await adapter.getBookmarksTree(true)
            expectTreeEqual(
              tree,
              new Folder({
                title: tree.title,
                children: [
                  new Folder({
                    title: 'bar',
                    children: [
                      new Bookmark({ title: 'url', url: 'http://ur.l/' }),
                      new Bookmark({ title: 'test', url: 'http://ureff.l/' }),
                      new Folder({
                        title: 'foo',
                        children:
                          ACCOUNT_DATA.type !== 'nextcloud-legacy'
                            ? []
                            : [
                              // This is because of a peculiarity of the legacy adapter
                              new Bookmark({
                                title: 'test',
                                url: 'http://ureff.l/'
                              })
                            ]
                      })
                    ]
                  })
                ]
              }),
              ignoreEmptyFolders(ACCOUNT_DATA)
            )
          })
          it('should not fail when both moving folders and deleting their contents', async function() {
            var adapter = account.server
            expect(
              (await adapter.getBookmarksTree(true)).children
            ).to.have.lengthOf(0)

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

            await browser.bookmarks.move(barFolder.id, { parentId: localRoot })
            await browser.bookmarks.move(fooFolder.id, {
              parentId: barFolder.id
            })
            await browser.bookmarks.remove(bookmark3.id)
            await account.sync() // update on server
            expect(account.getData().error).to.not.be.ok

            const tree = await adapter.getBookmarksTree(true)
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
              ignoreEmptyFolders(ACCOUNT_DATA)
            )
          })
          it('should handle strange characters well', async function() {
            var adapter = account.server
            expect(
              (await adapter.getBookmarksTree(true)).children
            ).to.have.lengthOf(0)

            const localRoot = account.getData().localRoot
            const fooFolder = await browser.bookmarks.create({
              title: 'foo!"§$%&/()=?"',
              parentId: localRoot
            })
            const barFolder = await browser.bookmarks.create({
              title: "bar=?*'Ä_:-^;",
              parentId: fooFolder.id
            })
            const bookmark = await browser.bookmarks.create({
              title: 'url|!"=)/§_:;Ä\'*ü"',
              url: 'http://ur.l/',
              parentId: barFolder.id
            })
            await account.sync()
            expect(account.getData().error).to.not.be.ok

            await account.sync()
            expect(account.getData().error).to.not.be.ok

            const tree = await adapter.getBookmarksTree(true)
            expectTreeEqual(
              tree,
              new Folder({
                title: tree.title,
                children: [
                  new Folder({
                    title: 'foo!"§$%&/()=?"',
                    children: [
                      new Folder({
                        title: "bar=?*'Ä_:-^;",
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
              ignoreEmptyFolders(ACCOUNT_DATA)
            )
          })
          it('should be ok if both server and local bookmark are removed', async function() {
            var adapter = account.server

            if (adapter.onSyncStart) await adapter.onSyncStart()
            var serverTree = await adapter.getBookmarksTree(true)
            const fooFolderId = await adapter.createFolder(serverTree.id, 'foo')
            const barFolderId = await adapter.createFolder(fooFolderId, 'bar')
            const serverMark = {
              title: 'url',
              url: 'http://ur.l/',
              parentId: barFolderId
            }
            const serverMarkId = await adapter.createBookmark(
              new Bookmark(serverMark)
            )
            if (adapter.onSyncComplete) await adapter.onSyncComplete()

            await account.sync() // propagate creation

            if (adapter.onSyncStart) await adapter.onSyncStart()
            await adapter.removeBookmark(serverMarkId)
            if (adapter.onSyncComplete) await adapter.onSyncComplete()
            await account.sync() // propagate update

            expect(account.getData().error).to.not.be.ok
            const localTree = await account.localTree.getBookmarksTree(true)

            if (adapter.onSyncStart) await adapter.onSyncStart()
            serverTree = await adapter.getBookmarksTree(true)
            if (adapter.onSyncComplete) await adapter.onSyncComplete()

            // Root must also be equal in the assertion
            localTree.title = serverTree.title

            expectTreeEqual(localTree, serverTree)
          })
          it('should sync nested accounts correctly', async function() {
            const localRoot = account.getData().localRoot
            const nestedAccountFolder = await browser.bookmarks.create({
              title: 'nestedAccount',
              parentId: localRoot
            })

            let nestedAccount = await Account.create({
              ...Account.getDefaultValues('fake'),
              localRoot: nestedAccountFolder.id
            })
            nestedAccount.server.bookmarksCache = new Folder({
              id: '',
              title: 'root'
            })
            await nestedAccount.init()

            var adapter = account.server
            expect(
              (await adapter.getBookmarksTree(true)).children
            ).to.have.lengthOf(0)

            const barFolder = await browser.bookmarks.create({
              title: 'bar',
              parentId: localRoot
            })
            const bookmark1 = await browser.bookmarks.create({
              title: 'url',
              url: 'http://ur.l/',
              parentId: barFolder.id
            })
            const bookmark2 = await browser.bookmarks.create({
              title: 'url2',
              url: 'http://ur2.l/',
              parentId: nestedAccountFolder.id
            })
            await account.sync() // propagate to server
            await nestedAccount.sync() // propagate to server

            expect(account.getData().error).to.not.be.ok
            expect(nestedAccount.getData().error).to.not.be.ok

            const tree = await adapter.getBookmarksTree(true)
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
              ignoreEmptyFolders(ACCOUNT_DATA)
            )

            await browser.bookmarks.removeTree(
              nestedAccount.getData().localRoot
            )
            await nestedAccount.delete()
          })
          it('should remove duplicates in the same folder', async function() {
            const localRoot = account.getData().localRoot

            var adapter = account.server
            expect(
              (await adapter.getBookmarksTree(true)).children
            ).to.have.lengthOf(0)

            const barFolder = await browser.bookmarks.create({
              title: 'bar',
              parentId: localRoot
            })
            const bookmark1 = await browser.bookmarks.create({
              title: 'url',
              url: 'http://ur.l/',
              parentId: barFolder.id
            })
            const bookmark2 = await browser.bookmarks.create({
              title: 'url',
              url: 'http://ur.l/',
              parentId: barFolder.id
            })
            await account.sync() // propagate to server
            expect(account.getData().error).to.not.be.ok

            const tree = await adapter.getBookmarksTree(true)
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
              ignoreEmptyFolders(ACCOUNT_DATA)
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
                      new Bookmark({ title: 'url', url: 'http://ur.l/' })
                    ]
                  })
                ]
              }),
              ignoreEmptyFolders(ACCOUNT_DATA)
            )
          })
          if (~ACCOUNT_DATA.type.indexOf('nextcloud-legacy')) {
            it('should leave alone unaccepted bookmarks entirely', async function() {
              const localRoot = account.getData().localRoot

              var adapter = account.server
              expect(
                (await adapter.getBookmarksTree(true)).children
              ).to.have.lengthOf(0)

              const barFolder = await browser.bookmarks.create({
                title: 'bar',
                parentId: localRoot
              })
              const fooFolder = await browser.bookmarks.create({
                title: 'foo',
                parentId: barFolder.id
              })
              const bookmark1 = await browser.bookmarks.create({
                title: 'url',
                url: 'http://ur.l/',
                parentId: barFolder.id
              })
              const bookmark2 = await browser.bookmarks.create({
                title: 'url2',
                url: 'javascript:void(0)',
                parentId: fooFolder.id
              })
              await account.sync() // propagate to server
              expect(account.getData().error).to.not.be.ok

              await account.sync() // propagate to server -- if we had cached the unacceptables, they'd be deleted now
              expect(account.getData().error).to.not.be.ok

              const tree = await adapter.getBookmarksTree(true)
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
                ignoreEmptyFolders(ACCOUNT_DATA)
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
                              url: 'javascript:void(0)'
                            })
                          ]
                        })
                      ]
                    })
                  ]
                }),
                ignoreEmptyFolders(ACCOUNT_DATA)
              )
            })
          }

          if (ACCOUNT_DATA.type !== 'nextcloud-legacy') {
            it('should synchronize ordering', async function() {
              var adapter = account.server
              expect(
                (await adapter.getBookmarksTree(true)).children
              ).to.have.lengthOf(0)

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

              const tree = await adapter.getBookmarksTree(true)
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
          }
          context('with slave mode', function() {
            it("shouldn't create local bookmarks on the server", async function() {
              await account.setData({ ...account.getData(), strategy: 'slave' })
              var adapter = account.server
              expect(
                (await adapter.getBookmarksTree(true)).children
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

              const tree = await adapter.getBookmarksTree(true)
              expect(tree.children).to.have.lengthOf(0)
            })
            it("shouldn't update the server on local changes", async function() {
              var adapter = account.server
              expect(
                (await adapter.getBookmarksTree(true)).children
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
              const originalTree = await adapter.getBookmarksTree(true)
              await account.setData({ ...account.getData(), strategy: 'slave' })

              const newData = { title: 'blah' }
              await browser.bookmarks.update(bookmark.id, newData)
              await account.sync() // update on server
              expect(account.getData().error).to.not.be.ok

              const tree = await adapter.getBookmarksTree(true)
              expectTreeEqual(
                tree,
                originalTree,
                ignoreEmptyFolders(ACCOUNT_DATA)
              )
            })
            it("shouldn't update the server on local removals", async function() {
              var adapter = account.server
              expect(
                (await adapter.getBookmarksTree(true)).children
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
              const originalTree = await adapter.getBookmarksTree(true)
              await account.setData({ ...account.getData(), strategy: 'slave' })

              await browser.bookmarks.remove(bookmark.id)
              await account.sync() // update on server
              expect(account.getData().error).to.not.be.ok

              const tree = await adapter.getBookmarksTree(true)
              expectTreeEqual(
                tree,
                originalTree,
                ignoreEmptyFolders(ACCOUNT_DATA)
              )
            })
            it("shouldn't update the server on local folder moves", async function() {
              var adapter = account.server
              expect(
                (await adapter.getBookmarksTree(true)).children
              ).to.have.lengthOf(0)

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
              const bookmark2 = await browser.bookmarks.create({
                title: 'url',
                url: 'http://ur.l/',
                parentId: barFolder.id
              })
              await account.sync() // propagate to server
              const originalTree = await adapter.getBookmarksTree(true)
              await account.setData({ ...account.getData(), strategy: 'slave' })

              await browser.bookmarks.move(barFolder.id, {
                parentId: localRoot
              })
              await account.sync() // update on server
              expect(account.getData().error).to.not.be.ok

              const tree = await adapter.getBookmarksTree(true)
              expectTreeEqual(
                tree,
                originalTree,
                ignoreEmptyFolders(ACCOUNT_DATA)
              )
            })
            it('should create server bookmarks locally', async function() {
              await account.setData({ ...account.getData(), strategy: 'slave' })
              var adapter = account.server
              if (adapter.onSyncStart) await adapter.onSyncStart()
              const serverTree = await adapter.getBookmarksTree(true)
              const fooFolderId = await adapter.createFolder(
                serverTree.id,
                'foo'
              )
              const barFolderId = await adapter.createFolder(fooFolderId, 'bar')
              const serverMark = {
                title: 'url',
                url: 'http://ur.l/',
                parentId: barFolderId
              }
              const bookmarkId = await adapter.createBookmark(
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
                ignoreEmptyFolders(ACCOUNT_DATA)
              )
            })
            it('should update local bookmarks on server changes', async function() {
              await account.setData({ ...account.getData(), strategy: 'slave' })
              var adapter = account.server

              if (adapter.onSyncStart) await adapter.onSyncStart()
              const serverTree = await adapter.getBookmarksTree(true)
              const fooFolderId = await adapter.createFolder(
                serverTree.id,
                'foo'
              )
              const barFolderId = await adapter.createFolder(fooFolderId, 'bar')
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

              if (adapter.onSyncStart) await adapter.onSyncStart()
              const newServerMark = {
                ...serverMark,
                title: 'blah',
                id: serverMarkId
              }
              await adapter.updateBookmark(new Bookmark(newServerMark))
              if (adapter.onSyncComplete) await adapter.onSyncComplete()

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
                ignoreEmptyFolders(ACCOUNT_DATA)
              )
            })
            it('should update local bookmarks on server removals', async function() {
              await account.setData({ ...account.getData(), strategy: 'slave' })
              var adapter = account.server
              if (adapter.onSyncStart) await adapter.onSyncStart()
              const serverTree = await adapter.getBookmarksTree(true)
              const fooFolderId = await adapter.createFolder(
                serverTree.id,
                'foo'
              )
              const barFolderId = await adapter.createFolder(fooFolderId, 'bar')
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

              if (adapter.onSyncStart) await adapter.onSyncStart()
              await adapter.removeBookmark(serverMarkId)
              if (adapter.onSyncComplete) await adapter.onSyncComplete()

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
                ignoreEmptyFolders(ACCOUNT_DATA)
              )
            })
          })
          context('with overwrite mode', function() {
            before(function() {
              if (ACCOUNT_DATA.type === 'nextcloud-legacy') return this.skip()
            })
            it('should create local bookmarks on the server', async function() {
              await account.setData({
                ...account.getData(),
                strategy: 'overwrite'
              })
              var adapter = account.server
              expect(
                (await adapter.getBookmarksTree(true)).children
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

              const tree = await adapter.getBookmarksTree(true)
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
                ignoreEmptyFolders(ACCOUNT_DATA)
              )
            })
            it('should update the server on local changes', async function() {
              var adapter = account.server
              expect(
                (await adapter.getBookmarksTree(true)).children
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
              await account.setData({
                ...account.getData(),
                strategy: 'overwrite'
              })

              const newData = { title: 'blah' }
              await browser.bookmarks.update(bookmark.id, newData)
              const originalTree = await account.localTree.getBookmarksTree(
                true
              )
              await account.sync() // update on server
              expect(account.getData().error).to.not.be.ok

              const tree = await adapter.getBookmarksTree(true)
              originalTree.title = tree.title
              expectTreeEqual(
                tree,
                originalTree,
                ignoreEmptyFolders(ACCOUNT_DATA)
              )
            })
            it('should update the server on local removals', async function() {
              var adapter = account.server
              expect(
                (await adapter.getBookmarksTree(true)).children
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
              await account.setData({
                ...account.getData(),
                strategy: 'overwrite'
              })

              await browser.bookmarks.remove(bookmark.id)
              const originalTree = await account.localTree.getBookmarksTree(
                true
              )
              await account.sync() // update on server
              expect(account.getData().error).to.not.be.ok

              const tree = await adapter.getBookmarksTree(true)
              originalTree.title = tree.title
              expectTreeEqual(
                tree,
                originalTree,
                ignoreEmptyFolders(ACCOUNT_DATA)
              )
            })
            it('should update the server on local folder moves', async function() {
              var adapter = account.server
              expect(
                (await adapter.getBookmarksTree(true)).children
              ).to.have.lengthOf(0)

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
              const bookmark2 = await browser.bookmarks.create({
                title: 'url',
                url: 'http://ur.l/',
                parentId: barFolder.id
              })
              await account.sync() // propagate to server
              await account.setData({
                ...account.getData(),
                strategy: 'overwrite'
              })

              await browser.bookmarks.move(barFolder.id, {
                parentId: localRoot
              })
              const originalTree = await account.localTree.getBookmarksTree(
                true
              )
              await account.sync() // update on server
              expect(account.getData().error).to.not.be.ok

              const tree = await adapter.getBookmarksTree(true)
              originalTree.title = tree.title
              expectTreeEqual(
                tree,
                originalTree,
                ignoreEmptyFolders(ACCOUNT_DATA)
              )
            })
            it("shouldn't create server bookmarks locally", async function() {
              await account.setData({
                ...account.getData(),
                strategy: 'overwrite'
              })
              var adapter = account.server
              if (adapter.onSyncStart) await adapter.onSyncStart()
              const originalTree = await account.localTree.getBookmarksTree(
                true
              )
              const serverTree = await adapter.getBookmarksTree(true)
              const fooFolderId = await adapter.createFolder(
                serverTree.id,
                'foo'
              )
              const barFolderId = await adapter.createFolder(fooFolderId, 'bar')
              const serverMark = {
                title: 'url',
                url: 'http://ur.l/',
                parentId: barFolderId
              }
              const bookmarkId = await adapter.createBookmark(
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
                ignoreEmptyFolders(ACCOUNT_DATA)
              )
            })
            it("shouldn't update local bookmarks on server changes", async function() {
              var adapter = account.server

              if (adapter.onSyncStart) await adapter.onSyncStart()
              const serverTree = await adapter.getBookmarksTree(true)
              const fooFolderId = await adapter.createFolder(
                serverTree.id,
                'foo'
              )
              const barFolderId = await adapter.createFolder(fooFolderId, 'bar')
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
              const originalTree = await account.localTree.getBookmarksTree(
                true
              )
              await account.setData({
                ...account.getData(),
                strategy: 'overwrite'
              })

              if (adapter.onSyncStart) await adapter.onSyncStart()
              const newServerMark = {
                ...serverMark,
                title: 'blah',
                id: serverMarkId
              }
              await adapter.updateBookmark(new Bookmark(newServerMark))
              if (adapter.onSyncComplete) await adapter.onSyncComplete()

              await account.sync() // propage update
              expect(account.getData().error).to.not.be.ok

              const tree = await account.localTree.getBookmarksTree(true)
              originalTree.title = tree.title
              expectTreeEqual(
                tree,
                originalTree,
                ignoreEmptyFolders(ACCOUNT_DATA)
              )
            })
            it("shouldn't update local bookmarks on server removals", async function() {
              var adapter = account.server
              if (adapter.onSyncStart) await adapter.onSyncStart()
              const serverTree = await adapter.getBookmarksTree(true)
              const fooFolderId = await adapter.createFolder(
                serverTree.id,
                'foo'
              )
              const barFolderId = await adapter.createFolder(fooFolderId, 'bar')
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
              const originalTree = await account.localTree.getBookmarksTree(
                true
              )
              await account.setData({
                ...account.getData(),
                strategy: 'overwrite'
              })

              if (adapter.onSyncStart) await adapter.onSyncStart()
              await adapter.removeBookmark(serverMarkId)
              if (adapter.onSyncComplete) await adapter.onSyncComplete()

              await account.sync() // propage update
              expect(account.getData().error).to.not.be.ok

              const tree = await account.localTree.getBookmarksTree(true)
              originalTree.title = tree.title
              expectTreeEqual(
                tree,
                originalTree,
                ignoreEmptyFolders(ACCOUNT_DATA)
              )
            })
          })
        })
        context('with two clients', function() {
          var account1, account2
          beforeEach('set up accounts', async function() {
            account1 = await Account.create(ACCOUNT_DATA)
            await account1.init()
            account2 = await Account.create(ACCOUNT_DATA)
            await account2.init()

            if (ACCOUNT_DATA.type === 'fake') {
              // Wrire both accounts to the same fake db
              account2.server.bookmarksCache = account1.server.bookmarksCache = new Folder(
                { id: '', title: 'root' }
              )
            }
          })
          afterEach('clean up accounts', async function() {
            await browser.bookmarks.removeTree(account1.getData().localRoot)
            if (ACCOUNT_DATA.type !== 'fake') {
              await account1.setData({
                ...account1.getData(),
                serverRoot: null
              })
              if (account1.server.onSyncStart) {
                await account1.server.onSyncStart()
              }
              const tree = await account1.server.getBookmarksTree(true)
              await AsyncParallel.each(tree.children, async child => {
                if (child instanceof Folder) {
                  await account1.server.removeFolder(child.id)
                } else {
                  await account1.server.removeBookmark(child.id)
                }
              })
              if (account1.server.onSyncComplete) {
                await account1.server.onSyncComplete()
              }
            }
            await account1.delete()
            await browser.bookmarks.removeTree(account2.getData().localRoot)
            await account2.delete()
          })
          it('should propagate edits using "last write wins"', async function() {
            var adapter = account1.server

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

            if (adapter.onSyncStart) await adapter.onSyncStart()
            const serverTree = await adapter.getBookmarksTree(true)
            if (adapter.onSyncComplete) await adapter.onSyncComplete()

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

            if (adapter.onSyncStart) await adapter.onSyncStart()
            const serverTreeAfterSyncing = await adapter.getBookmarksTree(true)
            if (adapter.onSyncComplete) await adapter.onSyncComplete()
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
              ignoreEmptyFolders(ACCOUNT_DATA)
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
              ignoreEmptyFolders(ACCOUNT_DATA)
            )
            tree2AfterSyncing.title = serverTreeAfterSyncing.title
            expectTreeEqual(
              tree2AfterSyncing,
              serverTreeAfterSyncing,
              ignoreEmptyFolders(ACCOUNT_DATA)
            )
          })
          it('should overtake moves to a different client', async function() {
            var adapter = account1.server

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

            if (adapter.onSyncStart) await adapter.onSyncStart()
            const serverTreeAfterFirstSync = await adapter.getBookmarksTree(
              true
            )
            if (adapter.onSyncComplete) await adapter.onSyncComplete()

            const tree1AfterFirstSync = await account1.localTree.getBookmarksTree(
              true
            )
            const tree2AfterFirstSync = await account2.localTree.getBookmarksTree(
              true
            )
            expectTreeEqual(
              tree1AfterFirstSync,
              tree1,
              ignoreEmptyFolders(ACCOUNT_DATA)
            )
            serverTreeAfterFirstSync.title = tree1.title
            expectTreeEqual(
              serverTreeAfterFirstSync,
              tree1,
              ignoreEmptyFolders(ACCOUNT_DATA)
            )
            tree2AfterFirstSync.title = tree1.title
            expectTreeEqual(
              tree2AfterFirstSync,
              tree1,
              ignoreEmptyFolders(ACCOUNT_DATA)
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

            if (adapter.onSyncStart) await adapter.onSyncStart()
            const serverTreeAfterSecondSync = await adapter.getBookmarksTree(
              true
            )
            if (adapter.onSyncComplete) await adapter.onSyncComplete()

            const tree1AfterSecondSync = await account1.localTree.getBookmarksTree(
              true
            )
            expectTreeEqual(
              tree1AfterSecondSync,
              tree1BeforeSecondSync,
              ignoreEmptyFolders(ACCOUNT_DATA)
            )
            serverTreeAfterSecondSync.title = tree1AfterSecondSync.title
            expectTreeEqual(
              serverTreeAfterSecondSync,
              tree1AfterSecondSync,
              ignoreEmptyFolders(ACCOUNT_DATA)
            )
            console.log('Second round first half ok')

            await account2.sync()

            if (adapter.onSyncStart) await adapter.onSyncStart()
            const serverTreeAfterThirdSync = await adapter.getBookmarksTree(
              true
            )
            if (adapter.onSyncComplete) await adapter.onSyncComplete()

            const tree2AfterThirdSync = await account2.localTree.getBookmarksTree(
              true
            )
            expectTreeEqual(
              tree2AfterThirdSync,
              tree1AfterSecondSync,
              ignoreEmptyFolders(ACCOUNT_DATA)
            )
            serverTreeAfterThirdSync.title = tree2AfterThirdSync.title
            expectTreeEqual(
              serverTreeAfterThirdSync,
              tree2AfterThirdSync,
              ignoreEmptyFolders(ACCOUNT_DATA)
            )
            console.log('Second round second half ok')

            console.log('acc1: final sync')
            await account1.sync()

            if (adapter.onSyncStart) await adapter.onSyncStart()
            const serverTreeAfterFinalSync = await adapter.getBookmarksTree(
              true
            )
            if (adapter.onSyncComplete) await adapter.onSyncComplete()

            const tree1AfterFinalSync = await account1.localTree.getBookmarksTree(
              true
            )
            expectTreeEqual(
              tree1AfterFinalSync,
              tree2AfterThirdSync,
              ignoreEmptyFolders(ACCOUNT_DATA)
            )
            tree2AfterThirdSync.title = serverTreeAfterFinalSync.title
            expectTreeEqual(
              tree2AfterThirdSync,
              serverTreeAfterFinalSync,
              ignoreEmptyFolders(ACCOUNT_DATA)
            )
          })

          it('should synchronize ordering', async function() {
            if (ACCOUNT_DATA.type === 'nextcloud-legacy') return this.skip()
            var adapter = account1.server
            expect(
              (await adapter.getBookmarksTree(true)).children
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

          it('should handle deep hierarchies with lots of bookmarks', async function() {
            this.timeout(20 * 60000) // timeout after 20mins
            var adapter = account1.server

            const localRoot = account1.getData().localRoot
            let bookmarks = 0
            let folders = 0
            let magicFolder, magicBookmark
            const createTree = async(parentId, i, j) => {
              const len = Math.abs(i - j)
              for (let k = i; k < j; k++) {
                const newBookmark = await browser.bookmarks.create({
                  title: 'url' + k,
                  url: 'http://ur.l/' + k,
                  parentId
                })
                bookmarks++
                if (bookmarks === 3333) magicBookmark = newBookmark
              }

              if (len < 13) return

              const step = Math.floor(len / 6)
              for (let k = i; k < j; k += step) {
                const newFolder = await browser.bookmarks.create({
                  title: 'folder' + k,
                  parentId
                })
                folders++
                if (folders === 33) magicFolder = newFolder
                await createTree(newFolder.id, k, k + step)
              }
            }

            await createTree(localRoot, 0, 1000) // Create 4000 bookmarks

            const tree1Initial = await account1.localTree.getBookmarksTree(true)
            await account1.sync()
            await account2.sync()

            if (adapter.onSyncStart) await adapter.onSyncStart()
            const serverTreeAfterFirstSync = await adapter.getBookmarksTree(
              true
            )
            if (adapter.onSyncComplete) await adapter.onSyncComplete()

            const tree1AfterFirstSync = await account1.localTree.getBookmarksTree(
              true
            )
            const tree2AfterFirstSync = await account2.localTree.getBookmarksTree(
              true
            )
            expectTreeEqual(
              tree1AfterFirstSync,
              tree1Initial,
              ignoreEmptyFolders(ACCOUNT_DATA)
            )
            serverTreeAfterFirstSync.title = tree1Initial.title
            expectTreeEqual(
              serverTreeAfterFirstSync,
              tree1Initial,
              ignoreEmptyFolders(ACCOUNT_DATA)
            )
            tree2AfterFirstSync.title = tree1Initial.title
            expectTreeEqual(
              tree2AfterFirstSync,
              tree1Initial,
              ignoreEmptyFolders(ACCOUNT_DATA)
            )
            console.log('First round ok')

            await browser.bookmarks.move(magicBookmark.id, {
              parentId: magicFolder.id
            })
            console.log('acc1: Moved bookmark')

            const tree1BeforeSecondSync = await account1.localTree.getBookmarksTree(
              true
            )
            await account1.sync()

            if (adapter.onSyncStart) await adapter.onSyncStart()
            const serverTreeAfterSecondSync = await adapter.getBookmarksTree(
              true
            )
            if (adapter.onSyncComplete) await adapter.onSyncComplete()

            const tree1AfterSecondSync = await account1.localTree.getBookmarksTree(
              true
            )
            expectTreeEqual(
              tree1AfterSecondSync,
              tree1BeforeSecondSync,
              ignoreEmptyFolders(ACCOUNT_DATA)
            )
            serverTreeAfterSecondSync.title = tree1AfterSecondSync.title
            expectTreeEqual(
              serverTreeAfterSecondSync,
              tree1AfterSecondSync,
              ignoreEmptyFolders(ACCOUNT_DATA)
            )
            console.log('Second round first half ok')

            await account2.sync()

            if (adapter.onSyncStart) await adapter.onSyncStart()
            const serverTreeAfterThirdSync = await adapter.getBookmarksTree(
              true
            )
            if (adapter.onSyncComplete) await adapter.onSyncComplete()

            const tree2AfterThirdSync = await account2.localTree.getBookmarksTree(
              true
            )
            expectTreeEqual(
              tree2AfterThirdSync,
              tree1AfterSecondSync,
              ignoreEmptyFolders(ACCOUNT_DATA)
            )
            serverTreeAfterThirdSync.title = tree2AfterThirdSync.title
            expectTreeEqual(
              serverTreeAfterThirdSync,
              tree2AfterThirdSync,
              ignoreEmptyFolders(ACCOUNT_DATA)
            )
            console.log('Second round second half ok')

            console.log('acc1: final sync')
            await account1.sync()

            if (adapter.onSyncStart) await adapter.onSyncStart()
            const serverTreeAfterFinalSync = await adapter.getBookmarksTree(
              true
            )
            if (adapter.onSyncComplete) await adapter.onSyncComplete()

            const tree1AfterFinalSync = await account1.localTree.getBookmarksTree(
              true
            )
            expectTreeEqual(
              tree1AfterFinalSync,
              tree2AfterThirdSync,
              ignoreEmptyFolders(ACCOUNT_DATA)
            )
            tree2AfterThirdSync.title = serverTreeAfterFinalSync.title
            expectTreeEqual(
              tree2AfterThirdSync,
              serverTreeAfterFinalSync,
              ignoreEmptyFolders(ACCOUNT_DATA)
            )
          })

          // Skipping this, because nextcloud adapter currently
          // isn't able to track bookmarks across dirs, thus in this
          // scenario both bookmarks survive :/
          it.skip('should propagate moves using "last write wins"', async function() {
            var adapter = account1.server

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

            const serverTreeAfterFirstSync = await adapter.getBookmarksTree(
              true
            )
            const tree1AfterFirstSync = await account1.localTree.getBookmarksTree(
              true
            )
            const tree2AfterFirstSync = await account2.localTree.getBookmarksTree(
              true
            )
            expectTreeEqual(
              tree1AfterFirstSync,
              tree1,
              ignoreEmptyFolders(ACCOUNT_DATA)
            )
            serverTreeAfterFirstSync.title = tree1.title
            expectTreeEqual(
              serverTreeAfterFirstSync,
              tree1,
              ignoreEmptyFolders(ACCOUNT_DATA)
            )
            tree2AfterFirstSync.title = tree1.title
            expectTreeEqual(
              tree2AfterFirstSync,
              tree1,
              ignoreEmptyFolders(ACCOUNT_DATA)
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

            const serverTreeAfterSecondSync = await adapter.getBookmarksTree(
              true
            )
            const tree1AfterSecondSync = await account1.localTree.getBookmarksTree(
              true
            )
            expectTreeEqual(
              tree1AfterSecondSync,
              tree1BeforeSecondSync,
              ignoreEmptyFolders(ACCOUNT_DATA)
            )
            serverTreeAfterSecondSync.title = tree1AfterSecondSync.title
            expectTreeEqual(
              serverTreeAfterSecondSync,
              tree1AfterSecondSync,
              ignoreEmptyFolders(ACCOUNT_DATA)
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

            const serverTreeAfterThirdSync = await adapter.getBookmarksTree(
              true
            )
            const tree2AfterThirdSync = await account2.localTree.getBookmarksTree(
              true
            )
            expectTreeEqual(
              tree2AfterThirdSync,
              tree2BeforeThirdSync,
              ignoreEmptyFolders(ACCOUNT_DATA)
            )
            serverTreeAfterThirdSync.title = tree2AfterThirdSync.title
            expectTreeEqual(
              serverTreeAfterThirdSync,
              tree2AfterThirdSync,
              ignoreEmptyFolders(ACCOUNT_DATA)
            )
            console.log('Second round second half ok')

            console.log('acc1: final sync')
            await account1.sync()

            const serverTreeAfterFinalSync = await adapter.getBookmarksTree(
              true
            )
            const tree1AfterFinalSync = await account1.localTree.getBookmarksTree(
              true
            )
            expectTreeEqual(
              tree1AfterFinalSync,
              tree2AfterThirdSync,
              ignoreEmptyFolders(ACCOUNT_DATA)
            )
            tree2AfterThirdSync.title = serverTreeAfterFinalSync.title
            expectTreeEqual(
              tree2AfterThirdSync,
              serverTreeAfterFinalSync,
              ignoreEmptyFolders(ACCOUNT_DATA)
            )
          })
        })
      }
    )
  })
})

function expectTreeEqual(tree1, tree2, ignoreEmptyFolders, checkOrder) {
  try {
    expect(tree1.title).to.equal(tree2.title)
    if (tree2.url) {
      expect(tree1.url).to.equal(tree2.url)
    } else {
      if (!checkOrder) {
        tree2.children.sort((a, b) => {
          if (a.title < b.title) return -1
          if (a.title > b.title) return 1
          return 0
        })
        tree1.children.sort((a, b) => {
          if (a.title < b.title) return -1
          if (a.title > b.title) return 1
          return 0
        })
      }
      let children1 = ignoreEmptyFolders
        ? tree1.children.filter(child => !hasNoBookmarks(child))
        : tree1.children
      let children2 = ignoreEmptyFolders
        ? tree2.children.filter(child => !hasNoBookmarks(child))
        : tree2.children
      expect(children1).to.have.length(children2.length)
      children2.forEach((child2, i) => {
        expectTreeEqual(children1[i], child2, ignoreEmptyFolders, checkOrder)
      })
    }
  } catch (e) {
    console.log(
      `Trees are not equal: (checkOrder: ${checkOrder}, ignoreEmptyFolders: ${ignoreEmptyFolders})`,
      'Tree 1:\n' + tree1.inspect(0) + '\n',
      'Tree 2:\n' + tree2.inspect(0)
    )
    throw e
  }
}

function hasNoBookmarks(child) {
  if (child instanceof Bookmark) return false
  else return !child.children.some(child => !hasNoBookmarks(child))
}

function ignoreEmptyFolders(account_data) {
  return account_data.type === 'nextcloud-legacy'
}
