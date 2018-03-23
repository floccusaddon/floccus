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
      const newData = {type: 'fake', username: 'bar', url: 'https://fo.o'}
      await account.setData(newData)
      expect(account.getData()).to.deep.equal(newData)

      const secondInstance = await Account.get(account.id)
      expect(secondInstance.getData()).to.deep.equal(newData)
    })
    it('should delete an account', async function () {
      await account.delete()
      expect(Account.get(account.id)).to.be.rejected
      account = null // so afterEach notices it's deleted already
    })
    it('should not be initialized upon creation', async function () {
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
      var adapter = account.server
      expect(await adapter.pullBookmarks()).to.have.lengthOf(0)

      const localRoot = await account.getData().localRoot
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
  })
})
