import { expect, getEnv, stringifyAccountData } from './utils'
import S3Adapter from '../lib/adapters/S3'
import { Bookmark, ItemLocation } from '../lib/Tree'
import { RemoteFileChangedError, ResourceLockedError } from '../errors/Error'

describe('S3', function() {
  const { ACCOUNTS } = getEnv()
  ACCOUNTS.filter((data) => data.type === 's3').forEach((ACCOUNT_DATA) => {
    describe(`${stringifyAccountData(ACCOUNT_DATA)} test S3 concurrency`, function() {
      this.timeout(60000)
      let data, adapters

      const newAdapter = () => {
        const adapter = new S3Adapter(data)
        adapters.push(adapter)
        return adapter
      }

      const addBookmark = async(adapter, title) => {
        const root = await adapter.getBookmarksTree()
        await adapter.createBookmark(new Bookmark({
          title,
          url: 'http://example.org/' + title,
          parentId: root.id,
          location: ItemLocation.SERVER,
        }))
      }

      beforeEach(function() {
        data = {
          ...ACCOUNT_DATA,
          bookmark_file: `floccus/concurrency-${Math.random()}.${ACCOUNT_DATA.bookmark_file_type}`,
        }
        adapters = []
      })

      afterEach(async function() {
        const adapter = new S3Adapter(data)
        await adapter.request('DELETE', adapter.getLockKey())
        await adapter.request('DELETE', adapter.getBookmarkKey())
      })

      it('connects to the bucket', async function() {
        await newAdapter().testConnection()
      })

      it('keeps a second client out while the lock is held', async function() {
        const a = newAdapter()
        const b = newAdapter()
        await a.onSyncStart()
        await expect(b.onSyncStart()).to.be.rejectedWith(ResourceLockedError)
        await addBookmark(a, 'a')
        await a.onSyncComplete()

        // the lock is gone, and the file is there
        expect(await b.onSyncStart()).to.not.equal(false)
        const tree = await b.getBookmarksTree()
        expect(tree.children.map((child) => child.title)).to.deep.equal(['a'])
        await b.onSyncComplete()
      })

      it('does not overwrite a file that was written during the sync', async function() {
        const a = newAdapter()
        const b = newAdapter()
        await a.onSyncStart()
        // a forced sync ignores the lock
        await b.onSyncStart(false, true)
        await addBookmark(b, 'b')
        await b.onSyncComplete()

        await addBookmark(a, 'a')
        await expect(a.onSyncComplete()).to.be.rejectedWith(RemoteFileChangedError)
        await a.onSyncFail()

        const c = newAdapter()
        await c.onSyncStart()
        const tree = await c.getBookmarksTree()
        expect(tree.children.map((child) => child.title)).to.deep.equal(['b'])
        await addBookmark(c, 'c')
        // the ETag of the existing file lets the next write through
        await c.onSyncComplete()

        const d = newAdapter()
        await d.onSyncStart()
        const tree2 = await d.getBookmarksTree()
        expect(tree2.children.map((child) => child.title)).to.deep.equal(['b', 'c'])
        await d.onSyncComplete()
      })
    })
  })
})
