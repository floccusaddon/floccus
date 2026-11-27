/* global globalThis */
import './node-shims/indexeddb.js'
import { Bookmark } from '../lib/Tree'
import { expect } from './utils'
import { createFileSnapshotHarness } from './file-snapshot-harness'

// LightningFS picks its Web Locks mutex when navigator.locks exists (node ships
// it), and that mutex keeps the process alive long after the suite has ended.
Object.defineProperty(globalThis.navigator, 'locks', {
  value: undefined,
  configurable: true,
})

function findBookmarkByUrl(tree, url) {
  let found = null
  const walk = (folder) => {
    for (const child of folder.children) {
      if (found) {
        return
      }
      if (child.url === url) {
        found = child
        return
      }
      if (child.children) {
        walk(child)
      }
    }
  }
  walk(tree)
  return found
}

describe('Merge with an empty cache: stale local titles', function() {
  this.timeout(30000)

  it('does not let a fresh client overwrite a newer server title for the same URL', async function() {
    const harness = await createFileSnapshotHarness({ labels: ['A', 'C'] })
    try {
      const a = harness.clients.A
      const folder = await a.createFolder('测试环境')
      await a.createBookmark('COE DEV', 'http://localhost:5180/', folder.id)
      await harness.sync('A')

      // The user renames the bookmark in this browser and syncs.
      const resource = await a.getResource()
      const tree = await resource.getBookmarksTree(true)
      const bookmark = findBookmarkByUrl(tree, 'http://localhost:5180/')
      await resource.updateBookmark(new Bookmark({
        id: bookmark.id,
        parentId: bookmark.parentId,
        title: 'COE 5180',
        url: bookmark.url,
        tags: bookmark.tags,
        location: bookmark.location,
      }))
      await harness.sync('A')
      expect(findBookmarkByUrl(harness.serverTree(), 'http://localhost:5180/').title).to.equal('COE 5180')

      // Another computer opens with its own stale local copy and an empty cache.
      const c = harness.clients.C
      const cFolder = await c.createFolder('测试环境')
      await c.createBookmark('COE DEV', 'http://localhost:5180/', cFolder.id)

      await harness.sync('C')

      expect(findBookmarkByUrl(harness.serverTree(), 'http://localhost:5180/').title, 'server title').to.equal('COE 5180')
      expect(findBookmarkByUrl(await c.localTree(), 'http://localhost:5180/').title, 'client local title').to.equal('COE 5180')
    } finally {
      await harness.dispose()
    }
  })
})
