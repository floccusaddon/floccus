/* global globalThis */
import './node-shims/indexeddb.js'
import fs from 'fs/promises'
import path from 'path'
import httpNode from 'isomorphic-git/http/node'
import Account from '../lib/Account'
import Controller from '../lib/Controller'
import { setGitHttpClient } from '../lib/adapters/Git'
import XbelSerializer from '../lib/serializers/Xbel'
import { Bookmark, Folder, ItemLocation } from '../lib/Tree'
import MergeSyncProcess from '../lib/strategies/Merge'
import Mappings from '../lib/Mappings'
import { itemIdentities } from '../lib/Tombstones'
import { ClientsideDeletionFailsafeError } from '../errors/Error'
import { clearLocalResource, createTestLocalRoot, expect } from './utils'
import { createFileSnapshotHarness, FAKE_FILE_SNAPSHOT_TYPE } from './file-snapshot-harness'
import { createGitHttpServer } from './git-http-server'

// See file_snapshot_harness.test.js: LightningFS' Web Locks mutex keeps the
// test process alive long after the suite has finished.
Object.defineProperty(globalThis.navigator, 'locks', {
  value: undefined,
  configurable: true,
})

function titles(tree) {
  return tree.children.map((child) => child.title).sort()
}

function walk(tree, visit) {
  for (const child of tree.children) {
    visit(child)
    if (child instanceof Folder) {
      walk(child, visit)
    }
  }
}

async function localTitles(client) {
  return titles(await client.localTree())
}

async function localBookmarkByTitle(client, title) {
  const tree = await client.localTree()
  let found = null
  walk(tree, (item) => {
    if (!found && item instanceof Bookmark && item.title === title) {
      found = item
    }
  })
  return found
}

async function localFolderByTitle(client, title) {
  const tree = await client.localTree()
  let found = null
  walk(tree, (item) => {
    if (!found && item instanceof Folder && item.title === title) {
      found = item
    }
  })
  return found
}

async function localBookmarksWithUrl(client, url) {
  const tree = await client.localTree()
  const found = []
  walk(tree, (item) => {
    if (item instanceof Bookmark && item.url === url) {
      found.push(item)
    }
  })
  return found
}

function serverTitles(harness) {
  return titles(harness.serverTree())
}

function gitData(server) {
  return {
    type: 'git',
    url: server.url,
    branch: 'main',
    username: 'floccus',
    password: 'floccus',
    bookmark_file: 'bookmarks.xbel',
    bookmark_file_type: 'xbel',
    includeCredentials: false,
    allowRedirects: false,
    allowNetwork: false,
  }
}

async function createGitAccount(server) {
  const account = await Account.create({ ...gitData(server), ...(await createTestLocalRoot()) })
  await account.init()
  return account
}

async function gitLocalTitles(account) {
  const resource = await account.getResource()
  return titles(await resource.getBookmarksTree(true))
}

async function gitServerTitles(server) {
  const contents = await server.git(['show', 'main:bookmarks.xbel'])
  return titles(XbelSerializer.deserializeFile(contents).tree)
}

async function gitLocalFolderByTitle(account, title) {
  const tree = await (await account.getResource()).getBookmarksTree(true)
  let found = null
  walk(tree, (item) => {
    if (!found && item instanceof Folder && item.title === title) {
      found = item
    }
  })
  return found
}

async function gitLocalBookmarkByTitle(account, title) {
  const tree = await (await account.getResource()).getBookmarksTree(true)
  let found = null
  walk(tree, (item) => {
    if (!found && item instanceof Bookmark && item.title === title) {
      found = item
    }
  })
  return found
}

async function createLocalBookmark(account, title, url = `http://${title}.example/`, parentId = null) {
  const resource = await account.getResource()
  const root = await resource.getBookmarksTree(true)
  return resource.createBookmark(new Bookmark({
    title,
    url,
    parentId: parentId ?? root.id,
    location: ItemLocation.LOCAL,
  }))
}

async function removeLocalBookmark(account, title) {
  const resource = await account.getResource()
  const tree = await resource.getBookmarksTree(true)
  let bookmark = null
  walk(tree, (item) => {
    if (!bookmark && item instanceof Bookmark && item.title === title) {
      bookmark = item
    }
  })
  await resource.removeBookmark(bookmark)
}

