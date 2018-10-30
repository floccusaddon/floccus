import chai from 'chai'
import chaiAsPromised from 'chai-as-promised'

chai.use(chaiAsPromised)
const expect = chai.expect

import Account from '../lib/Account'
import { Folder, Bookmark } from '../lib/Tree'
import AccountStorage from '../lib/AccountStorage'
import browser from '../lib/browser-api'

describe('Floccus', function() {
  this.timeout(20000) // no test should run longer than 15s
  before(async function() {
    const background = await browser.runtime.getBackgroundPage()
    background.controller.setEnabled(false)
  })
  after(async function() {
    const background = await browser.runtime.getBackgroundPage()
    background.controller.setEnabled(true)
  })
  ;[
    Account.getDefaultValues('fake'),
    {
      type: 'nextcloud',
      url: 'http://localhost/',
      username: 'admin',
      password: 'admin'
    },
    {
      type: 'nextcloud-folders',
      url: 'http://localhost/',
      username: 'admin',
      password: 'admin'
    },
    {
      type: 'webdav',
      url: 'http://localhost/remote.php/webdav/',
      username: 'admin',
      password: 'admin',
      bookmark_file: 'bookmarks.xbel'
    }
  ].forEach(ACCOUNT_DATA => {
    describe(ACCOUNT_DATA.type + ' Account', function() {
      var account
      beforeEach('set up account', async function() {
        account = await Account.create(ACCOUNT_DATA)
      })
      afterEach('clean up account', async function() {
        if (account) await account.delete()
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
    })
    describe(ACCOUNT_DATA.type + ' Sync', function() {
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
            let tree = await account.server.getBookmarksTree()
            await Promise.all(
              tree.children.map(async child => {
                if (child instanceof Folder) {
                  await account.server.removeFolder(child.id)
                } else {
                  await account.server.removeBookmark(child.id)
                }
              })
            )
            if (account.server.onSyncComplete) {
              await account.server.onSyncComplete()
            }
          }
          await account.delete()
        })
        it('should create local bookmarks on the server', async function() {
          var adapter = account.server
          expect((await adapter.getBookmarksTree()).children).to.have.lengthOf(
            0
          )

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

          const tree = await adapter.getBookmarksTree()
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
            ACCOUNT_DATA.type === 'nextcloud'
          )
        })
        it('should update the server on local changes', async function() {
          var adapter = account.server
          expect((await adapter.getBookmarksTree()).children).to.have.lengthOf(
            0
          )

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

          const tree = await adapter.getBookmarksTree()
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
            ACCOUNT_DATA.type === 'nextcloud'
          )
        })
        it('should update the server on local removals', async function() {
          var adapter = account.server
          expect((await adapter.getBookmarksTree()).children).to.have.lengthOf(
            0
          )

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

          const tree = await adapter.getBookmarksTree()
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
            ACCOUNT_DATA.type === 'nextcloud'
          )
        })
        it('should create server bookmarks locally', async function() {
          var adapter = account.server
          if (adapter.onSyncStart) await adapter.onSyncStart()
          const serverTree = await adapter.getBookmarksTree()
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

          const tree = await account.localTree.getBookmarksTree()
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
            ACCOUNT_DATA.type === 'nextcloud'
          )
        })
        it('should update local bookmarks on server changes', async function() {
          var adapter = account.server

          if (adapter.onSyncStart) await adapter.onSyncStart()
          const serverTree = await adapter.getBookmarksTree()
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

          const tree = await account.localTree.getBookmarksTree()
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
            ACCOUNT_DATA.type === 'nextcloud'
          )
        })
        it('should update local bookmarks on server removals', async function() {
          var adapter = account.server
          if (adapter.onSyncStart) await adapter.onSyncStart()
          const serverTree = await adapter.getBookmarksTree()
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

          const tree = await account.localTree.getBookmarksTree()
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
            ACCOUNT_DATA.type === 'nextcloud'
          )
        })
        it('should handle strange characters well', async function() {
          var adapter = account.server
          expect((await adapter.getBookmarksTree()).children).to.have.lengthOf(
            0
          )

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

          const tree = await adapter.getBookmarksTree()
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
            ACCOUNT_DATA.type === 'nextcloud'
          )
        })
        it('should be ok if both server and local bookmark are removed', async function() {
          var adapter = account.server

          if (adapter.onSyncStart) await adapter.onSyncStart()
          var serverTree = await adapter.getBookmarksTree()
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
          const localTree = await account.localTree.getBookmarksTree()

          if (adapter.onSyncStart) await adapter.onSyncStart()
          serverTree = await adapter.getBookmarksTree()
          if (adapter.onSyncComplete) await adapter.onSyncComplete()

          // Root must also be equal in the assertion
          localTree.title = serverTree.title

          expectTreeEqual(localTree, serverTree)
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
            if (account1.server.onSyncStart) {
              await account1.server.onSyncStart()
            }
            let tree1 = await account1.server.getBookmarksTree()
            await Promise.all(
              tree1.children.map(async child => {
                if (child instanceof Folder) {
                  await account1.server.removeFolder(child.id)
                } else {
                  await account1.server.removeBookmark(child.id)
                }
              })
            )
            if (account1.server.onSyncComplete) {
              await account1.server.onSyncComplete()
            }
          }
          await account1.delete()
          await browser.bookmarks.removeTree(account2.getData().localRoot)
          if (ACCOUNT_DATA.type !== 'fake') {
            if (account1.server.onSyncStart) {
              await account1.server.onSyncStart()
            }
            let tree2 = await account2.server.getBookmarksTree()
            await Promise.all(
              tree2.children.map(async child => {
                if (child instanceof Folder) {
                  await account2.server.removeFolder(child.id)
                } else {
                  await account2.server.removeBookmark(child.id)
                }
              })
            )
            if (account1.server.onSyncComplete) {
              await account1.server.onSyncComplete()
            }
          }
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
          const serverTree = await adapter.getBookmarksTree()
          if (adapter.onSyncComplete) await adapter.onSyncComplete()

          const tree1 = await account1.localTree.getBookmarksTree()
          const tree2 = await account2.localTree.getBookmarksTree()
          tree1.title = tree2.title
          expectTreeEqual(tree1, tree2)
          tree2.title = serverTree.title
          expectTreeEqual(tree2, serverTree)

          await browser.bookmarks.update(bookmark1.id, {
            title: 'NEW TITLE FROM ACC1'
          })
          await account1.sync()

          const bm2Id = (await account2.localTree.getBookmarksTree())
            .children[0].children[0].children[0].id
          const newBookmark2 = await browser.bookmarks.update(bm2Id, {
            title: 'NEW TITLE FROM ACC2'
          })
          await account2.sync()

          await account1.sync()

          if (adapter.onSyncStart) await adapter.onSyncStart()
          const serverTreeAfterSyncing = await adapter.getBookmarksTree()
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
            ACCOUNT_DATA.type === 'nextcloud'
          )

          const tree1AfterSyncing = await account1.localTree.getBookmarksTree()
          const tree2AfterSyncing = await account2.localTree.getBookmarksTree()
          expectTreeEqual(
            tree1AfterSyncing,
            tree2AfterSyncing,
            ACCOUNT_DATA.type === 'nextcloud'
          )
          tree2AfterSyncing.title = serverTreeAfterSyncing.title
          expectTreeEqual(
            tree2AfterSyncing,
            serverTreeAfterSyncing,
            ACCOUNT_DATA.type === 'nextcloud'
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
          const tree1 = await account1.localTree.getBookmarksTree()
          await account1.sync()
          await account2.sync()

          if (adapter.onSyncStart) await adapter.onSyncStart()
          const serverTreeAfterFirstSync = await adapter.getBookmarksTree()
          if (adapter.onSyncComplete) await adapter.onSyncComplete()

          const tree1AfterFirstSync = await account1.localTree.getBookmarksTree()
          const tree2AfterFirstSync = await account2.localTree.getBookmarksTree()
          expectTreeEqual(
            tree1AfterFirstSync,
            tree1,
            ACCOUNT_DATA.type === 'nextcloud'
          )
          serverTreeAfterFirstSync.title = tree1.title
          expectTreeEqual(
            serverTreeAfterFirstSync,
            tree1,
            ACCOUNT_DATA.type === 'nextcloud'
          )
          tree2AfterFirstSync.title = tree1.title
          expectTreeEqual(
            tree2AfterFirstSync,
            tree1,
            ACCOUNT_DATA.type === 'nextcloud'
          )
          console.log('First round ok')

          await browser.bookmarks.move(bookmark1.id, { parentId: fooFolder.id })
          console.log('acc1: Moved bookmark from bar into foo')

          const tree1BeforeSecondSync = await account1.localTree.getBookmarksTree()
          await account1.sync()

          if (adapter.onSyncStart) await adapter.onSyncStart()
          const serverTreeAfterSecondSync = await adapter.getBookmarksTree()
          if (adapter.onSyncComplete) await adapter.onSyncComplete()

          const tree1AfterSecondSync = await account1.localTree.getBookmarksTree()
          expectTreeEqual(
            tree1AfterSecondSync,
            tree1BeforeSecondSync,
            ACCOUNT_DATA.type === 'nextcloud'
          )
          serverTreeAfterSecondSync.title = tree1AfterSecondSync.title
          expectTreeEqual(
            serverTreeAfterSecondSync,
            tree1AfterSecondSync,
            ACCOUNT_DATA.type === 'nextcloud'
          )
          console.log('Second round first half ok')

          await account2.sync()

          if (adapter.onSyncStart) await adapter.onSyncStart()
          const serverTreeAfterThirdSync = await adapter.getBookmarksTree()
          if (adapter.onSyncComplete) await adapter.onSyncComplete()

          const tree2AfterThirdSync = await account2.localTree.getBookmarksTree()
          expectTreeEqual(
            tree2AfterThirdSync,
            tree1AfterSecondSync,
            ACCOUNT_DATA.type === 'nextcloud'
          )
          serverTreeAfterThirdSync.title = tree2AfterThirdSync.title
          expectTreeEqual(
            serverTreeAfterThirdSync,
            tree2AfterThirdSync,
            ACCOUNT_DATA.type === 'nextcloud'
          )
          console.log('Second round second half ok')

          console.log('acc1: final sync')
          await account1.sync()

          if (adapter.onSyncStart) await adapter.onSyncStart()
          const serverTreeAfterFinalSync = await adapter.getBookmarksTree()
          if (adapter.onSyncComplete) await adapter.onSyncComplete()

          const tree1AfterFinalSync = await account1.localTree.getBookmarksTree()
          expectTreeEqual(
            tree1AfterFinalSync,
            tree2AfterThirdSync,
            ACCOUNT_DATA.type === 'nextcloud'
          )
          tree2AfterThirdSync.title = serverTreeAfterFinalSync.title
          expectTreeEqual(
            tree2AfterThirdSync,
            serverTreeAfterFinalSync,
            ACCOUNT_DATA.type === 'nextcloud'
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
          const tree1 = await account1.localTree.getBookmarksTree()
          await account1.sync()
          await account2.sync()

          const serverTreeAfterFirstSync = await adapter.getBookmarksTree()
          const tree1AfterFirstSync = await account1.localTree.getBookmarksTree()
          const tree2AfterFirstSync = await account2.localTree.getBookmarksTree()
          expectTreeEqual(
            tree1AfterFirstSync,
            tree1,
            ACCOUNT_DATA.type === 'nextcloud'
          )
          serverTreeAfterFirstSync.title = tree1.title
          expectTreeEqual(
            serverTreeAfterFirstSync,
            tree1,
            ACCOUNT_DATA.type === 'nextcloud'
          )
          tree2AfterFirstSync.title = tree1.title
          expectTreeEqual(
            tree2AfterFirstSync,
            tree1,
            ACCOUNT_DATA.type === 'nextcloud'
          )
          console.log('First round ok')

          await browser.bookmarks.move(bookmark1.id, { parentId: fooFolder.id })
          console.log('acc1: Moved bookmark from bar into foo')

          const tree1BeforeSecondSync = await account1.localTree.getBookmarksTree()
          await account1.sync()

          const serverTreeAfterSecondSync = await adapter.getBookmarksTree()
          const tree1AfterSecondSync = await account1.localTree.getBookmarksTree()
          expectTreeEqual(
            tree1AfterSecondSync,
            tree1BeforeSecondSync,
            ACCOUNT_DATA.type === 'nextcloud'
          )
          serverTreeAfterSecondSync.title = tree1AfterSecondSync.title
          expectTreeEqual(
            serverTreeAfterSecondSync,
            tree1AfterSecondSync,
            ACCOUNT_DATA.type === 'nextcloud'
          )
          console.log('Second round first half ok')

          const bm2Id = (await account2.localTree.getBookmarksTree())
            .children[0].children[0].children[0].id
          await browser.bookmarks.move(bm2Id, {
            parentId: account2.getData().localRoot
          })
          console.log('acc2: Moved bookmark from bar into root')
          const tree2BeforeThirdSync = await account2.localTree.getBookmarksTree()
          await account2.sync()

          const serverTreeAfterThirdSync = await adapter.getBookmarksTree()
          const tree2AfterThirdSync = await account2.localTree.getBookmarksTree()
          expectTreeEqual(
            tree2AfterThirdSync,
            tree2BeforeThirdSync,
            ACCOUNT_DATA.type === 'nextcloud'
          )
          serverTreeAfterThirdSync.title = tree2AfterThirdSync.title
          expectTreeEqual(
            serverTreeAfterThirdSync,
            tree2AfterThirdSync,
            ACCOUNT_DATA.type === 'nextcloud'
          )
          console.log('Second round second half ok')

          console.log('acc1: final sync')
          await account1.sync()

          const serverTreeAfterFinalSync = await adapter.getBookmarksTree()
          const tree1AfterFinalSync = await account1.localTree.getBookmarksTree()
          expectTreeEqual(
            tree1AfterFinalSync,
            tree2AfterThirdSync,
            ACCOUNT_DATA.type === 'nextcloud'
          )
          tree2AfterThirdSync.title = serverTreeAfterFinalSync.title
          expectTreeEqual(
            tree2AfterThirdSync,
            serverTreeAfterFinalSync,
            ACCOUNT_DATA.type === 'nextcloud'
          )
        })
      })
    })
  })
})

function expectTreeEqual(tree1, tree2, ignoreEmptyFolders) {
  try {
    expect(tree1.title).to.equal(tree2.title)
    if (tree2.url) {
      expect(tree1.url).to.equal(tree2.url)
    } else {
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
      let children1 = ignoreEmptyFolders
        ? tree1.children.filter(child => !hasNoBookmarks(child))
        : tree1.children
      let children2 = ignoreEmptyFolders
        ? tree2.children.filter(child => !hasNoBookmarks(child))
        : tree2.children
      expect(children1).to.have.length(children2.length)
      children2.forEach((child2, i) => {
        expectTreeEqual(children1[i], child2, ignoreEmptyFolders)
      })
    }
  } catch (e) {
    console.log(
      'Trees are not equal:\n',
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
