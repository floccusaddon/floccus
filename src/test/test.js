import chai from 'chai'
import chaiAsPromised from 'chai-as-promised'
import random from 'random'
import seedrandom from 'seedrandom'
import Account from '../lib/Account'
import { Bookmark, Folder } from '../lib/Tree'
import browser from '../lib/browser-api'
import Crypto from '../lib/Crypto'
import * as AsyncParallel from 'async-parallel'
import DefunctCrypto from '../lib/DefunctCrypto'
import Controller from '../lib/Controller'
import FakeAdapter from '../lib/adapters/Fake'

chai.use(chaiAsPromised)
const expect = chai.expect

let expectTreeEqual = function(tree1, tree2, ignoreEmptyFolders, checkOrder = true) {
  try {
    expect(tree1.title).to.equal(tree2.title)
    if (tree2.url) {
      expect(tree1.url).to.equal(tree2.url)
    } else {
      if (checkOrder === false) {
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

describe('Floccus', function() {
  this.timeout(60000) // no test should run longer than 60s
  this.slow(20000) // 20s is slow

  const params = (new URL(window.location.href)).searchParams
  let SERVER, CREDENTIALS, ACCOUNTS, APP_VERSION, SEED
  SERVER =
    params.get('server') ||
    'http://localhost'
  CREDENTIALS = {
    username: 'admin',
    password: params.get('password') || 'admin'
  }
  APP_VERSION = params.get('app_version') || 'stable'

  SEED = (new URL(window.location.href)).searchParams.get('seed') || Math.random() + ''
  console.log('RANDOMNESS SEED', SEED)
  random.use(seedrandom(SEED))

  ACCOUNTS = [
    FakeAdapter.getDefaultValues(),
    {
      ...FakeAdapter.getDefaultValues(),
      noCache: true,
    },
    {
      type: 'nextcloud-bookmarks',
      url: SERVER,
      ...CREDENTIALS
    },
    {
      type: 'nextcloud-bookmarks',
      url: SERVER,
      oldAPIs: true,
      ...CREDENTIALS
    },
    {
      type: 'nextcloud-bookmarks',
      url: SERVER,
      serverRoot: '/my folder/some subfolder',
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
      passphrase: random.float(),
      ...CREDENTIALS
    },
    {
      type: 'webdav',
      url: `${SERVER}/remote.php/webdav/`,
      bookmark_file: 'bookmarks.html',
      bookmark_file_type: 'html',
      ...CREDENTIALS
    },
    {
      type: 'webdav',
      url: `${SERVER}/remote.php/webdav/`,
      bookmark_file: 'bookmarks.html',
      bookmark_file_type: 'html',
      passphrase: random.float(),
      ...CREDENTIALS
    },
    {
      type: 'google-drive',
      bookmark_file: random.float() + '.xbel',
      password: '',
      refreshToken: CREDENTIALS.password,
    },
    {
      type: 'google-drive',
      bookmark_file: random.float() + '.xbel',
      password: random.float(),
      refreshToken: CREDENTIALS.password,
    },
  ]

  before(async function() {
    const controller = await Controller.getSingleton()
    controller.setEnabled(false)
  })
  after(async function() {
    const controller = await Controller.getSingleton()
    controller.setEnabled(true)
  })

  describe('Crypto', function() {
    it('should encrypt and decrypt correctly', async function() {
      const passphrase = 'test'
      const salt = 'blah'
      const message = 'I don\'t know'
      const payload = await Crypto.encryptAES(passphrase, message, salt)
      console.log(payload)
      const cleartext = await Crypto.decryptAES(passphrase, payload, salt)
      expect(cleartext).to.equal(message)
      console.log(cleartext)
      console.log(message)
    })

    it('should encrypt and decrypt correctly (even with defunct crypto)', async function() {
      const passphrase = 'test'
      const message = 'I don\'t know'
      const payload = await DefunctCrypto.encryptAES(passphrase, DefunctCrypto.iv, message)
      console.log(payload)
      const cleartext = await DefunctCrypto.decryptAES(passphrase, DefunctCrypto.iv, payload)
      expect(cleartext).to.equal(message)
      console.log(cleartext)
      console.log(message)
    })
  })

  ACCOUNTS.forEach(ACCOUNT_DATA => {
    describe(`${stringifyAccountData(ACCOUNT_DATA)} test ${ACCOUNT_DATA.serverRoot ? 'subfolder' : 'root'} Account`, function() {
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
        expect(account.getData()).to.deep.equal({...account.getData(), ...ACCOUNT_DATA})

        const secondInstance = await Account.get(account.id)
        expect(secondInstance.getData()).to.deep.equal({...secondInstance.getData(), ...ACCOUNT_DATA})
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
            if (ACCOUNT_DATA.type === 'nextcloud-bookmarks' && ACCOUNT_DATA.oldAPIs) {
              // account.server.hasFeatureHashing = false
              account.server.hasFeatureChildren = false
            }
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
            if (!account) return
            try {
              await browser.bookmarks.removeTree(account.getData().localRoot)
            } catch (e) {
              console.error(e)
            }
            if (ACCOUNT_DATA.type !== 'fake') {
              await account.setData({ ...account.getData(), serverRoot: null })
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
              const fileList = await account.server.listFiles('name = ' + "'" + account.server.bookmark_file + "'")
              const file = fileList.files[0]
              if (file) {
                await account.server.deleteFile(file.id)
              }
            }
            await account.delete()
          })
          it('should create local bookmarks on the server', async function() {
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
              ignoreEmptyFolders(ACCOUNT_DATA)
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
              ignoreEmptyFolders(ACCOUNT_DATA)
            )
          })
          it('should update the server on local removals', async function() {
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
              ignoreEmptyFolders(ACCOUNT_DATA)
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
              ignoreEmptyFolders(ACCOUNT_DATA)
            )
          })
          it('should create server bookmarks locally', async function() {
            const adapter = account.server
            const serverTree = await getAllBookmarks(account)
            let fooFolderId, barFolderId, serverMark
            await withSyncConnection(account, async() => {
              fooFolderId = await adapter.createFolder(new Folder({parentId: serverTree.id, title: 'foo'}))
              barFolderId = await adapter.createFolder(new Folder({parentId: fooFolderId, title: 'bar'}))
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
              ignoreEmptyFolders(ACCOUNT_DATA)
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
              fooFolderId = await adapter.createFolder(new Folder({parentId: serverTree.id, title: 'foo'}))
              barFolderId = await adapter.createFolder(new Folder({parentId: fooFolderId, title: 'bar'}))
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
              ignoreEmptyFolders(ACCOUNT_DATA)
            )
          })
          it('should update local bookmarks on server removals', async function() {
            if (ACCOUNT_DATA.noCache) {
              return this.skip()
            }
            const adapter = account.server

            const serverTree = await getAllBookmarks(account)
            if (adapter.onSyncStart) await adapter.onSyncStart()
            const fooFolderId = await adapter.createFolder(new Folder({parentId: serverTree.id, title: 'foo'}))
            const barFolderId = await adapter.createFolder(new Folder({parentId: fooFolderId, title: 'bar'}))
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
              await adapter.removeBookmark({...serverMark, id: serverMarkId})
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
              ignoreEmptyFolders(ACCOUNT_DATA)
            )
          })
          it('should not delete additions while sync is running', async function() {
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
              ignoreEmptyFolders(ACCOUNT_DATA)
            )
          })
          it('should be able to handle duplicates', async function() {
            expect(
              (await getAllBookmarks(account)).children
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
              ignoreEmptyFolders(ACCOUNT_DATA)
            )
          })
          it('should deduplicate unnormalized URLs', async function() {
            const adapter = account.server
            expect(
              (await getAllBookmarks(account)).children
            ).to.have.lengthOf(0)

            // create bookmark on server
            const serverTree = await getAllBookmarks(account)
            if (adapter.onSyncStart) await adapter.onSyncStart()
            const fooFolderId = await adapter.createFolder(new Folder({parentId: serverTree.id, title: 'foo'}))
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
              ignoreEmptyFolders(ACCOUNT_DATA)
            )
          })
          it('should deduplicate unnormalized URLs without getting stuck', async function() {
            if (ACCOUNT_DATA.type === 'nextcloud-bookmarks' && (APP_VERSION !== 'stable' && APP_VERSION !== 'master' && APP_VERSION !== 'stable3')) {
              this.skip()
            }
            expect(
              (await getAllBookmarks(account)).children
            ).to.have.lengthOf(0)

            // create bookmark locally
            const localRoot = account.getData().localRoot
            const localMark1 = {
              title: 'url',
              url: 'http://nextcloud.com/'
            }
            const localMark2 = {
              title: 'url',
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
              ignoreEmptyFolders(ACCOUNT_DATA)
            )
          })
          it('should not fail when moving both folders and contents', async function() {
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
                      }),
                      new Bookmark({ title: 'test', url: 'http://ureff.l/' }),
                    ]
                  })
                ]
              }),
              ignoreEmptyFolders(ACCOUNT_DATA)
            )
          })
          it('should not fail when both moving folders and deleting their contents', async function() {
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
              ignoreEmptyFolders(ACCOUNT_DATA)
            )
          })
          it('should handle strange characters well', async function() {
            expect(
              (await getAllBookmarks(account)).children
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
              ignoreEmptyFolders(ACCOUNT_DATA)
            )
          })
          it('should be able to delete a local folder', async function() {
            if (ACCOUNT_DATA.noCache) {
              return this.skip()
            }
            const adapter = account.server
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
            await browser.bookmarks.create({
              title: 'url',
              url: 'http://ur.l/',
              parentId: barFolder.id
            })
            await account.sync()
            expect(account.getData().error).to.not.be.ok

            let tree = await getAllBookmarks(account)
            await withSyncConnection(account, async() => {
              await adapter.removeFolder({id: tree.children[0].id})
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
              ignoreEmptyFolders(ACCOUNT_DATA)
            )
          })
          it('should be ok if both server and local bookmark are removed', async function() {
            const adapter = account.server
            let serverTree = await getAllBookmarks(account)
            if (adapter.onSyncStart) await adapter.onSyncStart()
            const fooFolderId = await adapter.createFolder(new Folder({parentId: serverTree.id, title: 'foo'}))
            const barFolderId = await adapter.createFolder(new Folder({parentId: fooFolderId, title: 'bar'}))
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

            await withSyncConnection(account, async() => {
              await adapter.removeBookmark({...serverMark, id: serverMarkId})
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

            expect(
              (await getAllBookmarks(account)).children
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

            expect(
              (await getAllBookmarks(account)).children
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

            expect(
              (await getAllBookmarks(account)).children
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

            expect(
              (await getAllBookmarks(account)).children
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
          it('should move items without creating a folder loop', async function() {
            if (APP_VERSION !== 'stable' && APP_VERSION !== 'master') {
              this.skip()
            }
            const localRoot = account.getData().localRoot

            expect(
              (await getAllBookmarks(account)).children
            ).to.have.lengthOf(0)

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
              ignoreEmptyFolders(ACCOUNT_DATA)
            )

            const localTree = await account.localTree.getBookmarksTree(true)
            localTree.title = tree.title
            expectTreeEqual(
              localTree,
              tree,
              ignoreEmptyFolders(ACCOUNT_DATA)
            )
          })
          it('should integrate existing items from both sides', async function() {
            const localRoot = account.getData().localRoot

            const adapter = account.server
            expect(
              (await getAllBookmarks(account)).children
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

            let aFolderId, bookmark1Id,bFolderId,bookmark2Id
            await withSyncConnection(account, async() => {
              aFolderId = await adapter.createFolder(
                new Folder({parentId: (await adapter.getBookmarksTree()).id,
                  title: 'a'})
              )
              bookmark1Id = await adapter.createBookmark(
                new Bookmark({
                  title: 'url',
                  url: 'http://ur.l',
                  parentId: aFolderId
                })
              )

              bFolderId = await adapter.createFolder(new Folder({parentId: aFolderId, title: 'b'}))
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
              ignoreEmptyFolders(ACCOUNT_DATA),
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
              ignoreEmptyFolders(ACCOUNT_DATA),
              false /* checkOrder */
            )

            expect(localTree.findBookmark(bookmark1.id)).to.be.ok
            expect(localTree.findBookmark(bookmark2.id)).to.be.ok
          })
          it('should error when deleting too much local data', async function() {
            if (ACCOUNT_DATA.noCache) {
              this.skip()
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
          })
          it('should leave alone unaccepted bookmarks entirely', async function() {
            if (!~ACCOUNT_DATA.type.indexOf('nextcloud')) {
              this.skip()
            }
            const localRoot = account.getData().localRoot

            expect(
              (await getAllBookmarks(account)).children
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
              ignoreEmptyFolders(ACCOUNT_DATA),
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
                            url: 'javascript:void(0)'
                          })
                        ]
                      })
                    ]
                  })
                ]
              }),
              ignoreEmptyFolders(ACCOUNT_DATA),
              false
            )
          })
          it('should sync separators', async function() {
            if (ACCOUNT_DATA.noCache) {
              this.skip()
              return
            }
            const localRoot = account.getData().localRoot

            expect(
              (await getAllBookmarks(account)).children
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
              new Folder({title: localTree.title,
                children: [
                  new Folder({title: 'bar',
                    children: [
                      new Folder({title: 'foo',
                        children: [
                          new Bookmark({title: 'url', url: 'http://ur.l/'}),
                          new Bookmark({title: '-----', url: 'https://separator.floccus.org/?id=467366'}),
                          new Bookmark({title: 'url2',url: 'http://ur2.l'}),
                          new Bookmark({title: '-----', url: 'https://separator.floccus.org/?id=731368'})
                        ]}),
                    ]}),
                ]}),
              ignoreEmptyFolders(ACCOUNT_DATA)
            )
            expectTreeEqual(
              tree,
              new Folder({title: tree.title,
                children: [
                  new Folder({title: 'bar',
                    children: [
                      new Folder({title: 'foo',
                        children: [
                          new Bookmark({title: 'url', url: 'http://ur.l/'}),
                          new Bookmark({title: '-----', url: 'https://separator.floccus.org/?id=467366'}),
                          new Bookmark({title: 'url2',url: 'http://ur2.l'}),
                          new Bookmark({title: '-----', url: 'https://separator.floccus.org/?id=731368'})
                        ]}),
                    ]}),
                ]}),
              ignoreEmptyFolders(ACCOUNT_DATA)
            )

            console.log('initial sync done')

            await withSyncConnection(account, async() => {
              // move first separator
              await account.server.updateBookmark({...tree.children[0].children[0].children[1], parentId: tree.children[0].id})
            })

            console.log('move done')

            await account.sync() // propagate to browser
            expect(account.getData().error).to.not.be.ok

            localTree = await account.localTree.getBookmarksTree(true)
            expectTreeEqual(
              localTree,
              new Folder({title: localTree.title,
                children: [
                  new Folder({title: 'bar',
                    children: [
                      new Folder({title: 'foo',
                        children: [
                          new Bookmark({title: 'url', url: 'http://ur.l/'}),
                          new Bookmark({title: 'url2',url: 'http://ur2.l'}),
                          new Bookmark({title: '-----', url: 'https://separator.floccus.org/?id=467366'})
                        ]}),
                      new Bookmark({title: '-----', url: 'https://separator.floccus.org/?id=379999'})
                    ]}),
                ]}),
              ignoreEmptyFolders(ACCOUNT_DATA)
            )
            tree = await getAllBookmarks(account)
            expectTreeEqual(
              tree,
              new Folder({title: tree.title,
                children: [
                  new Folder({title: 'bar',
                    children: [
                      new Folder({title: 'foo',
                        children: [
                          new Bookmark({title: 'url', url: 'http://ur.l/'}),
                          new Bookmark({title: 'url2',url: 'http://ur2.l'}),
                          new Bookmark({title: '-----', url: 'https://separator.floccus.org/?id=731368'})
                        ]}),
                      new Bookmark({title: '-----', url: 'https://separator.floccus.org/?id=467366'})
                    ]}),
                ]}),
              ignoreEmptyFolders(ACCOUNT_DATA)
            )
          })
          it('should sync separators 2', async function() {
            if (ACCOUNT_DATA.noCache) {
              this.skip()
              return
            }
            const localRoot = account.getData().localRoot

            expect(
              (await getAllBookmarks(account)).children
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
              new Folder({title: localTree.title,
                children: [
                  new Folder({title: 'bar',
                    children: [
                      new Folder({title: 'foo',
                        children: [
                          new Bookmark({title: 'url', url: 'http://ur.l/'}),
                          new Bookmark({title: '-----', url: 'https://separator.floccus.org/?id=467366'}),
                          new Bookmark({title: 'url2',url: 'http://ur2.l'}),
                          new Bookmark({title: '-----', url: 'https://separator.floccus.org/?id=731368'})
                        ]}),
                    ]}),
                ]}),
              ignoreEmptyFolders(ACCOUNT_DATA)
            )
            expectTreeEqual(
              tree,
              new Folder({title: tree.title,
                children: [
                  new Folder({title: 'bar',
                    children: [
                      new Folder({title: 'foo',
                        children: [
                          new Bookmark({title: 'url', url: 'http://ur.l/'}),
                          new Bookmark({title: '-----', url: 'https://separator.floccus.org/?id=467366'}),
                          new Bookmark({title: 'url2',url: 'http://ur2.l'}),
                          new Bookmark({title: '-----', url: 'https://separator.floccus.org/?id=731368'})
                        ]}),
                    ]}),
                ]}),
              ignoreEmptyFolders(ACCOUNT_DATA)
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
              new Folder({title: localTree.title,
                children: [
                  new Folder({title: 'bar',
                    children: [
                      new Folder({title: 'foo',
                        children: [
                          new Bookmark({title: 'url', url: 'http://ur.l/'}),
                          new Bookmark({title: 'url2',url: 'http://ur2.l'}),
                          new Bookmark({title: '-----', url: 'https://separator.floccus.org/?id=467366'})
                        ]}),
                    ]}),

                ]}),
              ignoreEmptyFolders(ACCOUNT_DATA)
            )
          })
          it('should sync root folder successfully', async function() {
            const [root] = await browser.bookmarks.getTree()
            await account.setData({...account.getData(), localRoot: root.id})
            account = await Account.get(account.id)

            expect(
              (await getAllBookmarks(account)).children
            ).to.have.lengthOf(0)

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
              ignoreEmptyFolders(ACCOUNT_DATA)
            )

            // Switch it back to something harmless, so we don't attempt to clean up the root folder
            await account.setData({...account.getData(), localRoot: barFolder.id})
            account = await Account.get(account.id)
          })
          it('should sync root folder ignoring unsupported folders', async function() {
            const [root] = await browser.bookmarks.getTree()
            const originalFolderId = account.getData().localRoot
            await account.setData({...account.getData(), localRoot: root.id, })
            account = await Account.get(account.id)
            const adapter = account.server

            expect(
              (await getAllBookmarks(account)).children
            ).to.have.lengthOf(0)

            let bookmark
            let serverTree = await getAllBookmarks(account)
            await withSyncConnection(account, async() => {
              const fooFolderId = await adapter.createFolder(new Folder({parentId: serverTree.id, title: 'foo'}))
              const barFolderId = await adapter.createFolder(new Folder({parentId: fooFolderId, title: 'bar'}))
              const serverMark = {
                title: 'url2',
                url: 'http://ur2.l/',
                parentId: barFolderId
              }
              const id = await adapter.createBookmark(
                new Bookmark(serverMark)
              )
              bookmark = {...serverMark, id}
            })

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
              const secondBookmark = serverTree.children.filter(folder => folder.title !== 'foo')[0].children.find(item => item.type === 'bookmark')
              secondBookmark.parentId = fooFolder.id
              await adapter.updateBookmark(secondBookmark)
            })

            await account.sync()
            expect(account.getData().error).to.not.be.ok

            serverTree = await getAllBookmarks(account)
            const localTreeAfterSync = await account.localTree.getBookmarksTree()
            expect(serverTree.children).to.have.lengthOf(localTreeAfterSync.children.length + 1)

            // Switch it back to something harmless, so we don't attempt to clean up the root folder
            await account.setData({...account.getData(), localRoot: originalFolderId})
            account = await Account.get(account.id)
          })
          it('should synchronize ordering', async function() {
            if (ACCOUNT_DATA.type === 'nextcloud-legacy') {
              this.skip()
            }
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
          context('with slave mode', function() {
            it("shouldn't create local bookmarks on the server", async function() {
              await account.setData({ ...account.getData(), strategy: 'slave' })
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
              await browser.bookmarks.create({
                title: 'url',
                url: 'http://ur.l/',
                parentId: barFolder.id
              })
              await account.sync()
              expect(account.getData().error).to.not.be.ok

              const tree = await getAllBookmarks(account)
              expect(tree.children).to.have.lengthOf(0)
            })
            it("shouldn't update the server on local changes", async function() {
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
              const originalTree = await getAllBookmarks(account)
              await account.setData({ ...account.getData(), strategy: 'slave' })

              const newData = { title: 'blah' }
              await browser.bookmarks.update(bookmark.id, newData)
              await account.sync() // update on server
              expect(account.getData().error).to.not.be.ok

              const tree = await getAllBookmarks(account)
              expectTreeEqual(
                tree,
                originalTree,
                ignoreEmptyFolders(ACCOUNT_DATA)
              )
            })
            it("shouldn't update the server on local removals", async function() {
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
              const originalTree = await getAllBookmarks(account)
              await account.setData({ ...account.getData(), strategy: 'slave' })

              await browser.bookmarks.remove(bookmark.id)
              await account.sync() // update on server
              expect(account.getData().error).to.not.be.ok

              const tree = await getAllBookmarks(account)
              expectTreeEqual(
                tree,
                originalTree,
                ignoreEmptyFolders(ACCOUNT_DATA)
              )
            })
            it("shouldn't update the server on local folder moves", async function() {
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
              const originalTree = await getAllBookmarks(account)
              await account.setData({ ...account.getData(), strategy: 'slave' })

              await browser.bookmarks.move(barFolder.id, {
                parentId: localRoot
              })
              await account.sync() // update on server
              expect(account.getData().error).to.not.be.ok

              const tree = await getAllBookmarks(account)
              expectTreeEqual(
                tree,
                originalTree,
                ignoreEmptyFolders(ACCOUNT_DATA)
              )
            })
            it('should create server bookmarks locally', async function() {
              await account.setData({ ...account.getData(), strategy: 'slave' })
              const adapter = account.server
              const serverTree = await getAllBookmarks(account)
              if (adapter.onSyncStart) await adapter.onSyncStart()
              const fooFolderId = await adapter.createFolder(new Folder({parentId: serverTree.id, title: 'foo'}))
              const barFolderId = await adapter.createFolder(new Folder({parentId: fooFolderId, title: 'bar'}))
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
              if (ACCOUNT_DATA.noCache) {
                return this.skip()
              }
              await account.setData({ ...account.getData(), strategy: 'slave' })
              const adapter = account.server

              const serverTree = await getAllBookmarks(account)
              if (adapter.onSyncStart) await adapter.onSyncStart()
              const fooFolderId = await adapter.createFolder(new Folder({parentId: serverTree.id, title: 'foo'}))
              const barFolderId = await adapter.createFolder(new Folder({parentId: fooFolderId, title: 'bar'}))
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
              const serverTree = await getAllBookmarks(account)
              if (adapter.onSyncStart) await adapter.onSyncStart()
              const fooFolderId = await adapter.createFolder(new Folder({parentId: serverTree.id, title: 'foo'}))
              const barFolderId = await adapter.createFolder(new Folder({parentId: fooFolderId, title: 'bar'}))
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

              await withSyncConnection(account, async() => {
                await adapter.removeBookmark({...serverMark, id: serverMarkId})
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
                ignoreEmptyFolders(ACCOUNT_DATA)
              )
            })
            it('should sync root folder ignoring unsupported folders', async function() {
              const [root] = await browser.bookmarks.getTree()
              const originalFolderId = account.getData().localRoot
              await account.setData({...account.getData(), localRoot: root.id, })
              account = await Account.get(account.id)
              const adapter = account.server

              expect(
                (await getAllBookmarks(account)).children
              ).to.have.lengthOf(0)

              let bookmark
              let serverTree = await getAllBookmarks(account)
              await withSyncConnection(account, async() => {
                const fooFolderId = await adapter.createFolder(new Folder({parentId: serverTree.id, title: 'foo'}))
                const barFolderId = await adapter.createFolder(new Folder({parentId: fooFolderId, title: 'bar'}))
                const serverMark = {
                  title: 'url2',
                  url: 'http://ur2.l/',
                  parentId: barFolderId
                }
                const id = await adapter.createBookmark(
                  new Bookmark(serverMark)
                )
                bookmark = {...serverMark, id}
              })

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
                const secondBookmark = serverTree.children.filter(folder => folder.title !== 'foo')[0].children.find(item => item.type === 'bookmark')
                secondBookmark.parentId = fooFolder.id
                await adapter.updateBookmark(secondBookmark)
              })

              await account.setData({ ...account.getData(), strategy: 'slave' })

              await account.sync()
              expect(account.getData().error).to.not.be.ok

              serverTree = await getAllBookmarks(account)
              const localTreeAfterSync = await account.localTree.getBookmarksTree()
              expect(serverTree.children).to.have.lengthOf(localTreeAfterSync.children.length + 1)

              // Switch it back to something harmless, so we don't attempt to clean up the root folder
              await account.setData({...account.getData(), localRoot: originalFolderId})
              account = await Account.get(account.id)
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
                ignoreEmptyFolders(ACCOUNT_DATA)
              )
            })
            it('should create local bookmarks on the server respecting moves', async function() {
              await account.setData({
                ...account.getData(),
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
                ignoreEmptyFolders(ACCOUNT_DATA)
              )

              const bazFolder = await browser.bookmarks.create({
                title: 'baz',
                parentId: localRoot
              })
              const barazFolder = await browser.bookmarks.create({
                title: 'baraz',
                parentId: bazFolder.id
              })
              await browser.bookmarks.move(barFolder.id, {parentId: barazFolder.id})
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
                ignoreEmptyFolders(ACCOUNT_DATA)
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
              await account.setData({
                ...account.getData(),
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
                ignoreEmptyFolders(ACCOUNT_DATA)
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
              await account.setData({
                ...account.getData(),
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
                ignoreEmptyFolders(ACCOUNT_DATA)
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

              const tree = await getAllBookmarks(account)
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
              const originalTree = await account.localTree.getBookmarksTree(true)
              const serverTree = await getAllBookmarks(account)

              if (adapter.onSyncStart) await adapter.onSyncStart()
              const fooFolderId = await adapter.createFolder(new Folder({parentId: serverTree.id, title: 'foo'}))
              const barFolderId = await adapter.createFolder(new Folder({parentId: fooFolderId, title: 'bar'}))
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
              const serverTree = await getAllBookmarks(account)

              if (adapter.onSyncStart) await adapter.onSyncStart()
              const fooFolderId = await adapter.createFolder(new Folder({parentId: serverTree.id, title: 'foo'}))
              const barFolderId = await adapter.createFolder(new Folder({parentId: fooFolderId, title: 'bar'}))
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
              const serverTree = await getAllBookmarks(account)
              if (adapter.onSyncStart) await adapter.onSyncStart()
              const fooFolderId = await adapter.createFolder(new Folder({parentId: serverTree.id, title: 'foo'}))
              const barFolderId = await adapter.createFolder(new Folder({parentId: fooFolderId, title: 'bar'}))
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

              await withSyncConnection(account, async() => {
                await adapter.removeBookmark({...serverMark, id: serverMarkId})
              })

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
                { id: '', title: 'root', location: 'Server' }
              )
              account2.server.__defineSetter__('highestId', (id) => {
                account1.server.highestId = id
              })
              account2.server.__defineGetter__('highestId', () => account1.server.highestId)
            }
          })
          afterEach('clean up accounts', async function() {
            await browser.bookmarks.removeTree(account1.getData().localRoot)
            if (ACCOUNT_DATA.type !== 'fake') {
              await account1.setData({
                ...account1.getData(),
                serverRoot: null
              })
              await withSyncConnection(account1, async() => {
                const tree = await account1.server.getBookmarksTree(true)
                await AsyncParallel.each(tree.children, async child => {
                  if (child instanceof Folder) {
                    await account1.server.removeFolder(child)
                  } else {
                    await account1.server.removeBookmark(child)
                  }
                })
              })
            }
            if (ACCOUNT_DATA.type === 'google-drive') {
              const fileList = await account1.server.listFiles('name = ' + "'" + account1.server.bookmark_file + "'")
              const file = fileList.files[0]
              if (file) {
                await account1.server.deleteFile(file.id)
              }
            }
            await account1.delete()
            await browser.bookmarks.removeTree(account2.getData().localRoot)
            await account2.delete()
          })
          it('should not sync two clients at the same time', async function() {
            if (ACCOUNT_DATA.type === 'fake') {
              return this.skip()
            }
            if (ACCOUNT_DATA.type === 'nextcloud-bookmarks' && ['v1.1.2', 'v2.3.4', 'stable3', 'stable4'].includes(APP_VERSION)) {
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
              expect(resolved).to.equal(false)
            })
            console.log('Finished sync with account 1')
            await new Promise(resolve => setTimeout(resolve, 60000))
            expect(account2.getData().error).to.be.not.ok
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

            const serverTreeAfterSecondSync = await getAllBookmarks(account1)

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

            const serverTreeAfterThirdSync = await getAllBookmarks(account1)

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

            const serverTreeAfterFinalSync = await getAllBookmarks(account1)

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

            const serverTreeAfterThirdSync = await getAllBookmarks(account1)

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

            const serverTreeAfterFinalSync = await getAllBookmarks(account1)

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
          it('should handle duplicate bookmarks in different serverRoot folders', async function() {
            if (ACCOUNT_DATA.type !== 'nextcloud-bookmarks') {
              return this.skip()
            }
            await account1.setData({...account1.getData(), serverRoot: '/folder1'})
            await account2.setData({...account2.getData(), serverRoot: '/folder2'})

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
              ignoreEmptyFolders(ACCOUNT_DATA)
            )
            expectTreeEqual(
              tree2AfterSync,
              tree1AfterSync,
              ignoreEmptyFolders(ACCOUNT_DATA)
            )
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

            await browser.bookmarks.move(aFolder.id, {parentId: cFolder.id})
            console.log(
              'acc1: MOVE a ->c'
            )

            // ---

            await browser.bookmarks.move(tree2.children.find(i => i.title === 'c').id, {parentId: tree2.children.find(i => i.title === 'a').children.find(i => i.title === 'b').id})
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
              ignoreEmptyFolders(ACCOUNT_DATA)
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
              ignoreEmptyFolders(ACCOUNT_DATA)
            )
            tree1AfterThirdSync.title = tree2AfterFinalSync.title
            expectTreeEqual(
              tree2AfterFinalSync,
              tree1AfterThirdSync,
              ignoreEmptyFolders(ACCOUNT_DATA)
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
              ignoreEmptyFolders(ACCOUNT_DATA),
              false
            )
            serverTreeAfterFirstSync.title = tree1.title
            expectTreeEqual(
              serverTreeAfterFirstSync,
              tree1,
              ignoreEmptyFolders(ACCOUNT_DATA),
              false
            )
            tree2AfterFirstSync.title = tree1.title
            expectTreeEqual(
              tree2AfterFirstSync,
              tree1,
              ignoreEmptyFolders(ACCOUNT_DATA),
              false
            )
            console.log('First round ok')

            const tree2 = await account2.localTree.getBookmarksTree(true)

            await browser.bookmarks.move(aFolder.id, {parentId: gFolder.id})
            console.log(
              'acc1: MOVE a ->g'
            )
            await browser.bookmarks.move(dFolder.id, {parentId: cFolder.id})
            console.log(
              'acc1: MOVE d ->c'
            )

            // ---

            await browser.bookmarks.move(tree2.children.find(i => i.title === 'a').children.find(i => i.title === 'b').children.find(i => i.title === 'c').id, {parentId: tree2.children.find(i => i.title === 'd').children.find(i => i.title === 'f').id})
            console.log(
              'acc2: MOVE c ->f'
            )

            await browser.bookmarks.move(tree2.children.find(i => i.title === 'a').children.find(i => i.title === 'b').id, {parentId: tree2.children.find(i => i.title === 'd').children.find(i => i.title === 'e').id})
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
              ignoreEmptyFolders(ACCOUNT_DATA),
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
              ignoreEmptyFolders(ACCOUNT_DATA),
              false
            )
            tree1AfterThirdSync.title = tree2AfterFinalSync.title
            expectTreeEqual(
              tree2AfterFinalSync,
              tree1AfterThirdSync,
              ignoreEmptyFolders(ACCOUNT_DATA),
              false
            )
          })
          it('should handle complex hierarchy reversals 2', async function() {
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

            await browser.bookmarks.move(aFolder.id, {parentId: dFolder.id})
            console.log(
              'acc1: MOVE a ->d'
            )
            await browser.bookmarks.remove(gFolder.id)
            console.log(
              'acc1: REMOVE g'
            )

            // ---

            await browser.bookmarks.move(tree2.children.find(i => i.title === 'b').children.find(i => i.title === 'c').id, {parentId: tree2.children.find(i => i.title === 'b').children.find(i => i.title === 'h').id})
            console.log(
              'acc2: MOVE c ->h'
            )

            await browser.bookmarks.move(tree2.children.find(i => i.title === 'b').id, {parentId: tree2.children.find(i => i.title === 'e').children.find(i => i.title === 'f').id})
            console.log(
              'acc2: MOVE b ->f'
            )

            await browser.bookmarks.move(tree2.children.find(i => i.title === 'e').id, {parentId: tree2.children.find(i => i.title === 'a').children.find(i => i.title === 'g').id})
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
              ignoreEmptyFolders(ACCOUNT_DATA)
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
              ignoreEmptyFolders(ACCOUNT_DATA)
            )
            tree1AfterThirdSync.title = tree2AfterFinalSync.title
            expectTreeEqual(
              tree2AfterFinalSync,
              tree1AfterThirdSync,
              ignoreEmptyFolders(ACCOUNT_DATA)
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

            await browser.bookmarks.move(aFolder.id, {parentId: cFolder.id})
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

            await browser.bookmarks.move(tree2.children.find(i => i.title === 'b').children.find(i => i.title === 'c').id, {parentId: newFolder.id})
            console.log(
              'acc2: MOVE c ->new'
            )

            await browser.bookmarks.move(tree2.children.find(i => i.title === 'b').id, {parentId: tree2.children.find(i => i.title === 'a').id})
            console.log(
              'acc2: MOVE b ->a'
            )

            await browser.bookmarks.move(tree2.children.find(i => i.title === 'e').id, {parentId: tree2.children.find(i => i.title === 'd').id})
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
              ignoreEmptyFolders(ACCOUNT_DATA)
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
              ignoreEmptyFolders(ACCOUNT_DATA)
            )
            tree1AfterThirdSync.title = tree2AfterFinalSync.title
            expectTreeEqual(
              tree2AfterFinalSync,
              tree1AfterThirdSync,
              ignoreEmptyFolders(ACCOUNT_DATA)
            )
          })
          it('should handle complex move-remove interactions', async function() {
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
              ignoreEmptyFolders(ACCOUNT_DATA),
              false
            )
            serverTreeAfterFirstSync.title = tree1.title
            expectTreeEqual(
              serverTreeAfterFirstSync,
              tree1,
              ignoreEmptyFolders(ACCOUNT_DATA),
              false
            )
            tree2AfterFirstSync.title = tree1.title
            expectTreeEqual(
              tree2AfterFirstSync,
              tree1,
              ignoreEmptyFolders(ACCOUNT_DATA),
              false
            )
            console.log('First round ok')

            const newFolder = await browser.bookmarks.create({
              title: 'new',
              parentId: aFolder.id
            })
            await browser.bookmarks.move(bookmark2.id, {parentId: newFolder.id})
            await browser.bookmarks.move(aFolder.id, {parentId: bFolder.id})
            await browser.bookmarks.move(zFolder.id, {parentId: cFolder.id})

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
              ignoreEmptyFolders(ACCOUNT_DATA),
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
              ignoreEmptyFolders(ACCOUNT_DATA),
              false
            )
            tree1AfterThirdSync.title = tree2AfterFinalSync.title
            expectTreeEqual(
              tree2AfterFinalSync,
              tree1AfterThirdSync,
              ignoreEmptyFolders(ACCOUNT_DATA),
              false
            )
          })
          it('should synchronize ordering', async function() {
            if (ACCOUNT_DATA.type === 'nextcloud-legacy') return this.skip()
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

          // Skipping this, because nextcloud adapter currently
          // isn't able to track bookmarks across dirs, thus in this
          // scenario both bookmarks survive :/
          it.skip('should propagate moves using "last write wins"', async function() {
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

            const serverTreeAfterSecondSync = await getAllBookmarks(account1)
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

            const serverTreeAfterThirdSync = await getAllBookmarks(account1)
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

            const serverTreeAfterFinalSync = await getAllBookmarks(account1)
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

        context('with tabs', function() {
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
            await account.setData({...account.getData(), localRoot: 'tabs'})
            if (ACCOUNT_DATA.type === 'nextcloud-bookmarks' && ACCOUNT_DATA.oldAPIs) {
              // account.server.hasFeatureHashing = false
              account.server.hasFeatureChildren = false
            }
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
            if (!account) return
            try {
              await awaitTabsUpdated()
              const tabs = await browser.tabs.query({
                windowType: 'normal' // no devtools or panels or popups
              })
              await browser.tabs.remove(tabs.filter(tab => tab.url.startsWith('http')).map(tab => tab.id))
              await awaitTabsUpdated()
            } catch (e) {
              console.error(e)
            }
            if (ACCOUNT_DATA.type !== 'fake') {
              await account.setData({ ...account.getData(), serverRoot: null })
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
              const fileList = await account.server.listFiles('name = ' + "'" + account.server.bookmark_file + "'")
              const file = fileList.files[0]
              if (file) {
                await account.server.deleteFile(file.id)
              }
            }
            await account.delete()
          })
          it('should create local tabs on the server', async function() {
            expect(
              (await getAllBookmarks(account)).children
            ).to.have.lengthOf(0)

            browser.tabs.create({
              index: 1,
              url: 'https://floccus.org/#test1'
            })
            browser.tabs.create({
              index: 2,
              url: 'https://floccus.org/#test2'
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
                      new Bookmark({ title: 'Private bookmarks sync - floccus.org', url: 'https://floccus.org/#test1' }),
                      new Bookmark({ title: 'Private bookmarks sync - floccus.org', url: 'https://floccus.org/#test2' })
                    ]
                  })
                ]
              }),
              ignoreEmptyFolders(ACCOUNT_DATA)
            )
          })
          it('should create server bookmarks as tabs', async function() {
            expect(
              (await getAllBookmarks(account)).children
            ).to.have.lengthOf(0)

            const adapter = account.server
            const serverTree = await getAllBookmarks(account)
            let windowFolderId, serverMark
            await withSyncConnection(account, async() => {
              windowFolderId = await adapter.createFolder(new Folder({
                parentId: serverTree.id,
                title: 'Window 0'
              }))
              serverMark = {
                title: 'Private bookmarks sync - floccus.org',
                url: 'https://floccus.org/',
                parentId: windowFolderId
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
                    title: 'Window 0',
                    children: [
                      new Bookmark({ title: 'Private bookmarks sync - floccus.org', url: 'https://floccus.org/' }),
                    ]
                  })
                ]
              }),
              ignoreEmptyFolders(ACCOUNT_DATA)
            )
          })
          it('should update the server when pushing local changes', async function() {
            expect(
              (await getAllBookmarks(account)).children
            ).to.have.lengthOf(0)

            await account.setData({...account.getData(), strategy: 'overwrite'})

            browser.tabs.create({
              index: 1,
              url: 'https://floccus.org/#test1'
            })
            const tab = browser.tabs.create({
              index: 2,
              url: 'https://floccus.org/#test2'
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
                      new Bookmark({ title: 'Private bookmarks sync - floccus.org', url: 'https://floccus.org/#test1' }),
                      new Bookmark({ title: 'Private bookmarks sync - floccus.org', url: 'https://floccus.org/#test2' })
                    ]
                  })
                ]
              }),
              ignoreEmptyFolders(ACCOUNT_DATA)
            )

            await browser.tabs.update(tab.id, {url: 'https://example.org'})
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
                      new Bookmark({ title: 'Private bookmarks sync - floccus.org', url: 'https://floccus.org/#test1' }),
                      new Bookmark({ title: 'Example Domain', url: 'https://example.org/' })
                    ]
                  })
                ]
              }),
              ignoreEmptyFolders(ACCOUNT_DATA)
            )
          })
          it('should update local tabs when pulling server changes', async function() {
            expect(
              (await getAllBookmarks(account)).children
            ).to.have.lengthOf(0)

            const adapter = account.server
            const serverTree = await getAllBookmarks(account)
            let windowFolderId, serverMark, serverMarkId
            await withSyncConnection(account, async() => {
              windowFolderId = await adapter.createFolder(new Folder({
                parentId: serverTree.id,
                title: 'Window 0'
              }))
              serverMark = {
                title: 'Private bookmarks sync - floccus.org',
                url: 'https://floccus.org/',
                parentId: windowFolderId
              }

              serverMarkId = await adapter.createBookmark(
                new Bookmark(serverMark)
              )
            })

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
                      new Bookmark({ title: 'Private bookmarks sync - floccus.org', url: 'https://floccus.org/' }),
                    ]
                  })
                ]
              }),
              ignoreEmptyFolders(ACCOUNT_DATA)
            )

            let serverMark2
            await withSyncConnection(account, async() => {
              serverMark2 = {
                title: 'Example Domain',
                url: 'https://example.org/#test',
                parentId: windowFolderId
              }
              await adapter.createBookmark(
                new Bookmark(serverMark2)
              )

              await adapter.updateBookmark({ ...serverMark, id: serverMarkId, url: 'https://example.org/', title: 'Example Domain', parentId: windowFolderId })
            })

            await account.setData({...account.getData(), strategy: 'slave'})

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
                      new Bookmark({ title: 'Example Domain', url: 'https://example.org/' }),
                      new Bookmark({ title: 'Example Domain', url: 'https://example.org/#test' }),
                    ]
                  })
                ]
              }),
              ignoreEmptyFolders(ACCOUNT_DATA)
            )
          })
        })
      })
  })

  ACCOUNTS.forEach(ACCOUNT_DATA => {
    describe(`${stringifyAccountData(ACCOUNT_DATA)} benchmark ${ACCOUNT_DATA.serverRoot ? 'subfolder' : 'root'}`, function() {
      context('with two clients', function() {
        this.timeout(120 * 60000) // timeout after 2h
        let account1, account2, RUN_INTERRUPTS = false
        let timeouts = []
        let i = 0
        const setInterrupt = () => {
          if (!timeouts.length) {
            timeouts = new Array(1000).fill(0).map(() =>
              ACCOUNT_DATA.type === 'nextcloud-bookmarks' ? random.int(50000, 150000) : random.int(1000,30000)
            )
          }
          const timeout = timeouts[(i++) % 1000]
          setTimeout(() => {
            if (RUN_INTERRUPTS) {
              console.log('INTERRUPT! (after ' + timeout + ')')
              account1.cancelSync()
              account2.cancelSync()
              setInterrupt()
            }
          }, timeout)
        }

        beforeEach('set up accounts', async function() {
          let _expectTreeEqual = expectTreeEqual
          expectTreeEqual = (tree1, tree2, ignoreEmptyFolders, checkOrder) => _expectTreeEqual(tree1, tree2, ignoreEmptyFolders, !!checkOrder)

          // reset random seed
          random.use(seedrandom(SEED))

          account1 = await Account.create({...ACCOUNT_DATA, failsafe: false})
          await account1.init()
          account2 = await Account.create({...ACCOUNT_DATA, failsafe: false})
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
          if (ACCOUNT_DATA.type === 'nextcloud-bookmarks' && ACCOUNT_DATA.oldAPIs) {
            account1.server.hasFeatureHashing = false
            account2.server.hasFeatureHashing = false
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
          await browser.bookmarks.removeTree(account1.getData().localRoot)
          if (ACCOUNT_DATA.type !== 'fake') {
            await account1.setData({
              ...account1.getData(),
              serverRoot: null
            })
            const tree = await getAllBookmarks(account1)
            await withSyncConnection(account1, async() => {
              await AsyncParallel.each(tree.children, async child => {
                if (child instanceof Folder) {
                  await account1.server.removeFolder(child)
                } else {
                  await account1.server.removeBookmark(child)
                }
              })
            })
          }
          if (ACCOUNT_DATA.type === 'google-drive') {
            const fileList = await account1.server.listFiles('name = ' + "'" + account1.server.bookmark_file + "'")
            const file = fileList.files[0]
            if (file) {
              await account1.server.deleteFile(file.id)
            }
          }
          await account1.delete()
          await browser.bookmarks.removeTree(account2.getData().localRoot)
          await account2.delete()
        })

        it('should handle deep hierarchies with lots of bookmarks', async function() {
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
          }
          serverTreeAfterFirstSync = null
          tree1AfterFirstSync = null
          tree2AfterFirstSync = null
          console.log('First round ok')

          await browser.bookmarks.move(magicBookmark.id, {
            parentId: magicFolder.id
          })
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
              ignoreEmptyFolders(ACCOUNT_DATA)
            )
            serverTreeAfterSecondSync.title = tree1AfterSecondSync.title
            expectTreeEqual(
              serverTreeAfterSecondSync,
              tree1AfterSecondSync,
              ignoreEmptyFolders(ACCOUNT_DATA)
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
              ignoreEmptyFolders(ACCOUNT_DATA)
            )
            serverTreeAfterThirdSync.title = tree2AfterThirdSync.title
            expectTreeEqual(
              serverTreeAfterThirdSync,
              tree2AfterThirdSync,
              ignoreEmptyFolders(ACCOUNT_DATA)
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
              ignoreEmptyFolders(ACCOUNT_DATA)
            )
            tree2AfterThirdSync.title = serverTreeAfterFinalSync.title
            expectTreeEqual(
              tree2AfterThirdSync,
              serverTreeAfterFinalSync,
              ignoreEmptyFolders(ACCOUNT_DATA)
            )
          }
          serverTreeAfterFinalSync = null
          tree1AfterFinalSync = null
        })

        it('should handle fuzzed changes', async function() {
          const localRoot = account1.getData().localRoot
          let bookmarks = []
          let folders = []
          const createTree = async(parentId, i, j) => {
            const len = Math.abs(i - j)
            for (let k = i; k < j; k++) {
              const newBookmark = await browser.bookmarks.create({
                title: 'url' + i + ':' + k + ':' + j,
                url: 'http://ur.l/' + parentId + '/' + i + '/' + k + '/' + j,
                parentId
              })
              bookmarks.push(newBookmark)
            }

            if (len < 4) return

            const step = Math.floor(len / 4)
            for (let k = i; k < j; k += step) {
              const newFolder = await browser.bookmarks.create({
                title: 'folder' + i + ':' + k + ':' + (k + step),
                parentId
              })
              folders.push(newFolder)
              await createTree(newFolder.id, k, k + step)
            }
          }

          await createTree(localRoot, 0, 100)

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
                ignoreEmptyFolders(ACCOUNT_DATA)
              )
              console.log('first tree ok')
              tree2AfterFirstSync.title = serverTreeAfterFirstSync.title
              expectTreeEqual(
                tree2AfterFirstSync,
                serverTreeAfterFirstSync,
                ignoreEmptyFolders(ACCOUNT_DATA)
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
                ignoreEmptyFolders(ACCOUNT_DATA)
              )
              console.log('Final round after init: local tree ok')
              tree2AfterSecondSync.title = serverTreeAfterInit.title
              expectTreeEqual(
                tree2AfterSecondSync,
                serverTreeAfterInit,
                ignoreEmptyFolders(ACCOUNT_DATA)
              )
              console.log('Final round after init: server tree ok')
            }
            tree1AfterInit = null
            serverTreeAfterInit = null
            tree2AfterSecondSync = null
          }
        })

        it('should handle fuzzed changes from two clients', async function() {
          const localRoot = account1.getData().localRoot
          let bookmarks1 = []
          let folders1 = []

          let bookmarks2
          let folders2

          const createTree = async(parentId, i, j) => {
            const len = Math.abs(i - j)
            for (let k = i; k < j; k++) {
              const newBookmark = await browser.bookmarks.create({
                title: 'url' + i + ':' + j + ':' + k,
                url: 'http://ur.l/' + parentId + '/' + i + '/' + j + '/' + k,
                parentId
              })
              bookmarks1.push(newBookmark)
            }

            if (len < 4) return

            const step = Math.floor(len / 4)
            for (let k = i; k < j; k += step) {
              const newFolder = await browser.bookmarks.create({
                title: 'folder' + i + ':' + k + ':' + (k + step),
                parentId
              })
              folders1.push(newFolder)
              await createTree(newFolder.id, k, k + step)
            }
          }

          await createTree(localRoot, 0, 100)

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
                ignoreEmptyFolders(ACCOUNT_DATA)
              )
              console.log('first tree ok')
              tree2AfterFirstSync.title = serverTreeAfterFirstSync.title
              expectTreeEqual(
                tree2AfterFirstSync,
                serverTreeAfterFirstSync,
                ignoreEmptyFolders(ACCOUNT_DATA)
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
            }
            tree1AfterSync = null
            serverTreeAfterSync = null
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
              serverTreeAfterSecondSync.title = tree2AfterSecondSync.title
              expectTreeEqual(
                serverTreeAfterSecondSync,
                tree2AfterSecondSync,
                ignoreEmptyFolders(ACCOUNT_DATA)
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
                ignoreEmptyFolders(ACCOUNT_DATA)
              )
              console.log('Final round after init: local tree ok')
              tree2AfterSecondSync.title = serverTreeAfterInit.title
              expectTreeEqual(
                tree2AfterSecondSync,
                serverTreeAfterInit,
                ignoreEmptyFolders(ACCOUNT_DATA)
              )
              console.log('Final round after init: server tree ok')
            }
            tree2AfterSecondSync = null
            tree1AfterInit = null
            serverTreeAfterInit = null
          }
        })

        it('should handle fuzzed changes with deletions from two clients', async function() {
          const localRoot = account1.getData().localRoot
          let bookmarks1 = []
          let folders1 = []

          let bookmarks2
          let folders2

          const createTree = async(parentId, i, j) => {
            const len = Math.abs(i - j)
            for (let k = i; k < j; k++) {
              const newBookmark = await browser.bookmarks.create({
                title: 'url' + i + ':' + j + ':' + k,
                url: 'http://ur.l/' + parentId + '/' + i + '/' + j + '/' + k,
                parentId
              })
              bookmarks1.push(newBookmark)
            }

            if (len < 4) return

            const step = Math.floor(len / 4)
            for (let k = i; k < j; k += step) {
              const newFolder = await browser.bookmarks.create({
                title: 'folder' + i + ':' + k + ':' + (k + step),
                parentId
              })
              folders1.push(newFolder)
              await createTree(newFolder.id, k, k + step)
            }
          }

          await createTree(localRoot, 0, 100)

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
                ignoreEmptyFolders(ACCOUNT_DATA)
              )
              console.log('first tree ok')
              tree2AfterFirstSync.title = serverTreeAfterFirstSync.title
              expectTreeEqual(
                tree2AfterFirstSync,
                serverTreeAfterFirstSync,
                ignoreEmptyFolders(ACCOUNT_DATA)
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
            }

            await randomlyManipulateTreeWithDeletions(account1, folders1, bookmarks1, 35)
            await randomlyManipulateTreeWithDeletions(account2, folders2, bookmarks2, 35)

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
                ignoreEmptyFolders(ACCOUNT_DATA)
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
                ignoreEmptyFolders(ACCOUNT_DATA)
              )
              console.log('Final round after init: local tree ok')
              tree2AfterSecondSync.title = serverTreeAfterFinalSync.title
              expectTreeEqual(
                tree2AfterSecondSync,
                serverTreeAfterInit,
                ignoreEmptyFolders(ACCOUNT_DATA)
              )
              console.log('Final round after init: server tree ok')
            }
            serverTreeAfterInit = null
            tree1AfterInit = null
            serverTreeAfterInit = null
          }
        })

        it.skip('should handle fuzzed changes with deletions from two clients with interrupts', async function() {
          if (ACCOUNT_DATA.type === 'nextcloud-bookmarks' && ACCOUNT_DATA.oldAPIs) {
            return this.skip()
          }
          const localRoot = account1.getData().localRoot
          let bookmarks1 = []
          let folders1 = []

          let bookmarks2
          let folders2

          const createTree = async(parentId, i, j) => {
            const len = Math.abs(i - j)
            for (let k = i; k < j; k++) {
              const newBookmark = await browser.bookmarks.create({
                title: 'url' + i + ':' + j + ':' + k,
                url: 'http://ur.l/' + parentId + '/' + i + '/' + j + '/' + k,
                parentId
              })
              bookmarks1.push(newBookmark)
            }

            if (len < 4) return

            const step = Math.floor(len / 4)
            for (let k = i; k < j; k += step) {
              const newFolder = await browser.bookmarks.create({
                title: 'folder' + i + ':' + k + ':' + (k + step),
                parentId
              })
              folders1.push(newFolder)
              await createTree(newFolder.id, k, k + step)
            }
          }

          await createTree(localRoot, 0, 100)

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
          }
          tree1Initial = null
          serverTreeAfterFirstSync = null
          tree1AfterFirstSync = null
          tree2AfterFirstSync = null
          console.log('Initial round ok')

          RUN_INTERRUPTS = true
          setInterrupt()

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
                ignoreEmptyFolders(ACCOUNT_DATA)
              )
              console.log('first tree ok')
              tree2AfterFirstSync.title = serverTreeAfterFirstSync.title
              expectTreeEqual(
                tree2AfterFirstSync,
                serverTreeAfterFirstSync,
                ignoreEmptyFolders(ACCOUNT_DATA)
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
            }

            await randomlyManipulateTreeWithDeletions(account1, folders1, bookmarks1, 35)
            await randomlyManipulateTreeWithDeletions(account2, folders2, bookmarks2, 35)

            console.log(' acc1: Moved items')

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
            }
            tree1BeforeSync = null
            tree1AfterSync = null
            serverTreeAfterSync = null
            console.log('first half ok')

            await syncAccountWithInterrupts(account2)

            // Sync twice, because some removal-move mixes are hard to sort out consistently
            await syncAccountWithInterrupts(account2)

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
                ignoreEmptyFolders(ACCOUNT_DATA)
              )
              console.log('Second round: second server tree tree ok')
            }
            serverTreeAfterSecondSync = null
            console.log('second half ok')

            console.log('final sync')
            await syncAccountWithInterrupts(account1)
            console.log('final sync completed')

            let serverTreeAfterFinalSync = await getAllBookmarks(account1)

            let tree1AfterFinalSync = await account1.localTree.getBookmarksTree(
              true
            )
            if (!ACCOUNT_DATA.noCache) {
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
            }
            tree1AfterFinalSync = null

            await account1.init()
            await syncAccountWithInterrupts(account1)
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
                ignoreEmptyFolders(ACCOUNT_DATA)
              )
              console.log('Final round after init: local tree ok')
              tree2AfterSecondSync.title = serverTreeAfterFinalSync.title
              expectTreeEqual(
                tree2AfterSecondSync,
                serverTreeAfterInit,
                ignoreEmptyFolders(ACCOUNT_DATA)
              )
              console.log('Final round after init: server tree ok')
            }
            serverTreeAfterInit = null
            tree1AfterInit = null
            serverTreeAfterInit = null
          }
        })

        it('unidirectional should handle fuzzed changes from two clients', async function() {
          await account2.setData({...account2.getData(), strategy: 'slave'})
          const localRoot = account1.getData().localRoot
          let bookmarks1 = []
          let folders1 = []

          let bookmarks2
          let folders2

          const createTree = async(parentId, i, j) => {
            const len = Math.abs(i - j)
            for (let k = i; k < j; k++) {
              const newBookmark = await browser.bookmarks.create({
                title: 'url' + i + ':' + j + ':' + k,
                url: 'http://ur.l/' + parentId + '/' + i + '/' + j + '/' + k,
                parentId
              })
              bookmarks1.push(newBookmark)
            }

            if (len < 4) return

            const step = Math.floor(len / 4)
            for (let k = i; k < j; k += step) {
              const newFolder = await browser.bookmarks.create({
                title: 'folder' + i + ':' + k + ':' + (k + step),
                parentId
              })
              folders1.push(newFolder)
              await createTree(newFolder.id, k, k + step)
            }
          }

          await createTree(localRoot, 0, 100)

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
                ignoreEmptyFolders(ACCOUNT_DATA)
              )
              console.log('first tree ok')
              tree2AfterFirstSync.title = serverTreeAfterFirstSync.title
              expectTreeEqual(
                tree2AfterFirstSync,
                serverTreeAfterFirstSync,
                ignoreEmptyFolders(ACCOUNT_DATA)
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
                ignoreEmptyFolders(ACCOUNT_DATA)
              )
              serverTreeAfterSecondSync.title = tree2AfterSecondSync.title
              expectTreeEqual(
                serverTreeAfterSecondSync,
                tree2AfterSecondSync,
                ignoreEmptyFolders(ACCOUNT_DATA)
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
                ignoreEmptyFolders(ACCOUNT_DATA)
              )
              tree1AfterInit.title = serverTreeAfterSync.title
              expectTreeEqual(
                tree1AfterInit,
                serverTreeAfterSync,
                ignoreEmptyFolders(ACCOUNT_DATA)
              )
              console.log('Final round after init: local tree ok')
              tree2AfterSecondSync.title = serverTreeAfterInit.title
              expectTreeEqual(
                tree2AfterSecondSync,
                serverTreeAfterInit,
                ignoreEmptyFolders(ACCOUNT_DATA)
              )
              console.log('Final round after init: server tree ok')
            }
            tree2AfterSecondSync = null
            tree1AfterInit = null
            serverTreeAfterInit = null
          }
        })

        it('unidirectional should handle fuzzed changes with deletions from two clients', async function() {
          await account2.setData({...account2.getData(), strategy: 'slave'})
          const localRoot = account1.getData().localRoot
          let bookmarks1 = []
          let folders1 = []

          let bookmarks2
          let folders2

          const createTree = async(parentId, i, j) => {
            const len = Math.abs(i - j)
            for (let k = i; k < j; k++) {
              const newBookmark = await browser.bookmarks.create({
                title: 'url' + i + ':' + j + ':' + k,
                url: 'http://ur.l/' + parentId + '/' + i + '/' + j + '/' + k,
                parentId
              })
              bookmarks1.push(newBookmark)
            }

            if (len < 4) return

            const step = Math.floor(len / 4)
            for (let k = i; k < j; k += step) {
              const newFolder = await browser.bookmarks.create({
                title: 'folder' + i + ':' + k + ':' + (k + step),
                parentId
              })
              folders1.push(newFolder)
              await createTree(newFolder.id, k, k + step)
            }
          }

          await createTree(localRoot, 0, 100)

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
                ignoreEmptyFolders(ACCOUNT_DATA)
              )
              console.log('first tree ok')
              tree2AfterFirstSync.title = serverTreeAfterFirstSync.title
              expectTreeEqual(
                tree2AfterFirstSync,
                serverTreeAfterFirstSync,
                ignoreEmptyFolders(ACCOUNT_DATA)
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
            }

            await randomlyManipulateTreeWithDeletions(account1, folders1, bookmarks1, 35)
            await randomlyManipulateTreeWithDeletions(account2, folders2, bookmarks2, 35)

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
                ignoreEmptyFolders(ACCOUNT_DATA)
              )
              serverTreeAfterSecondSync.title = tree2AfterSecondSync.title
              expectTreeEqual(
                serverTreeAfterSecondSync,
                tree2AfterSecondSync,
                ignoreEmptyFolders(ACCOUNT_DATA)
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
                ignoreEmptyFolders(ACCOUNT_DATA)
              )
              tree2AfterSecondSync.title = tree1AfterFinalSync.title
              expectTreeEqual(
                tree1AfterFinalSync,
                tree2AfterSecondSync,
                ignoreEmptyFolders(ACCOUNT_DATA)
              )
              console.log('Final round: local tree tree ok')
              serverTreeAfterSync.title = serverTreeAfterFinalSync.title
              expectTreeEqual(
                serverTreeAfterFinalSync,
                serverTreeAfterSync,
                ignoreEmptyFolders(ACCOUNT_DATA)
              )
              tree2AfterSecondSync.title = serverTreeAfterFinalSync.title
              expectTreeEqual(
                tree2AfterSecondSync,
                serverTreeAfterFinalSync,
                ignoreEmptyFolders(ACCOUNT_DATA)
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
                ignoreEmptyFolders(ACCOUNT_DATA)
              )
              tree1AfterInit.title = tree1AfterSync.title
              expectTreeEqual(
                tree1AfterInit,
                tree1AfterSync,
                ignoreEmptyFolders(ACCOUNT_DATA)
              )
              console.log('Final round after init: local tree ok')
              serverTreeAfterInit.title = serverTreeAfterSync.title
              expectTreeEqual(
                serverTreeAfterInit,
                serverTreeAfterSync,
                ignoreEmptyFolders(ACCOUNT_DATA)
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

function hasNoBookmarks(child) {
  if (child instanceof Bookmark) return false
  else return !child.children.some(child => !hasNoBookmarks(child))
}

function ignoreEmptyFolders(account_data) {
  return account_data.type === 'nextcloud-legacy'
}

async function getAllBookmarks(account) {
  let tree
  await withSyncConnection(account, async() => {
    tree = await account.server.getBookmarksTree(true)
  })
  return tree
}

async function withSyncConnection(account, fn) {
  const adapter = account.server
  if (adapter.onSyncStart) await adapter.onSyncStart()
  await fn()
  if (adapter.onSyncComplete) await adapter.onSyncComplete()
}

async function randomlyManipulateTree(account, folders, bookmarks, iterations) {
  for (let i = 0; i < iterations; i++) {
    let magicBookmark
    let magicFolder1
    let magicFolder2
    let magicFolder3
    let magicFolder4
    let magicFolder5
    try {
      // Randomly move one bookmark
      magicBookmark = bookmarks[random.int(0, bookmarks.length - 1)]
      magicFolder1 = folders[random.int(0, folders.length - 1)]
      await browser.bookmarks.move(magicBookmark.id, {
        parentId: magicFolder1.id
      })
      console.log('Move ' + magicBookmark.title + ' to ' + magicFolder1.id)

      // Randomly move two folders
      magicFolder2 = folders[random.int(0, folders.length - 1)]
      magicFolder3 = folders[random.int(0, folders.length - 1)]
      if (magicFolder2 === magicFolder3) {
        continue
      }
      const tree2 = (await browser.bookmarks.getSubTree(magicFolder2.id))[0]
      const root = (await browser.bookmarks.getSubTree(account.getData().localRoot))[0]
      if (Folder.hydrate(tree2).findFolder(magicFolder3.id)) {
        continue
      }
      if (!Folder.hydrate(root).findFolder(magicFolder3.id)) { // This folder is not in our tree anymore for some reason
        continue
      }
      await browser.bookmarks.move(magicFolder2.id, {
        parentId: magicFolder3.id
      })
      console.log('Move #' + magicFolder2.id + '[' + magicFolder2.title + '] to ' + magicFolder3.id)

      // Randomly create a folder
      magicFolder4 = folders[random.int(0, folders.length - 1)]
      const newFolder = await browser.bookmarks.create({
        title: 'newFolder' + Math.random(),
        parentId: magicFolder4.id
      })
      folders.push(newFolder)
      console.log('Created #' + newFolder.id + '[' + newFolder.title + '] in ' + magicFolder4.id)

      magicFolder5 = folders[random.int(0, folders.length - 1)]
      const newBookmark = await browser.bookmarks.create({
        title: 'newBookmark' + Math.random(),
        url: 'http://ur.l/' + magicFolder5.id + '/' + Math.random(),
        parentId: magicFolder5.id
      })
      bookmarks.push(newBookmark)
      console.log('Created #' + newBookmark.id + '[' + newBookmark.title + '] in ' + magicFolder5.id)
    } catch (e) {
      console.log(e)
    }
  }
}

async function randomlyManipulateTreeWithDeletions(account, folders, bookmarks, iterations) {
  for (let i = 0; i < iterations; i++) {
    let magicBookmark
    let magicFolder1
    let magicFolder2
    let magicFolder3
    let magicFolder4
    let magicFolder5
    try {
      // Randomly remove one bookmark
      magicBookmark = bookmarks[random.int(0, bookmarks.length - 1)]
      await browser.bookmarks.remove(magicBookmark.id)
      bookmarks.splice(bookmarks.indexOf(magicBookmark), 1)
      console.log('Remove ' + magicBookmark.title)

      // Randomly rename one bookmark
      magicBookmark = bookmarks[random.int(0, bookmarks.length - 1)]
      const newTitle = 'renamed' + Math.random()
      await browser.bookmarks.update(magicBookmark.id, {title: newTitle})
      console.log('Rename #' + magicBookmark.id + '[' + magicBookmark.title + '] to ' + newTitle)

      magicFolder1 = folders[random.int(0, folders.length - 1)]
      await browser.bookmarks.removeTree(magicFolder1.id)
      folders.splice(folders.indexOf(magicFolder1), 1)
      console.log('Removed #' + magicFolder1.id + '[' + magicFolder1.title + ']')

      // Randomly move one bookmark
      magicBookmark = bookmarks[random.int(0, bookmarks.length - 1)]
      magicFolder1 = folders[random.int(0, folders.length - 1)]
      await browser.bookmarks.move(magicBookmark.id, {
        parentId: magicFolder1.id
      })
      console.log('Move ' + magicBookmark.title + ' to ' + magicFolder1.id)

      // Randomly move two folders
      magicFolder2 = folders[random.int(0, folders.length - 1)]
      magicFolder3 = folders[random.int(0, folders.length - 1)]
      if (magicFolder2 === magicFolder3) {
        continue
      }
      const tree2 = (await browser.bookmarks.getSubTree(magicFolder2.id))[0]
      const root = (await browser.bookmarks.getSubTree(account.getData().localRoot))[0]
      if (Folder.hydrate(tree2).findFolder(magicFolder3.id)) {
        continue
      }
      if (!Folder.hydrate(root).findFolder(magicFolder3.id)) { // This folder is not in our tree anymore for some reason
        continue
      }
      await browser.bookmarks.move(magicFolder2.id, {
        parentId: magicFolder3.id
      })
      console.log('Move #' + magicFolder2.id + '[' + magicFolder2.title + '] to ' + magicFolder3.id)

      // Randomly create a folder
      magicFolder4 = folders[random.int(0, folders.length - 1)]
      const newFolder = await browser.bookmarks.create({
        title: 'newFolder' + Math.random(),
        parentId: magicFolder4.id
      })
      folders.push(newFolder)
      console.log('Created #' + newFolder.id + '[' + newFolder.title + '] in ' + magicFolder4.id)

      // Randomly create a bookmark
      magicFolder5 = folders[random.int(0, folders.length - 1)]
      const newBookmark = await browser.bookmarks.create({
        title: 'newBookmark' + Math.random(),
        url: 'http://ur.l/' + magicFolder5.id + '/' + Math.random(),
        parentId: magicFolder5.id
      })
      bookmarks.push(newBookmark)
      console.log('Created #' + newBookmark.id + '[' + newBookmark.title + '] in ' + magicFolder5.id)
    } catch (e) {
      console.log(e)
    }
  }
}

async function syncAccountWithInterrupts(account) {
  await account.sync()
  try {
    expect(account.getData().error).to.not.be.ok
  } catch (e) {
    if (!account.getData().error.includes('E027')) {
      throw e
    } else {
      console.log(account.getData().error)
      await syncAccountWithInterrupts(account)
    }
  }
}

function stringifyAccountData(ACCOUNT_DATA) {
  return `${ACCOUNT_DATA.type}${
    (ACCOUNT_DATA.type === 'nextcloud-bookmarks' && ACCOUNT_DATA.oldAPIs ? '-old' : '') +
    (ACCOUNT_DATA.noCache ? '-noCache' : '') +
    (typeof ACCOUNT_DATA.bookmark_file_type !== 'undefined' ? '-' + ACCOUNT_DATA.bookmark_file_type : '') +
    ((ACCOUNT_DATA.type === 'google-drive' && ACCOUNT_DATA.password) || (ACCOUNT_DATA.type === 'webdav' && ACCOUNT_DATA.passphrase) ? '-encrypted' : '')
  }`
}

function awaitTabsUpdated() {
  return Promise.race([
    new Promise(resolve => {
      browser.tabs.onUpdated.addListener(() => {
        browser.tabs.onUpdated.removeListener(resolve)
        setTimeout(() => resolve(), 1000)
      })
    }),
    new Promise(resolve => setTimeout(resolve, 1100))
  ])
}