async function removeLocalFolder(account, title) {
  const resource = await account.getResource()
  const tree = await resource.getBookmarksTree(true)
  let folder = null
  walk(tree, (item) => {
    if (!folder && item instanceof Folder && item.title === title) {
      folder = item
    }
  })
  await resource.removeFolder(folder)
}

async function syncOk(account) {
  await account.sync()
  if (account.getData().error) {
    throw new Error('Sync failed: ' + account.getData().error)
  }
}

describe('Explicit deletions from the server history', function() {
  this.timeout(180000)
  this.slow(20000)

  before(async function() {
    const controller = await Controller.getSingleton()
    controller.setEnabled(false)
  })
  after(async function() {
    const controller = await Controller.getSingleton()
    controller.setEnabled(true)
  })

  describe('fake file-snapshot backend', function() {
    let harness

    beforeEach(async function() {
      harness = await createFileSnapshotHarness()
    })
    afterEach(async function() {
      if (harness) {
        await harness.dispose()
        harness = null
      }
    })

    it('honors a deletion on a client whose cache was reset', async function() {
      const { A, B } = harness.clients

      await A.createBookmark('keep', 'http://keep.example/', await A.rootId())
      await A.createBookmark('gone', 'http://gone.example/', await A.rootId())
      await harness.sync('A', 'B')
      expect(await localTitles(B)).to.deep.equal(['gone', 'keep'])
      expect(B.account.getData().lastServerRevision).to.be.a('string')

      // A deletes the bookmark and carries the deletion to the server
      await A.removeBookmark((await localBookmarkByTitle(A, 'gone')).id)
      await harness.sync('A')
      expect(serverTitles(harness)).to.deep.equal(['keep'])

      // B loses cache and mappings -- the state that used to resurrect the
      // bookmark -- and stays at the revision it last saw
      await B.account.reset()
      const previousRevision = B.account.getData().lastServerRevision
      await syncOk(B.account)

      expect(await localTitles(B)).to.deep.equal(['keep'])
      expect(serverTitles(harness)).to.deep.equal(['keep'])
      expect(B.account.getData().lastServerRevision).to.not.equal(previousRevision)

      // And it stays deleted across later syncs of both clients
      await harness.sync('A', 'B')
      expect(await localTitles(A)).to.deep.equal(['keep'])
      expect(await localTitles(B)).to.deep.equal(['keep'])
      expect(serverTitles(harness)).to.deep.equal(['keep'])
    })

    it('does not resurrect the children of a deleted folder', async function() {
      const { A, B } = harness.clients

      const rootId = await A.rootId()
      const folderId = await A.createFolder('folder', rootId)
      await A.createBookmark('inside', 'http://inside.example/', folderId)
      await A.createBookmark('outside', 'http://outside.example/', rootId)
      await harness.sync('A', 'B')
      expect(await localTitles(B)).to.deep.equal(['folder', 'outside'])

      await A.removeFolder(folderId)
      await harness.sync('A')
      expect(serverTitles(harness)).to.deep.equal(['outside'])

      await B.account.reset()
      await syncOk(B.account)

      expect(await localTitles(B)).to.deep.equal(['outside'])
      expect(await localFolderByTitle(B, 'folder')).to.not.be.ok
      expect(await localBookmarkByTitle(B, 'inside')).to.not.be.ok
      expect(serverTitles(harness)).to.deep.equal(['outside'])

      await harness.sync('A', 'B')
      expect(await localTitles(B)).to.deep.equal(['outside'])
      expect(serverTitles(harness)).to.deep.equal(['outside'])
    })

    it('keeps a bookmark that was deleted and re-added', async function() {
      const { A, B } = harness.clients

      const rootId = await A.rootId()
      await A.createBookmark('phoenix', 'http://phoenix.example/', rootId)
      await harness.sync('A', 'B')

      // Delete and re-add the same url: the new bookmark is a new identity
      await A.removeBookmark((await localBookmarkByTitle(A, 'phoenix')).id)
      await harness.sync('A')
      expect(serverTitles(harness)).to.deep.equal([])
      const readdedId = await A.createBookmark('phoenix', 'http://phoenix.example/', rootId)
      expect(readdedId).to.be.ok
      await harness.sync('A')
      expect(serverTitles(harness)).to.deep.equal(['phoenix'])

      await B.account.reset()
      await syncOk(B.account)

      // The old deletion does not suppress the new bookmark: exactly one, and
      // it is the one on the server
      expect(await localBookmarksWithUrl(B, 'http://phoenix.example/')).to.have.length(1)
      expect(await localTitles(B)).to.deep.equal(['phoenix'])
      expect(serverTitles(harness)).to.deep.equal(['phoenix'])

      // A's local copy and the server stay at one item as well
      expect(await localTitles(A)).to.deep.equal(['phoenix'])
      expect((await A.localTree()).children).to.have.length(1)
    })

    it('keeps a bookmark added again locally after a cache and mapping reset', async function() {
      const { A, B } = harness.clients
      const rootId = await A.rootId()

      await A.createBookmark('reborn', 'http://reborn.example/', rootId)
      await harness.sync('A', 'B')

      // A deletes it and carries the deletion to the server
      await A.removeBookmark((await localBookmarkByTitle(A, 'reborn')).id)
      await harness.sync('A')
      expect(serverTitles(harness)).to.deep.equal([])

      // B drops its local copy along with cache and mappings, then adds the
      // same url again -- a new local item, though it looks the same
      const oldId = (await localBookmarkByTitle(B, 'reborn')).id
      await B.removeBookmark(oldId)
      await B.account.reset()
      const newId = await B.createBookmark('reborn', 'http://reborn.example/')
      expect(newId).to.not.equal(oldId)

      await syncOk(B.account)

      // The history's deletion is not this item's: it survives, and the merge
      // puts it back on the server
      expect(await localBookmarksWithUrl(B, 'http://reborn.example/')).to.have.length(1)
      expect(await localTitles(B)).to.deep.equal(['reborn'])
      expect(serverTitles(harness)).to.deep.equal(['reborn'])
    })

    it('deletes a stale local copy after a cache and mapping reset', async function() {
      const { A, B } = harness.clients
      const rootId = await A.rootId()

      await A.createBookmark('stale', 'http://stale.example/', rootId)
      await harness.sync('A', 'B')
      const staleId = (await localBookmarkByTitle(B, 'stale')).id

      await A.removeBookmark((await localBookmarkByTitle(A, 'stale')).id)
      await harness.sync('A')
      expect(serverTitles(harness)).to.deep.equal([])

      // B's local copy is the one that was synced: it goes for real
      await B.account.reset()
      expect(B.account.getData().lastServerRevision).to.be.a('string')
      await syncOk(B.account)

      expect(await localBookmarksWithUrl(B, 'http://stale.example/')).to.have.length(0)
      expect(await localTitles(B)).to.deep.equal([])
      expect(serverTitles(harness)).to.deep.equal([])
      expect(staleId).to.be.ok
    })

    it('does not apply history deletions that trip the deletion failsafe', async function() {
      const { A, B } = harness.clients
      const rootId = await A.rootId()

      for (let i = 0; i < 10; i++) {
        await A.createBookmark('item-' + i, `http://item-${i}.example/`, rootId)
      }
      await harness.sync('A', 'B')
      const before = await localTitles(B)
      expect(before).to.have.length(10)

      // Half of B's items are deleted on the server while B is at R0. A has
      // its own failsafe disabled for this, so that the deletions reach the
      // server at all.
      await A.account.setData({ failsafe: false })
      for (let i = 0; i < 5; i++) {
        await A.removeBookmark((await localBookmarkByTitle(A, 'item-' + i)).id)
      }
      await harness.sync('A')
      expect(serverTitles(harness)).to.have.length(5)

      // A cache-less merge would apply all five deletions before the scan; the
      // failsafe has to stop it, leaving the local tree untouched
      await B.account.reset()
      await B.account.sync()
      expect(B.account.getData().error).to.include(new ClientsideDeletionFailsafeError(50).code)
      expect(await localTitles(B)).to.deep.equal(before)
    })

    it('forgets the recorded revision when the bookmark file changes', async function() {
      const { A, B } = harness.clients
      await A.createBookmark('keep', 'http://keep.example/', await A.rootId())
      await harness.sync('A', 'B')
      expect(B.account.getData().lastServerRevision).to.be.a('string')
      expect(B.account.getData().syncedItemIdentities).to.be.an('array')

      await B.account.setData({ bookmark_file: 'other.xbel' })

      expect(B.account.getData().lastServerRevision).to.not.be.ok
      expect(B.account.getData().syncedItemIdentities).to.not.be.ok
    })

    it('forgets the recorded revision when the local root changes', async function() {
      const { A, B } = harness.clients
      await A.createBookmark('keep', 'http://keep.example/', await A.rootId())
      await harness.sync('A', 'B')
      expect(B.account.getData().lastServerRevision).to.be.a('string')

      await B.account.setData({ localRoot: 'another-root-id' })

      expect(B.account.getData().lastServerRevision).to.not.be.ok
      expect(B.account.getData().syncedItemIdentities).to.not.be.ok
    })

    it('forgets the recorded revision when the server lost its data', async function() {
      const { A, B } = harness.clients
      await A.createBookmark('keep', 'http://keep.example/', await A.rootId())
      await harness.sync('A', 'B')
      expect(B.account.getData().lastServerRevision).to.be.a('string')

      // The adapter reports an empty server (onSyncStart returns false) and
      // then fails, so the sync stops after Account#sync cleared the revision.
      const adapter = B.account.server
      const onSyncStart = adapter.onSyncStart.bind(adapter)
      adapter.onSyncStart = async(...args) => {
        await onSyncStart(...args)
        return false
      }
      adapter.getBookmarksTree = async() => {
        throw new Error('the server has no bookmarks file any more')
      }

      await B.account.sync()

      expect(B.account.getData().error).to.be.ok
      expect(B.account.getData().lastServerRevision).to.not.be.ok
      expect(B.account.getData().syncedItemIdentities).to.not.be.ok
    })

    it('does not record the removals of a one-way overwrite', async function() {
      const { A, B } = harness.clients

      const rootId = await A.rootId()
      await A.createBookmark('shared', 'http://shared.example/', rootId)
      await A.createBookmark('dropped', 'http://dropped.example/', rootId)
      await harness.sync('A', 'B')
      expect(await localTitles(B)).to.deep.equal(['dropped', 'shared'])

      // A replaces the server with its local tree, without 'dropped'
      await A.removeBookmark((await localBookmarkByTitle(A, 'dropped')).id)
      await A.account.sync('overwrite')
      expect(A.account.getData().error).to.not.be.ok
      expect(serverTitles(harness)).to.deep.equal(['shared'])
      expect(harness.server.history.some((entry) => !entry.recordsDeletions)).to.be.true

      // B's copy survives a reset: the removal mirrored an overwrite, it was
      // not a deletion anyone asked for
      await B.account.reset()
      await syncOk(B.account)
      expect(await localTitles(B)).to.deep.equal(['dropped', 'shared'])

      // ... and B's merge puts it back on the server
      expect(serverTitles(harness)).to.deep.equal(['dropped', 'shared'])
    })

    it('does not record a deletion of an item the server never took', async function() {
      const { A, B } = harness.clients

      await A.createBookmark('accepted', 'http://accepted.example/', await A.rootId())
      // CachingAdapter#acceptsBookmark refuses this one, so it never reaches
      // the server and no history can have it
      await A.createBookmark('ignored', 'data:', await A.rootId())
      await harness.sync('A', 'B')
      expect(serverTitles(harness)).to.deep.equal(['accepted'])

      const revisionBefore = harness.server.revision
      await A.removeBookmark((await localBookmarkByTitle(A, 'ignored')).id)
      await harness.sync('A')
      expect(harness.server.revision).to.equal(revisionBefore)

      await B.account.reset()
      await syncOk(B.account)
      expect(await localTitles(B)).to.deep.equal(['accepted'])
    })

    it('syncs a repository without a recorded revision', async function() {
      const { A } = harness.clients

      await A.createBookmark('existing', 'http://existing.example/', await A.rootId())
      await harness.sync('A')

      // A profile that never synced this server: no revision and no tombstones,
      // so the old merge behaviour applies
      const fresh = await Account.create({
        ...(await createTestLocalRoot()),
        type: FAKE_FILE_SNAPSHOT_TYPE,
        snapshotId: harness.server.snapshotId,
        clientLabel: 'C',
      })
      try {
        await fresh.init()
        expect(fresh.getData().lastServerRevision).to.not.be.ok
        await syncOk(fresh)
        expect(titles(await (await fresh.getResource()).getBookmarksTree(true)))
          .to.deep.equal(['existing'])
        expect(fresh.getData().lastServerRevision).to.be.a('string')
      } finally {
        await clearLocalResource(fresh)
        await fresh.delete()
      }
    })
  })

  describe('applying recorded deletions', function() {
    function makeLocalTree(tree, usingTabs) {
      const removed = []
      return {
        removed,
        getBookmarksTree: async() => tree,
        removeBookmark: async(bookmark) => { removed.push(bookmark) },
        removeFolder: async(folder) => { removed.push(folder) },
        isUsingBrowserTabs: async() => usingTabs,
      }
    }

    function makeProcess(localTree, tombstones, identities) {
      const mappings = new Mappings(null, {
        folders: { LocalToServer: {}, ServerToLocal: {} },
        bookmarks: { LocalToServer: {}, ServerToLocal: {} },
      })
      const server = { getData: () => ({ failsafe: true }) }
      const process = new MergeSyncProcess(mappings, localTree, server, async() => { /* persists nothing */ })
      process.setTombstones(tombstones)
      process.setTombstoneIdentities(identities)
      return process
    }

    function createTree(bookmarks) {
      const root = new Folder({ id: 0, title: 'root', location: ItemLocation.LOCAL })
      root.children = bookmarks.map(([id, url]) => new Bookmark({
        id,
        title: url,
        url,
        parentId: 0,
        location: ItemLocation.LOCAL,
      }))
      return root
    }

    it('does not apply history deletions to browser tabs', async function() {
      const tree = createTree([[1, 'http://tab.example/']])
      const localTree = makeLocalTree(tree, true)
      const process = makeProcess(
        localTree,
        [{ type: 'bookmark', url: 'http://tab.example/', parentPath: [] }],
        itemIdentities(tree)
      )

      await process.applyTombstones()

      expect(localTree.removed).to.have.length(0)
      expect(tree.children).to.have.length(1)
    })

    it('leaves the local tree alone without recorded identities', async function() {
      const tree = createTree([[1, 'http://unknown.example/']])
      const localTree = makeLocalTree(tree, false)
      const process = makeProcess(
        localTree,
        [{ type: 'bookmark', url: 'http://unknown.example/', parentPath: [] }],
        null
      )

      await process.applyTombstones()

      expect(localTree.removed).to.have.length(0)
      expect(tree.children).to.have.length(1)
    })
  })

  describe('git smart-HTTP backend', function() {
    let server
    let accounts

    before(function() {
      setGitHttpClient(httpNode)
    })
    after(function() {
      setGitHttpClient(null)
    })
    beforeEach(async function() {
      server = await createGitHttpServer()
      accounts = []
    })
    afterEach(async function() {
      for (const account of accounts) {
        await clearLocalResource(account)
        await account.delete()
      }
      if (server) {
        await server.close()
        server = null
      }
    })

    async function twoSyncedClients(...titles) {
      const A = await createGitAccount(server)
      const B = await createGitAccount(server)
      accounts.push(A, B)
      for (const title of titles) {
        await createLocalBookmark(A, title)
      }
      await syncOk(A)
      await syncOk(B)
      expect(await gitLocalTitles(B)).to.deep.equal(titles.slice().sort())
      return { A, B }
    }

    it('honors a deletion after the client lost its cache', async function() {
      const { A, B } = await twoSyncedClients('keep', 'gone')

      await removeLocalBookmark(A, 'gone')
      await syncOk(A)
      expect(await gitServerTitles(server)).to.deep.equal(['keep'])

      await B.reset()
      const previousRevision = B.getData().lastServerRevision
      await syncOk(B)

      expect(await gitLocalTitles(B)).to.deep.equal(['keep'])
      expect(await gitServerTitles(server)).to.deep.equal(['keep'])
      expect(B.getData().lastServerRevision).to.not.equal(previousRevision)

      // The deletion sticks on later syncs of both sides
      await syncOk(A)
      await syncOk(B)
      expect(await gitLocalTitles(A)).to.deep.equal(['keep'])
      expect(await gitLocalTitles(B)).to.deep.equal(['keep'])
      expect(await gitServerTitles(server)).to.deep.equal(['keep'])
    })

    it('does not resurrect a deleted folder from the history', async function() {
      const A = await createGitAccount(server)
      const B = await createGitAccount(server)
      accounts.push(A, B)

      const resource = await A.getResource()
      const root = await resource.getBookmarksTree(true)
      const folderId = await resource.createFolder(new Folder({
        title: 'folder',
        parentId: root.id,
        location: ItemLocation.LOCAL,
      }))
      await createLocalBookmark(A, 'inside', 'http://inside.example/', folderId)
      await createLocalBookmark(A, 'outside')
      await syncOk(A)
      await syncOk(B)

      await removeLocalFolder(A, 'folder')
      await syncOk(A)
      expect(await gitServerTitles(server)).to.deep.equal(['outside'])

      await B.reset()
      await syncOk(B)
      expect(await gitLocalTitles(B)).to.deep.equal(['outside'])

      await syncOk(A)
      expect(await gitLocalTitles(A)).to.deep.equal(['outside'])
      expect(await gitServerTitles(server)).to.deep.equal(['outside'])
    })

    it('keeps a re-added bookmark and logs the overwrite suppression', async function() {
      const { A, B } = await twoSyncedClients('phoenix')

      await removeLocalBookmark(A, 'phoenix')
      await syncOk(A)
      expect(await gitServerTitles(server)).to.deep.equal([])
      await createLocalBookmark(A, 'phoenix')
      await syncOk(A)
      expect(await gitServerTitles(server)).to.deep.equal(['phoenix'])

      await B.reset()
      await syncOk(B)
      expect(await gitLocalTitles(B)).to.deep.equal(['phoenix'])
      expect(await gitServerTitles(server)).to.deep.equal(['phoenix'])

      // The re-add commit of A is an ordinary one, still recorded
      expect(await server.git(['log', '--format=%B', '-1', 'main'])).to.not.contain('Floccus-records-deletions')
    })

    it('does not tombstone the removals of an overwrite sync', async function() {
      const { A, B } = await twoSyncedClients('shared', 'dropped')

      await removeLocalBookmark(A, 'dropped')
      await A.sync('overwrite')
      expect(A.getData().error).to.not.be.ok
      expect(await gitServerTitles(server)).to.deep.equal(['shared'])

      // The commit says its removals are not deletions
      expect(await server.git(['log', '--format=%B', '-1', 'main']))
        .to.contain('Floccus-records-deletions: false')

      await B.reset()
      await syncOk(B)
      expect(await gitLocalTitles(B)).to.deep.equal(['dropped', 'shared'])
      expect(await gitServerTitles(server)).to.deep.equal(['dropped', 'shared'])
    })

    it('syncs a repository whose history predates the recorded revision', async function() {
      // A repository written before any client recorded a revision
      const A = await createGitAccount(server)
      accounts.push(A)
      await createLocalBookmark(A, 'old')
      await syncOk(A)
      expect(A.getData().lastServerRevision).to.be.a('string')

      const B = await createGitAccount(server)
      accounts.push(B)
      expect(B.getData().lastServerRevision).to.not.be.ok
      await syncOk(B)
      expect(await gitLocalTitles(B)).to.deep.equal(['old'])
    })

    async function cloneWorkTree() {
      const work = path.join(server.root, 'work-' + Math.random().toString(36).slice(2, 10))
      await server.run(['clone', '--quiet', server.repoPath, work], { cwd: server.root })
      await server.run(['-C', work, 'config', 'user.email', 'floccus@example.com'])
      await server.run(['-C', work, 'config', 'user.name', 'Floccus test'])
      return work
    }

    it('derives deletions along the first-parent chain across a merge', async function() {
      const { A, B } = await twoSyncedClients('keep', 'gone')

      await removeLocalBookmark(A, 'gone')
      await syncOk(A)
      expect(await gitServerTitles(server)).to.deep.equal(['keep'])

      const work = await cloneWorkTree()
      const file = path.join(work, 'bookmarks.xbel')
      const base = Math.floor(Date.now() / 1000)
      // A side branch that deletes the bookmark, with a later timestamp than
      // the merge that keeps it: git.log's age order would list it after the
      // merge, where diffing commit against commit invents the deletion.
      const sideEnv = {
        GIT_AUTHOR_DATE: `${base + 7200} +0000`,
        GIT_COMMITTER_DATE: `${base + 7200} +0000`,
      }
      await server.run(['-C', work, 'checkout', '-b', 'side'])
      const sideTree = XbelSerializer.deserializeFile(await fs.readFile(file, 'utf8')).tree
      sideTree.children = sideTree.children.filter((child) => child.title !== 'keep')
      await fs.writeFile(file, XbelSerializer.serialize(sideTree))
      await server.run(['-C', work, 'add', 'bookmarks.xbel'])
      await server.run(['-C', work, 'commit', '-m', 'side deletes keep'], { env: sideEnv })

      await server.run(['-C', work, 'checkout', 'main'])
      await server.run(['-C', work, 'merge', '--no-ff', '--no-commit', 'side'])
      // The merge resolution keeps the bookmark, so the head still has it
      await server.run(['-C', work, 'checkout', 'main', '--', 'bookmarks.xbel'])
      await server.run(['-C', work, 'commit', '-m', 'merge side, keep restored'], {
        env: {
          GIT_AUTHOR_DATE: `${base + 3600} +0000`,
          GIT_COMMITTER_DATE: `${base + 3600} +0000`,
        },
      })
      await server.run(['-C', work, 'push', '--quiet', 'origin', 'main'])
      expect(await gitServerTitles(server)).to.deep.equal(['keep'])

      await B.reset()
      await syncOk(B)

      expect(await gitLocalTitles(B)).to.deep.equal(['keep'])
      expect(await gitServerTitles(server)).to.deep.equal(['keep'])
    })

    it('does not derive deletions from a file without explicit ids', async function() {
      const { A, B } = await twoSyncedClients()

      const resource = await A.getResource()
      const root = await resource.getBookmarksTree(true)
      const folderId = await resource.createFolder(new Folder({
        title: 'old',
        parentId: root.id,
        location: ItemLocation.LOCAL,
      }))
      await createLocalBookmark(A, 'inside', 'http://inside.example/', folderId)
      await syncOk(A)
      await syncOk(B)
      expect(await gitLocalTitles(B)).to.deep.equal(['old'])

      // Strip the ids and rename the folder: with derived ids the rename looks
      // like the deletion of the old folder and its whole subtree.
      const work = await cloneWorkTree()
      const file = path.join(work, 'bookmarks.xbel')
      let contents = await fs.readFile(file, 'utf8')
      contents = contents.replace(/\s+id="[^"]*"/g, '')
      contents = contents.replace(/<title>old<\/title>/g, '<title>renamed</title>')
      await fs.writeFile(file, contents)
      await server.run(['-C', work, 'add', 'bookmarks.xbel'])
      await server.run(['-C', work, 'commit', '-m', 'rename folder without ids'])
      await server.run(['-C', work, 'push', '--quiet', 'origin', 'main'])

      await B.reset()
      await syncOk(B)

      // The limitation is a possible duplicate, never a lost item
      expect(await gitLocalFolderByTitle(B, 'old')).to.be.ok
      expect(await gitLocalBookmarkByTitle(B, 'inside')).to.be.ok
    })

    it('deepens the shallow history far enough to reach the last synced revision', async function() {
      const { A, B } = await twoSyncedClients('deleted')

      // More commits than the adapter's shallow fetch (depth 10): B's revision
      // is no longer in the clone when it comes back
      for (let i = 0; i < 12; i++) {
        await createLocalBookmark(A, 'filler-' + i)
        await syncOk(A)
      }
      await removeLocalBookmark(A, 'deleted')
      await syncOk(A)

      await B.reset()
      await syncOk(B)

      expect(await gitLocalTitles(B)).to.not.include('deleted')
      expect(await gitLocalTitles(B)).to.have.length(12)
      expect(await gitServerTitles(server)).to.not.include('deleted')
      expect(await gitServerTitles(server)).to.have.length(12)
    })
  })
})
