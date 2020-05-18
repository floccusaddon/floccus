import chai from 'chai'
import chaiAsPromised from 'chai-as-promised'
import Account from '../lib/Account'
import { Bookmark, Folder } from '../lib/Tree'
import browser from '../lib/browser-api'

const AsyncParallel = require('async-parallel')

chai.use(chaiAsPromised)
const expect = chai.expect

describe('Floccus', function() {
  this.timeout(60000) // no test should run longer than 60s
  this.slow(20000) // 20s is slow

  let SERVER, CREDENTIALS, ACCOUNTS
  SERVER =
    (new URL(window.location.href)).searchParams.get('server') ||
    'http://localhost'
  CREDENTIALS = {
    username: 'admin',
    password: (new URL(window.location.href)).searchParams.get('pw') || 'admin'
  }
  ACCOUNTS = [
    Account.getDefaultValues('fake'),
    {
      ...Account.getDefaultValues('fake'),
      parallel: true
    },
    {
      type: 'nextcloud-legacy',
      url: SERVER,
      ...CREDENTIALS
    },
    {
      type: 'nextcloud-legacy',
      url: SERVER,
      serverRoot: '/my folder/some subfolder',
      ...CREDENTIALS
    },
    {
      type: 'nextcloud-legacy',
      url: SERVER,
      parallel: true,
      ...CREDENTIALS
    },
    {
      type: 'nextcloud-folders',
      url: SERVER,
      ...CREDENTIALS
    },
    {
      type: 'nextcloud-folders',
      url: SERVER,
      serverRoot: '/my folder/some subfolder',
      ...CREDENTIALS
    },
    {
      type: 'nextcloud-folders',
      url: SERVER,
      parallel: true,
      ...CREDENTIALS
    },
    {
      type: 'nextcloud-folders',
      url: SERVER,
      serverRoot: '/my folder/some subfolder',
      parallel: true,
      ...CREDENTIALS
    },
    {
      type: 'webdav',
      url: `${SERVER}/remote.php/webdav/`,
      bookmark_file: 'bookmarks.xbel',
      ...CREDENTIALS
    },
    {
      type: 'webdav',
      url: `${SERVER}/remote.php/webdav/`,
      bookmark_file: 'bookmarks.xbel',
      parallel: true,
      ...CREDENTIALS
    }
  ]

  before(async function() {
    const background = await browser.runtime.getBackgroundPage()
    background.controller.setEnabled(false)
  })
  after(async function() {
    const background = await browser.runtime.getBackgroundPage()
    background.controller.setEnabled(true)
  })

  ACCOUNTS.forEach(ACCOUNT_DATA => {
    describe(`${ACCOUNT_DATA.type} ${
      ACCOUNT_DATA.parallel ? 'parallel' : 'standard'
    }-${ACCOUNT_DATA.serverRoot ? 'subfolder' : 'root'} Account`, function() {
      let account
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
    })
    describe(`${ACCOUNT_DATA.type} ${
      ACCOUNT_DATA.parallel ? 'parallel' : 'standard'
    }-${ACCOUNT_DATA.serverRoot ? 'subfolder' : 'root'} Sync`, function() {
      context('with one client', function() {
        let account
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
          const adapter = account.server
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
          const adapter = account.server
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
          const adapter = account.server
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
          const adapter = account.server
          expect(
            (await adapter.getBookmarksTree(true)).children
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
          const adapter = account.server
          if (adapter.onSyncStart) await adapter.onSyncStart()
          const serverTree = await adapter.getBookmarksTree(true)
          const fooFolderId = await adapter.createFolder(serverTree.id, 'foo')
          const barFolderId = await adapter.createFolder(fooFolderId, 'bar')
          const serverMark = {
            title: 'url',
            url: 'http://ur.l/',
            parentId: barFolderId
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
            ignoreEmptyFolders(ACCOUNT_DATA)
          )
        })
        it('should update local bookmarks on server changes', async function() {
          const adapter = account.server

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
          const adapter = account.server
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
          const adapter = account.server
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
          const adapter = account.server
          expect(
            (await adapter.getBookmarksTree(true)).children
          ).to.have.lengthOf(0)

          // create bookmark on server
          if (adapter.onSyncStart) await adapter.onSyncStart()
          const serverTree = await adapter.getBookmarksTree(true)
          const fooFolderId = await adapter.createFolder(serverTree.id, 'foo')
          const serverMark1 = {
            title: 'url',
            url: 'http://ur.l/foo/bar?a=b&foo=b%C3%A1r+foo'
          }
          const serverMark2 = {
            title: 'url2',
            url: 'http://ur2.l/foo/bar?a=b&foo=b%C3%A1r+foo'
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
        it('should handle duplicate URLs with different protocols', async function() {
          const adapter = account.server
          expect(
            (await adapter.getBookmarksTree(true)).children
          ).to.have.lengthOf(0)

          // create bookmark locally
          const localRoot = account.getData().localRoot
          const localMark1 = {
            title: 'url',
            url: 'http://ur.l'
          }
          const localMark2 = {
            title: 'url2',
            url: 'https://ur.l'
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

          const tree = await adapter.getBookmarksTree(true)
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
            ignoreEmptyFolders(ACCOUNT_DATA)
          )
        })
        it('should not fail when moving both folders and contents', async function() {
          const adapter = account.server
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
          await browser.bookmarks.create({
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
          const adapter = account.server
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
          const adapter = account.server
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
        it('should be able to delete a server folder', async function() {
          const adapter = account.server
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

          const tree = await adapter.getBookmarksTree(true)
          expectTreeEqual(
            tree,
            new Folder({
              title: tree.title,
              children: []
            }),
            ignoreEmptyFolders(ACCOUNT_DATA)
          )
        })
        it('should be able to delete a local folder', async function() {
          const adapter = account.server
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
          await browser.bookmarks.create({
            title: 'url',
            url: 'http://ur.l/',
            parentId: barFolder.id
          })
          await account.sync()
          expect(account.getData().error).to.not.be.ok

          if (adapter.onSyncStart) await adapter.onSyncStart()
          let tree = await adapter.getBookmarksTree(true)
          await adapter.removeFolder(tree.children[0].id)
          if (adapter.onSyncComplete) await adapter.onSyncComplete()

          await account.sync()
          expect(account.getData().error).to.not.be.ok

          tree = await adapter.getBookmarksTree(true)
          expectTreeEqual(
            tree,
            new Folder({
              title: tree.title,
              children: []
            }),
            ignoreEmptyFolders(ACCOUNT_DATA)
          )
        })
        it('should be ok if both server and local bookmark are removed', async function() {
          const adapter = account.server

          if (adapter.onSyncStart) await adapter.onSyncStart()
          let serverTree = await adapter.getBookmarksTree(true)
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
        it('should remove duplicates in the same folder', async function() {
          const localRoot = account.getData().localRoot

          const adapter = account.server
          expect(
            (await adapter.getBookmarksTree(true)).children
          ).to.have.lengthOf(0)

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
        it('should move items successfully even into new folders', async function() {
          const localRoot = account.getData().localRoot

          const adapter = account.server
          expect(
            (await adapter.getBookmarksTree(true)).children
          ).to.have.lengthOf(0)

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

          const tree = await adapter.getBookmarksTree(true)
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
            ignoreEmptyFolders(ACCOUNT_DATA)
          )
        })
        it('should move items successfully when mixing creation and moving (1)', async function() {
          const localRoot = account.getData().localRoot

          const adapter = account.server
          expect(
            (await adapter.getBookmarksTree(true)).children
          ).to.have.lengthOf(0)

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

          const tree = await adapter.getBookmarksTree(true)
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
            ignoreEmptyFolders(ACCOUNT_DATA)
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
            ignoreEmptyFolders(ACCOUNT_DATA)
          )
        })
        it('should move items successfully when mixing creation and moving (2)', async function() {
          const localRoot = account.getData().localRoot

          const adapter = account.server
          expect(
            (await adapter.getBookmarksTree(true)).children
          ).to.have.lengthOf(0)

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

          const tree = await adapter.getBookmarksTree(true)
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
            ignoreEmptyFolders(ACCOUNT_DATA)
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
            ignoreEmptyFolders(ACCOUNT_DATA)
          )
        })
        it('should integrate existing items from both sides', async function() {
          const localRoot = account.getData().localRoot

          const adapter = account.server
          expect(
            (await adapter.getBookmarksTree(true)).children
          ).to.have.lengthOf(0)

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

          await adapter.onSyncStart()
          const aFolderId = await adapter.createFolder(
            (await adapter.getBookmarksTree()).id,
            'a'
          )
          const bookmark1Id = await adapter.createBookmark(
            new Bookmark({
              title: 'url',
              url: 'http://ur.l',
              parentId: aFolderId
            })
          )

          const bFolderId = await adapter.createFolder(aFolderId, 'b')
          const bookmark2Id = await adapter.createBookmark(
            new Bookmark({
              title: 'url2',
              url: 'http://ur.l/dalfk',
              parentId: bFolderId
            })
          )

          await adapter.onSyncComplete()

          await account.sync() // propagate to server
          expect(account.getData().error).to.not.be.ok

          await account.sync() // propagate to server
          expect(account.getData().error).to.not.be.ok

          const tree = await adapter.getBookmarksTree(true)
          expectTreeEqual(
            tree,
            new Folder({
              title: tree.title,
              children: [
                new Folder({
                  title: 'a',
                  children: [
                    new Bookmark({ title: 'url', url: 'http://ur.l/' }),
                    new Folder({
                      title: 'b',
                      children: [
                        new Bookmark({
                          title: 'url2',
                          url: 'http://ur.l/dalfk'
                        })
                      ]
                    })
                  ]
                })
              ]
            }),
            ignoreEmptyFolders(ACCOUNT_DATA)
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
                    new Bookmark({ title: 'url', url: 'http://ur.l/' }),
                    new Folder({
                      title: 'b',
                      children: [
                        new Bookmark({
                          title: 'url2',
                          url: 'http://ur.l/dalfk'
                        })
                      ]
                    })
                  ]
                })
              ]
            }),
            ignoreEmptyFolders(ACCOUNT_DATA)
          )

          expect(localTree.findBookmark(bookmark1.id)).to.be.ok
          expect(localTree.findBookmark(bookmark2.id)).to.be.ok
        })
        if (~ACCOUNT_DATA.type.indexOf('nextcloud-legacy')) {
          it('should leave alone unaccepted bookmarks entirely', async function() {
            const localRoot = account.getData().localRoot

            const adapter = account.server
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
            await browser.bookmarks.create({
              title: 'url',
              url: 'http://ur.l/',
              parentId: barFolder.id
            })
            await browser.bookmarks.create({
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
            const adapter = account.server
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
            const adapter = account.server
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
            await browser.bookmarks.create({
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
            const adapter = account.server
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
            const adapter = account.server
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
            const adapter = account.server
            expect(
              (await adapter.getBookmarksTree(true)).children
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
            const adapter = account.server
            if (adapter.onSyncStart) await adapter.onSyncStart()
            const serverTree = await adapter.getBookmarksTree(true)
            const fooFolderId = await adapter.createFolder(serverTree.id, 'foo')
            const barFolderId = await adapter.createFolder(fooFolderId, 'bar')
            const serverMark = {
              title: 'url',
              url: 'http://ur.l/',
              parentId: barFolderId
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
              ignoreEmptyFolders(ACCOUNT_DATA)
            )
          })
          it('should update local bookmarks on server changes', async function() {
            await account.setData({ ...account.getData(), strategy: 'slave' })
            const adapter = account.server

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
            await account.setData({ ...account.getData(), strategy: 'slave' })
            const adapter = account.server
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
            const adapter = account.server
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
            const adapter = account.server
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
            const originalTree = await account.localTree.getBookmarksTree(true)
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
            const adapter = account.server
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
            const originalTree = await account.localTree.getBookmarksTree(true)
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
            const adapter = account.server
            expect(
              (await adapter.getBookmarksTree(true)).children
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
            await account.setData({
              ...account.getData(),
              strategy: 'overwrite'
            })

            await browser.bookmarks.move(barFolder.id, {
              parentId: localRoot
            })
            const originalTree = await account.localTree.getBookmarksTree(true)
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
            const adapter = account.server
            if (adapter.onSyncStart) await adapter.onSyncStart()
            const originalTree = await account.localTree.getBookmarksTree(true)
            const serverTree = await adapter.getBookmarksTree(true)
            const fooFolderId = await adapter.createFolder(serverTree.id, 'foo')
            const barFolderId = await adapter.createFolder(fooFolderId, 'bar')
            const serverMark = {
              title: 'url',
              url: 'http://ur.l/',
              parentId: barFolderId
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
              ignoreEmptyFolders(ACCOUNT_DATA)
            )
          })
          it("shouldn't update local bookmarks on server changes", async function() {
            const adapter = account.server

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
            const originalTree = await account.localTree.getBookmarksTree(true)
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
            const adapter = account.server
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
            const originalTree = await account.localTree.getBookmarksTree(true)
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
        this.timeout(60 * 60000) // timeout after 20mins
        let account1, account2
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
          const adapter = account1.server

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
          const adapter = account1.server

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
          const serverTreeAfterFirstSync = await adapter.getBookmarksTree(true)
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
          const serverTreeAfterSecondSync = await adapter.getBookmarksTree(true)
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
          const serverTreeAfterThirdSync = await adapter.getBookmarksTree(true)
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
          const serverTreeAfterFinalSync = await adapter.getBookmarksTree(true)
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
        it('should handle creations inside deletions gracefully', async function() {
          const adapter = account1.server

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

          if (adapter.onSyncStart) await adapter.onSyncStart()
          const serverTreeAfterFirstSync = await adapter.getBookmarksTree(true)
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

          if (adapter.onSyncStart) await adapter.onSyncStart()
          const serverTreeAfterThirdSync = await adapter.getBookmarksTree(true)
          if (adapter.onSyncComplete) await adapter.onSyncComplete()

          const tree1AfterThirdSync = await account1.localTree.getBookmarksTree(
            true
          )
          expectTreeEqual(
            tree1AfterThirdSync,
            tree2BeforeSecondSync,
            ignoreEmptyFolders(ACCOUNT_DATA)
          )
          serverTreeAfterThirdSync.title = tree2BeforeSecondSync.title
          expectTreeEqual(
            serverTreeAfterThirdSync,
            tree2BeforeSecondSync,
            ignoreEmptyFolders(ACCOUNT_DATA)
          )

          console.log('Second round second half ok')

          console.log('acc2: final sync')
          await account2.sync()
          expect(account2.getData().error).to.not.be.ok

          if (adapter.onSyncStart) await adapter.onSyncStart()
          const serverTreeAfterFinalSync = await adapter.getBookmarksTree(true)
          if (adapter.onSyncComplete) await adapter.onSyncComplete()

          const tree2AfterFinalSync = await account2.localTree.getBookmarksTree(
            true
          )
          expectTreeEqual(
            tree2AfterFinalSync,
            tree2BeforeSecondSync,
            ignoreEmptyFolders(ACCOUNT_DATA)
          )
          tree2BeforeSecondSync.title = serverTreeAfterFinalSync.title
          expectTreeEqual(
            serverTreeAfterFinalSync,
            tree2BeforeSecondSync,
            ignoreEmptyFolders(ACCOUNT_DATA)
          )
        })
        it('should synchronize ordering', async function() {
          if (ACCOUNT_DATA.type === 'nextcloud-legacy') return this.skip()
          const adapter = account1.server
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

        // Skipping this, because nextcloud adapter currently
        // isn't able to track bookmarks across dirs, thus in this
        // scenario both bookmarks survive :/
        it.skip('should propagate moves using "last write wins"', async function() {
          const adapter = account1.server

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

          const serverTreeAfterFirstSync = await adapter.getBookmarksTree(true)
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

          const serverTreeAfterSecondSync = await adapter.getBookmarksTree(true)
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

          const serverTreeAfterThirdSync = await adapter.getBookmarksTree(true)
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

          const serverTreeAfterFinalSync = await adapter.getBookmarksTree(true)
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
    })
  })

  ACCOUNTS.forEach(ACCOUNT_DATA => {
    describe(`${ACCOUNT_DATA.type} benchmark ${
      ACCOUNT_DATA.parallel ? 'parallel' : 'standard'
    }-${ACCOUNT_DATA.serverRoot ? 'subfolder' : 'root'} Account`, function() {
      context('with two clients', function() {
        this.timeout(60 * 60000) // timeout after 20mins
        let account1, account2
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

        it('should handle deep hierarchies with lots of bookmarks', async function() {
          const adapter = account1.server

          const localRoot = account1.getData().localRoot
          let bookmarks = 0
          let folders = 0
          let magicFolder, magicBookmark
          const createTree = async(parentId, i, j) => {
            const len = Math.abs(i - j)
            for (let k = i; k < j; k++) {
              const newBookmark = await browser.bookmarks.create({
                title: 'url' + k,
                url: 'http://ur.l/' + parentId + '/' + k,
                parentId
              })
              bookmarks++
              if (bookmarks === 33) magicBookmark = newBookmark
            }

            if (len < 4) return

            const step = Math.floor(len / 4)
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

          await createTree(localRoot, 0, 100)

          const tree1Initial = await account1.localTree.getBookmarksTree(true)
          await account1.sync()
          expect(account1.getData().error).to.not.be.ok
          await account2.sync()
          expect(account2.getData().error).to.not.be.ok

          if (adapter.onSyncStart) await adapter.onSyncStart()
          const serverTreeAfterFirstSync = await adapter.getBookmarksTree(true)
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
          expect(account1.getData().error).to.not.be.ok

          if (adapter.onSyncStart) await adapter.onSyncStart()
          const serverTreeAfterSecondSync = await adapter.getBookmarksTree(true)
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
          expect(account2.getData().error).to.not.be.ok

          if (adapter.onSyncStart) await adapter.onSyncStart()
          const serverTreeAfterThirdSync = await adapter.getBookmarksTree(true)
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
          expect(account1.getData().error).to.not.be.ok

          if (adapter.onSyncStart) await adapter.onSyncStart()
          const serverTreeAfterFinalSync = await adapter.getBookmarksTree(true)
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

        it('should handle fuzzed changes', async function() {
          const adapter = account1.server

          const localRoot = account1.getData().localRoot
          let bookmarks = []
          let folders = []
          const createTree = async(parentId, i, j) => {
            const len = Math.abs(i - j)
            for (let k = i; k < j; k++) {
              const newBookmark = await browser.bookmarks.create({
                title: 'url' + parentId + '/' + k,
                url: 'http://ur.l/' + parentId + '/' + k,
                parentId
              })
              bookmarks.push(newBookmark)
            }

            if (len < 4) return

            const step = Math.floor(len / 4)
            for (let k = i; k < j; k += step) {
              const newFolder = await browser.bookmarks.create({
                title: 'folder' + k,
                parentId
              })
              folders.push(newFolder)
              await createTree(newFolder.id, k, k + step)
            }
          }

          await createTree(localRoot, 0, 100)

          const tree1Initial = await account1.localTree.getBookmarksTree(true)
          await account1.sync()
          expect(account1.getData().error).to.not.be.ok
          console.log('Initial round account1 completed')
          await account2.sync()
          expect(account2.getData().error).to.not.be.ok
          console.log('Initial round account2 completed')

          if (adapter.onSyncStart) await adapter.onSyncStart()
          const serverTreeAfterFirstSync = await adapter.getBookmarksTree(true)
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
          console.log('Initial round: first tree ok')
          serverTreeAfterFirstSync.title = tree1Initial.title
          expectTreeEqual(
            serverTreeAfterFirstSync,
            tree1Initial,
            ignoreEmptyFolders(ACCOUNT_DATA)
          )
          console.log('Initial round: server tree ok')
          tree2AfterFirstSync.title = tree1Initial.title
          expectTreeEqual(
            tree2AfterFirstSync,
            tree1Initial,
            ignoreEmptyFolders(ACCOUNT_DATA)
          )
          console.log('Initial round: second tree ok')
          console.log('Initial round ok')

          for (let i = 0; i < 25; i++) {
            let success = false
            let magicBookmark
            let magicFolder1
            let magicFolder2
            let magicFolder3
            while (!success) {
              magicBookmark = bookmarks[(bookmarks.length * Math.random()) | 0]
              magicFolder1 = folders[(folders.length * Math.random()) | 0]
              magicFolder2 = folders[(folders.length * Math.random()) | 0]
              magicFolder3 = folders[(folders.length * Math.random()) | 0]

              try {
                await browser.bookmarks.move(magicBookmark.id, {
                  parentId: magicFolder1.id
                })
                await browser.bookmarks.move(magicFolder2.id, {
                  parentId: magicFolder3.id
                })
                success = true
              } catch (e) {
                console.log(e)
              }
            }
          }
          console.log(' acc1: Moved items')

          const tree1BeforeSync = await account1.localTree.getBookmarksTree(
            true
          )
          await account1.sync()
          expect(account1.getData().error).to.not.be.ok
          console.log('second round: account1 completed')

          if (adapter.onSyncStart) await adapter.onSyncStart()
          const serverTreeAfterSync = await adapter.getBookmarksTree(true)
          if (adapter.onSyncComplete) await adapter.onSyncComplete()

          const tree1AfterSync = await account1.localTree.getBookmarksTree(true)
          expectTreeEqual(
            tree1AfterSync,
            tree1BeforeSync,
            ignoreEmptyFolders(ACCOUNT_DATA)
          )
          console.log('Second round: local tree tree ok')
          serverTreeAfterSync.title = tree1AfterSync.title
          expectTreeEqual(
            serverTreeAfterSync,
            tree1AfterSync,
            ignoreEmptyFolders(ACCOUNT_DATA)
          )
          console.log('Second round: server tree tree ok')
          console.log('first half ok')

          await account2.sync()
          expect(account2.getData().error).to.not.be.ok
          console.log('second round: account1 completed')

          if (adapter.onSyncStart) await adapter.onSyncStart()
          const serverTreeAfterSecondSync = await adapter.getBookmarksTree(true)
          if (adapter.onSyncComplete) await adapter.onSyncComplete()

          const tree2AfterSecondSync = await account2.localTree.getBookmarksTree(
            true
          )
          expectTreeEqual(
            tree2AfterSecondSync,
            tree1AfterSync,
            ignoreEmptyFolders(ACCOUNT_DATA)
          )
          console.log('Second round: second local tree tree ok')
          serverTreeAfterSecondSync.title = tree2AfterSecondSync.title
          expectTreeEqual(
            serverTreeAfterSecondSync,
            tree2AfterSecondSync,
            ignoreEmptyFolders(ACCOUNT_DATA)
          )
          console.log('Second round: second server tree tree ok')
          console.log('second half ok')

          console.log('final sync')
          await account1.sync()
          expect(account1.getData().error).to.not.be.ok
          console.log('final sync completed')

          if (adapter.onSyncStart) await adapter.onSyncStart()
          const serverTreeAfterFinalSync = await adapter.getBookmarksTree(true)
          if (adapter.onSyncComplete) await adapter.onSyncComplete()

          const tree1AfterFinalSync = await account1.localTree.getBookmarksTree(
            true
          )
          expectTreeEqual(
            tree1AfterFinalSync,
            tree2AfterSecondSync,
            ignoreEmptyFolders(ACCOUNT_DATA)
          )
          console.log('Final round: local tree tree ok')
          tree2AfterSecondSync.title = serverTreeAfterFinalSync.title
          expectTreeEqual(
            tree2AfterSecondSync,
            serverTreeAfterFinalSync,
            ignoreEmptyFolders(ACCOUNT_DATA)
          )
          console.log('Final round: server tree tree ok')
        })
      })
    })
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
