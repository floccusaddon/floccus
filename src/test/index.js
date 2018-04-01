import chai from 'chai'
import chaiAsPromised from 'chai-as-promised'

chai.use(chaiAsPromised)
const expect = chai.expect

import Adapter from '../lib/Adapter'
import Account from '../lib/Account'
import AccountStorage from '../lib/AccountStorage'
import browser from '../lib/browser-api'

describe('Floccus', function () {
  this.timeout(10000) // no test should run longer than 10s
  before(async function () {
    const background = await browser.runtime.getBackgroundPage()
    background.controller.setEnabled(false)
  })
  after(async function () {
    const background = await browser.runtime.getBackgroundPage()
    background.controller.setEnabled(true)
  })
  describe('Account', function () {
    var account
    beforeEach('set up dummy account', async function () {
      account = await Account.create({type: 'fake', username: 'foo', url: 'http://ba.r'})
    })
    afterEach('clean up dummy account', async function () {
      if (account) await account.delete()
    })
    it('should create an account', async function () {
      const secondInstance = await Account.get(account.id)
      expect(secondInstance.getData()).to.deep.equal(account.getData())
    })
    it('should save and restore an account', async function () {
      console.log(this.test.title)
      const newData = {type: 'fake', username: 'bar', url: 'https://fo.o'}
      await account.setData(newData)
      expect(account.getData()).to.deep.equal(newData)

      const secondInstance = await Account.get(account.id)
      expect(secondInstance.getData()).to.deep.equal(newData)
    })
    it('should delete an account', async function () {
      console.log(this.test.title)
      await account.delete()
      expect(Account.get(account.id)).to.be.rejected
      account = null // so afterEach notices it's deleted already
    })
    it('should not be initialized upon creation', async function () {
      console.log(this.test.title)
      expect(await account.isInitialized()).to.be.false
    })
  })
  describe('Sync', function () {
    context('with one client', function () {
      var account
      beforeEach('set up dummy account', async function () {
        account = await Account.create({type: 'fake', username: 'foo', url: 'http://ba.r'})
        await account.init()
      })
      afterEach('clean up dummy account', async function () {
        if (!account) return
        await browser.bookmarks.removeTree(account.getData().localRoot)
        await account.delete()
      })
      it('should create local bookmarks on the server', async function () {
        console.log(this.test.title)
        var adapter = account.server
        expect(await adapter.pullBookmarks()).to.have.lengthOf(0)

        const localRoot = account.getData().localRoot
        const fooFolder = await browser.bookmarks.create({title: 'foo', parentId: localRoot})
        const barFolder = await browser.bookmarks.create({title: 'bar', parentId: fooFolder.id})
        const bookmark = await browser.bookmarks.create({title: 'url', url: 'http://ur.l/', parentId: barFolder.id})
        await account.sync()

        const bookmarks = await adapter.pullBookmarks()
        expect(bookmarks).to.have.lengthOf(1)
        expect(bookmarks[0].title).to.equal(bookmark.title)
        expect(bookmarks[0].url).to.equal(bookmark.url)
        expect(bookmarks[0].path).to.equal('/foo/bar')
      })
      it('should update the server on local changes', async function () {
        console.log(this.test.title)
        var adapter = account.server
        expect(await adapter.pullBookmarks()).to.have.lengthOf(0)

        const localRoot = account.getData().localRoot
        const fooFolder = await browser.bookmarks.create({title: 'foo', parentId: localRoot})
        const barFolder = await browser.bookmarks.create({title: 'bar', parentId: fooFolder.id})
        const bookmark = await browser.bookmarks.create({title: 'url', url: 'http://ur.l/', parentId: barFolder.id})
        await account.sync() // propagate to server

        const newData = {title: 'blah'}
        await browser.bookmarks.update(bookmark.id, newData)
        expect(await account.tree.getAllNodes()).to.have.lengthOf(1)
        await account.sync() // update on server

        const bookmarks = await adapter.pullBookmarks()
        expect(bookmarks).to.have.lengthOf(1)
        expect(bookmarks[0].title).to.equal(newData.title)
        expect(bookmarks[0].url).to.equal(bookmark.url)
        expect(bookmarks[0].path).to.equal('/foo/bar')
      })
      it('should update the server on local removals', async function () {
        console.log(this.test.title)
        var adapter = account.server
        expect(await adapter.pullBookmarks()).to.have.lengthOf(0)

        const localRoot = account.getData().localRoot
        const fooFolder = await browser.bookmarks.create({title: 'foo', parentId: localRoot})
        const barFolder = await browser.bookmarks.create({title: 'bar', parentId: fooFolder.id})
        const bookmark = await browser.bookmarks.create({title: 'url', url: 'http://ur.l/', parentId: barFolder.id})
        await account.sync() // propagate to server

        await browser.bookmarks.remove(bookmark.id)
        expect(await account.tree.getAllNodes()).to.have.lengthOf(0)
        await account.sync() // update on server

        const bookmarks = await adapter.pullBookmarks()
        expect(bookmarks).to.have.lengthOf(0)
      })
      it('should create server bookmarks locally', async function () {
        console.log(this.test.title)
        var adapter = account.server
        expect(await adapter.pullBookmarks()).to.have.lengthOf(0)
        const serverMark = {title: 'url', url: 'http://ur.l/', path: '/foo/bar'}
        await adapter.createBookmark(serverMark)
        expect(await adapter.pullBookmarks()).to.have.lengthOf(1)

        const localRoot = account.getData().localRoot
        await account.sync()

        const tree = (await browser.bookmarks.getSubTree(localRoot))[0]
        expect(tree.children).to.have.lengthOf(1)
        expect(tree.children[0].title).to.equal('foo')
        expect(tree.children[0].children).to.have.lengthOf(1)
        expect(tree.children[0].children[0].title).to.equal('bar')
        expect(tree.children[0].children[0].children).to.have.lengthOf(1)
        const bookmark = tree.children[0].children[0].children[0]
        expect(bookmark.title).to.equal(serverMark.title)
        expect(bookmark.url).to.equal(serverMark.url)
      })
      it('should update local bookmarks on server changes', async function () {
        console.log(this.test.title)
        var adapter = account.server
        expect(await adapter.pullBookmarks()).to.have.lengthOf(0)
        const serverMark = await adapter.createBookmark({title: 'url', url: 'http://ur.l/', path: '/foo/bar'})
        expect(await adapter.pullBookmarks()).to.have.lengthOf(1)

        const localRoot = account.getData().localRoot
        await account.sync() // propage creation

        const newServerMark = await adapter.updateBookmark(serverMark.id, {...serverMark, title: 'blah'})
        await account.sync() // propage update

        const tree = (await browser.bookmarks.getSubTree(localRoot))[0]
        expect(tree.children).to.have.lengthOf(1)
        expect(tree.children[0].title).to.equal('foo')
        expect(tree.children[0].children).to.have.lengthOf(1)
        expect(tree.children[0].children[0].title).to.equal('bar')
        expect(tree.children[0].children[0].children).to.have.lengthOf(1)
        const bookmark = tree.children[0].children[0].children[0]
        expect(bookmark.title).to.equal(newServerMark.title)
        expect(bookmark.url).to.equal(newServerMark.url)
      })
      it('should update local bookmarks on server removals', async function () {
        console.log(this.test.title)
        var adapter = account.server
        expect(await adapter.pullBookmarks()).to.have.lengthOf(0)
        const serverMark = await adapter.createBookmark({title: 'url', url: 'http://ur.l/', path: '/foo/bar'})
        expect(await adapter.pullBookmarks()).to.have.lengthOf(1)

        const localRoot = account.getData().localRoot
        await account.sync() // propage creation

        await adapter.removeBookmark(serverMark.id)
        await account.sync() // propage update
        expect(await account.tree.getAllNodes()).to.have.lengthOf(0)
        const tree = (await browser.bookmarks.getSubTree(localRoot))[0]
        expect(tree.children).to.have.lengthOf(0) // should remove orphaned folders
      })
      it('should be ok if both server and local bookmark are removed', async function () {
        console.log(this.test.title)
        var adapter = account.server
        expect(await adapter.pullBookmarks()).to.have.lengthOf(0)
        const serverMark = await adapter.createBookmark({title: 'url', url: 'http://ur.l/', path: '/foo/bar'})
        expect(await adapter.pullBookmarks()).to.have.lengthOf(1)

        await account.sync() // propage creation
        expect(await account.tree.getAllNodes()).to.have.lengthOf(1)

        await adapter.removeBookmark(serverMark.id)
        await browser.bookmarks.remove((await account.tree.getAllNodes())[0].id)
        await account.sync() // propage update

        expect(account.getData().error).to.not.be.ok
        expect(await account.tree.getAllNodes()).to.have.lengthOf(0)
        expect(await adapter.pullBookmarks()).to.be.empty
      })
    })
    context('with two clients', function () {
      var account1, account2
      beforeEach('set up dummy accounts', async function () {
        account1 = await Account.create({type: 'fake', username: 'foo', url: 'http://ba.r'})
        await account1.init()
        account2 = await Account.create({type: 'fake', username: 'foo', url: 'http://ba.r'})
        await account2.init()

        // Wrire both accounts to the same fake db
        account2.server.db = account1.server.db
      })
      afterEach('clean up dummy account', async function () {
        await browser.bookmarks.removeTree(account1.getData().localRoot)
        await account1.delete()
        await browser.bookmarks.removeTree(account2.getData().localRoot)
        await account2.delete()
      })
      it('should propagate edits using "last write wins"', async function () {
        console.log(this.test.title)
        var adapter = account1.server
        expect(await adapter.pullBookmarks()).to.have.lengthOf(0)

        const localRoot = account1.getData().localRoot
        const fooFolder = await browser.bookmarks.create({title: 'foo', parentId: localRoot})
        const barFolder = await browser.bookmarks.create({title: 'bar', parentId: fooFolder.id})
        const bookmark1 = await browser.bookmarks.create({title: 'url', url: 'http://ur.l/', parentId: barFolder.id})
        await account1.sync()
        await account2.sync()

        const bookmarks = await adapter.pullBookmarks()
        expect(bookmarks).to.have.lengthOf(1)
        expect(bookmarks[0].title).to.equal(bookmark1.title)
        expect(bookmarks[0].url).to.equal(bookmark1.url)
        expect(bookmarks[0].path).to.equal('/foo/bar')

        await browser.bookmarks.update(bookmark1.id, {title: 'NEW TITLE FROM ACC1'})
        await account1.sync()

        const bm2Id = (await account2.tree.getAllNodes())[0].id
        const newBookmark2 = await browser.bookmarks.update(bm2Id, {title: 'NEW TITLE FROM ACC2'})
        await account2.sync()

        await account1.sync()

        const bookmarksAfterSyncing = await adapter.pullBookmarks()
        expect(bookmarksAfterSyncing).to.have.lengthOf(1)
        expect(bookmarksAfterSyncing[0].title).to.equal(newBookmark2.title)
        expect(bookmarksAfterSyncing[0].url).to.equal(newBookmark2.url)
        expect(bookmarksAfterSyncing[0].path).to.equal('/foo/bar')

        const bookmark1AfterSyncing = (await account1.tree.getAllNodes())[0]
        expect(bookmark1AfterSyncing.title).to.equal(newBookmark2.title)
        expect(bookmark1AfterSyncing.url).to.equal(newBookmark2.url)
        const bookmark2AfterSyncing = (await account2.tree.getAllNodes())[0]
        expect(bookmark2AfterSyncing.title).to.equal(newBookmark2.title)
        expect(bookmark2AfterSyncing.url).to.equal(newBookmark2.url)
      })
      it('should propagate moves using "last write wins"', async function () {
        console.log(this.test.title)
        var adapter = account1.server
        expect(await adapter.pullBookmarks()).to.have.lengthOf(0)

        const localRoot = account1.getData().localRoot
        const fooFolder = await browser.bookmarks.create({title: 'foo', parentId: localRoot})
        const barFolder = await browser.bookmarks.create({title: 'bar', parentId: fooFolder.id})
        const bookmark1 = await browser.bookmarks.create({title: 'url', url: 'http://ur.l/', parentId: barFolder.id})
        await account1.sync()
        await account2.sync()

        const bookmarks = await adapter.pullBookmarks()
        expect(bookmarks).to.have.lengthOf(1)
        expect(bookmarks[0].title).to.equal(bookmark1.title)
        expect(bookmarks[0].url).to.equal(bookmark1.url)
        expect(bookmarks[0].path).to.equal('/foo/bar')

        await browser.bookmarks.move(bookmark1.id, {parentId: fooFolder.id})
        await account1.sync()

        const bookmark2 = (await account2.tree.getAllNodes())[0]
        await browser.bookmarks.move(bookmark2.id, {parentId: account2.getData().localRoot})
        await account2.sync()

        await account1.sync()

        const bookmarksAfterSyncing = await adapter.pullBookmarks()
        expect(bookmarksAfterSyncing).to.have.lengthOf(1)
        expect(bookmarksAfterSyncing[0].path).to.equal('/')

        await account1.tree.load()
        await account2.tree.load()
        expect(account1.tree.getBookmarkByLocalId(bookmark1.id).path).to.equal('/')
        expect(account2.tree.getBookmarkByLocalId(bookmark2.id).path).to.equal('/')
      })
    })
  })
})
