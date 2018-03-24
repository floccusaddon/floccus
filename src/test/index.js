import chai from 'chai'
import chaiAsPromised from 'chai-as-promised'

chai.use(chaiAsPromised)
const expect = chai.expect

import Adapter from '../lib/Adapter'
import Account from '../lib/Account'
import AccountStorage from '../lib/AccountStorage'
import browser from '../lib/browser-api'

describe('Floccus', function () {
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
    var account
    beforeEach('set up dummy account', async function () {
      const background = await browser.runtime.getBackgroundPage()
      background.controller.setEnabled(false)
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
})
