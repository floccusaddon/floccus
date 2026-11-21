/* global globalThis */
import './node-shims/indexeddb.js'
import httpNode from 'isomorphic-git/http/node'
import Account from '../lib/Account'
import Controller from '../lib/Controller'
import GitAdapter, { setGitHttpClient } from '../lib/adapters/Git'
import XbelSerializer from '../lib/serializers/Xbel'
import {
  CancelledSyncError,
  NetworkError,
  RemoteFileChangedError,
  ResourceLockedError,
} from '../errors/Error'
import { Bookmark, Folder, ItemLocation } from '../lib/Tree'
import { clearLocalResource, createTestLocalRoot, expect, expectTreeEqual } from './utils'
import { createFileSnapshotHarness } from './file-snapshot-harness'
import { createGitHttpServer } from './git-http-server'

// LightningFS picks its Web Locks mutex when navigator.locks exists (node ships
// it), and that mutex keeps the process alive long after the suite has ended.
// See file_snapshot_harness.test.js.
Object.defineProperty(globalThis.navigator, 'locks', {
  value: undefined,
  configurable: true,
})

const BRANCH = 'main'
const LOCK_REF = 'refs/heads/floccus-lock'

/**
 * Acceptance signals for the whole suite. Each scenario records a violation
 * here before its own assertion fails, so the final summary still shows what
 * went wrong when a test throws.
 */
const metrics = {
  scenarios: 0,
  resurrections: 0,
  duplicates: 0,
  lostItems: 0,
  unexpectedItems: 0,
  cacheResets: 0,
  cacheChecks: 0,
  leaseRaces: 0,
  leaseDoubleHolders: 0,
}

function recordScenario() {
  metrics.scenarios++
}

// ---------------------------------------------------------------------------
// Tree helpers
// ---------------------------------------------------------------------------

function walk(tree, visit) {
  for (const child of tree.children) {
    visit(child)
    if (child instanceof Folder) {
      walk(child, visit)
    }
  }
}

function titles(tree) {
  return tree.children.map((child) => child.title).sort()
}

/** Every leaf as "folder/child", sorted; empty folders are not listed. */
function flatten(tree) {
  const items = []
  const visit = (folder, prefix) => {
    for (const child of folder.children) {
      const path = prefix ? prefix + '/' + child.title : child.title
      if (child instanceof Folder) {
        visit(child, path)
      } else {
        items.push(path)
      }
    }
  }
  visit(tree, '')
  return items.sort()
}

function findNode(tree, title) {
  let found = null
  walk(tree, (item) => {
    if (!found && item.title === title) {
      found = item
    }
  })
  return found
}

function findFolder(tree, title) {
  let found = null
  walk(tree, (item) => {
    if (!found && item instanceof Folder && item.title === title) {
      found = item
    }
  })
  return found
}

function findBookmark(tree, title) {
  let found = null
  walk(tree, (item) => {
    if (!found && item instanceof Bookmark && item.title === title) {
      found = item
    }
  })
  return found
}

function countBy(items) {
  const counts = new Map()
  for (const item of items) {
    counts.set(item, (counts.get(item) || 0) + 1)
  }
  return counts
}

function assertNoDuplicates(tree, label) {
  const duplicates = [...countBy(flatten(tree))]
    .filter(([, count]) => count > 1)
    .map(([item, count]) => `${item} x${count}`)
  metrics.duplicates += duplicates.length
  expect(duplicates, `${label} contains duplicate items`).to.deep.equal([])
}

function assertShape(tree, expected, label) {
  const actual = flatten(tree)
  const missing = expected.filter((item) => !actual.includes(item))
  const unexpected = actual.filter((item) => !expected.includes(item))
  metrics.lostItems += missing.length
  metrics.unexpectedItems += unexpected.length
  expect(actual, label).to.deep.equal(expected)
  assertNoDuplicates(tree, label)
}

function assertGone(tree, title, label) {
  const found = findNode(tree, title)
  if (found) {
    metrics.resurrections++
  }
  expect(found, `${title} was resurrected in ${label}`).to.not.be.ok
}

function assertRootTitles(tree, expected, label) {
  const actual = titles(tree)
  const missing = expected.filter((item) => !actual.includes(item))
  const unexpected = actual.filter((item) => !expected.includes(item))
  metrics.lostItems += missing.length
  metrics.unexpectedItems += unexpected.length
  expect(actual, label).to.deep.equal(expected)
}

// ---------------------------------------------------------------------------
// Stored-state helpers (acceptance metrics)
// ---------------------------------------------------------------------------

async function storedState(account) {
  const cache = await account.storage.getCache()
  const mappings = await account.storage.getMappings()
  return {
    cacheTitles: titles(cache),
    mappedBookmarks: Object.keys(mappings.getSnapshot().LocalToServer.bookmark).length,
  }
}

/**
 * A transient failure must leave the cache and mappings exactly where the last
 * successful sync stored them. An empty cache here is the state that used to
 * resurrect deleted items on the following sync.
 */
function assertCachePreserved(before, after, label) {
  metrics.cacheChecks++
  const preserved = after.cacheTitles.length === before.cacheTitles.length &&
    after.cacheTitles.every((title, i) => title === before.cacheTitles[i]) &&
    after.mappedBookmarks === before.mappedBookmarks
  if (!preserved) {
    metrics.cacheResets++
  }
  expect(after.cacheTitles, `${label}: the cache was reset`).to.deep.equal(before.cacheTitles)
  expect(after.mappedBookmarks, `${label}: the mappings were reset`)
    .to.equal(before.mappedBookmarks)
  expect(after.cacheTitles.length, `${label}: the cache was left empty`)
    .to.be.greaterThan(0)
}

// ---------------------------------------------------------------------------
// File-snapshot clients
// ---------------------------------------------------------------------------

async function withFileSnapshotHarness(run) {
  const harness = await createFileSnapshotHarness()
  try {
    await run(harness)
  } finally {
    await harness.dispose()
  }
}

async function moveBookmark(client, title, targetFolderTitle) {
  const resource = await client.getResource()
  const tree = await resource.getBookmarksTree(true)
  const bookmark = findBookmark(tree, title)
  const target = findFolder(tree, targetFolderTitle)
  if (!bookmark) {
    throw new Error(`Client ${client.label} has no bookmark ${title}`)
  }
  if (!target) {
    throw new Error(`Client ${client.label} has no folder ${targetFolderTitle}`)
  }
  await resource.updateBookmark(new Bookmark({
    id: bookmark.id,
    parentId: target.id,
    title: bookmark.title,
    url: bookmark.url,
    tags: bookmark.tags,
    location: bookmark.location,
  }))
}

// ---------------------------------------------------------------------------
// Git helpers
// ---------------------------------------------------------------------------

function gitData(server) {
  return {
    type: 'git',
    url: server.url,
    branch: BRANCH,
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

async function seedGitServer(server, ...bookmarkTitles) {
  const adapter = new GitAdapter(gitData(server))
  await adapter.onSyncStart(false)
  const root = await adapter.getBookmarksTree(true)
  for (const title of bookmarkTitles) {
    await adapter.createBookmark(new Bookmark({
      title,
      url: `http://${title}.example/`,
      parentId: root.id,
      location: ItemLocation.SERVER,
    }))
  }
  await adapter.onSyncComplete()
}

async function gitLocalTree(account) {
  return (await account.getResource()).getBookmarksTree(true)
}

async function gitLocalTitles(account) {
  return titles(await gitLocalTree(account))
}

async function gitServerTree(server) {
  const contents = await server.git(['show', BRANCH + ':bookmarks.xbel'])
  return XbelSerializer.deserializeFile(contents).tree
}

async function gitServerTitles(server) {
  return titles(await gitServerTree(server))
}

async function createLocalBookmark(account, title) {
  const resource = await account.getResource()
  const root = await resource.getBookmarksTree(true)
  return resource.createBookmark(new Bookmark({
    title,
    url: `http://${title}.example/`,
    parentId: root.id,
    location: ItemLocation.LOCAL,
  }))
}

async function gitCommits(server) {
  return Number((await server.git(['rev-list', '--count', BRANCH])).trim())
}

function deferred() {
  let resolve
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

// ---------------------------------------------------------------------------

describe('Two-client acceptance suite', function() {
  this.timeout(180000)
  this.slow(20000)

  before(async function() {
    const controller = await Controller.getSingleton()
    controller.setEnabled(false)
  })
  after(async function() {
    const controller = await Controller.getSingleton()
    controller.setEnabled(true)

    const summary = [
      `scenarios: ${metrics.scenarios}`,
      `resurrections: ${metrics.resurrections}`,
      `duplicates: ${metrics.duplicates}`,
      `lost items: ${metrics.lostItems}`,
      `unexpected items: ${metrics.unexpectedItems}`,
      `cache resets on transient failures: ${metrics.cacheResets} (${metrics.cacheChecks} failures checked)`,
      `lease races: ${metrics.leaseRaces}, double holders: ${metrics.leaseDoubleHolders}`,
    ].join('\n  ')
    console.log('\n  Two-client acceptance metrics:\n  ' + summary + '\n')

    expect(metrics.resurrections, 'deleted items resurrected').to.equal(0)
    expect(metrics.duplicates, 'duplicated items').to.equal(0)
    expect(metrics.lostItems, 'lost items').to.equal(0)
    expect(metrics.unexpectedItems, 'unexpected items').to.equal(0)
    expect(metrics.cacheResets, 'cache resets on transient failures').to.equal(0)
    expect(metrics.leaseDoubleHolders, 'clients that held the lease at the same time').to.equal(0)
    expect(metrics.scenarios, 'scenarios run').to.be.greaterThan(0)
  })

  // -------------------------------------------------------------------------
  describe('concurrent additions, deletions and moves', function() {
    it('converges both clients and the server without losing an item', function() {
      return withFileSnapshotHarness(async(harness) => {
        const { A, B } = harness.clients
        const rootId = await A.rootId()
        const alpha = await A.createFolder('alpha', rootId)
        const beta = await A.createFolder('beta', rootId)
        for (const title of ['a1', 'a2', 'a3']) {
          await A.createBookmark(title, `http://${title}.example/`, alpha)
        }
        for (const title of ['b1', 'b2']) {
          await A.createBookmark(title, `http://${title}.example/`, beta)
        }
        await harness.sync('A', 'B')
        assertRootTitles(await A.localTree(), ['alpha', 'beta'], 'A before the concurrent edits')

        // Neither client has seen the other's edits yet.
        await A.createBookmark('a4', 'http://a4.example/', alpha)
        await A.removeBookmark(findBookmark(await A.localTree(), 'b1').id)
        await moveBookmark(A, 'a3', 'beta')

        const bTree = await B.localTree()
        await B.createBookmark('b3', 'http://b3.example/', findFolder(bTree, 'beta').id)
        await B.removeBookmark(findBookmark(bTree, 'a1').id)
        await moveBookmark(B, 'b2', 'alpha')

        // Explicitly ordered, independent syncs: each reads the file the last
        // one wrote.
        await harness.sync('A', 'B', 'A', 'B')

        const expected = ['alpha/a2', 'alpha/a4', 'alpha/b2', 'beta/a3', 'beta/b3']
        assertShape(await A.localTree(), expected, 'client A')
        assertShape(await B.localTree(), expected, 'client B')
        assertShape(harness.serverTree(), expected, 'the server')
        expectTreeEqual(await A.localTree(), await B.localTree(), false, true)
        expectTreeEqual(await A.localTree(), harness.serverTree(), false, true)

        assertGone(await A.localTree(), 'a1', 'client A')
        assertGone(await B.localTree(), 'a1', 'client B')
        assertGone(await A.localTree(), 'b1', 'client A')
        assertGone(harness.serverTree(), 'b1', 'the server')

        // A further quiet round writes nothing and keeps the result.
        const writes = harness.server.writes.length
        await harness.sync('A', 'B', 'A', 'B')
        expect(harness.server.writes).to.have.length(writes)
        assertShape(harness.serverTree(), expected, 'the server after a quiet round')

        recordScenario()
      })
    })
  })

  // -------------------------------------------------------------------------
  describe('fresh cache and deletions', function() {
    it('honors deletions with an empty cache and a known revision', function() {
      return withFileSnapshotHarness(async(harness) => {
        const { A, B } = harness.clients
        const rootId = await A.rootId()
        const folderId = await A.createFolder('folder', rootId)
        await A.createBookmark('keep', 'http://keep.example/', rootId)
        await A.createBookmark('gone', 'http://gone.example/', rootId)
        await A.createBookmark('inside', 'http://inside.example/', folderId)
        await harness.sync('A', 'B')
        assertRootTitles(await B.localTree(), ['folder', 'gone', 'keep'], 'B before the deletion')

        // A deletes a bookmark and a folder with its contents
        await A.removeBookmark(findBookmark(await A.localTree(), 'gone').id)
        await A.removeFolder(findFolder(await A.localTree(), 'folder').id)
        await harness.sync('A')
        assertRootTitles(harness.serverTree(), ['keep'], 'the server after the deletions')

        // B loses cache and mappings but keeps the revision it last synced
        const previousRevision = B.account.getData().lastServerRevision
        expect(previousRevision).to.be.a('string')
        await B.account.reset()
        await harness.syncClient('B')

        assertRootTitles(await B.localTree(), ['keep'], 'B after the reset')
        assertGone(await B.localTree(), 'gone', 'B after the reset')
        assertGone(await B.localTree(), 'inside', 'B after the reset')
        assertGone(await B.localTree(), 'folder', 'B after the reset')
        expect(findFolder(await B.localTree(), 'folder')).to.not.be.ok
        expect(B.account.getData().lastServerRevision).to.not.equal(previousRevision)
        assertNoDuplicates(await B.localTree(), 'B after the reset')

        // The deletion sticks when both clients sync again
        await harness.sync('A', 'B', 'A', 'B')
        assertRootTitles(await A.localTree(), ['keep'], 'A after the deletion settled')
        assertRootTitles(await B.localTree(), ['keep'], 'B after the deletion settled')
        assertRootTitles(harness.serverTree(), ['keep'], 'the server after the deletion settled')
        assertGone(harness.serverTree(), 'gone', 'the server')
        assertGone(harness.serverTree(), 'inside', 'the server')

        recordScenario()
      })
    })
  })

  // -------------------------------------------------------------------------
  describe('interrupt and recovery', function() {
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

    it('does not duplicate items when interrupted after the server commit', async function() {
      const { A } = harness.clients
      await A.createBookmark('one', 'http://one.example/', await A.rootId())
      await A.createBookmark('two', 'http://two.example/', await A.rootId())

      A.account.onSyncProcessCreated = (syncProcess) => {
        syncProcess.setInterruptAfterCommit()
      }
      await A.account.sync()
      A.account.onSyncProcessCreated = null
      expect(A.account.getData().error).to.contain('E026')

      // The server plan is durable, and the continuation records that boundary
      assertRootTitles(harness.serverTree(), ['one', 'two'], 'the server after the commit')
      expect(harness.server.writes).to.deep.equal(['A'])
      const continuation = await A.account.storage.getCurrentContinuation()
      expect(continuation).to.be.ok
      expect(continuation.committedRevision).to.be.a('string').and.not.empty

      await A.account.sync()
      expect(A.account.getData().error).to.not.be.ok

      // Resuming must not run the committed server plan again
      assertRootTitles(harness.serverTree(), ['one', 'two'], 'the server after the resume')
      expect(harness.server.writes).to.deep.equal(['A'])
      assertRootTitles(await A.localTree(), ['one', 'two'], 'client A after the resume')
      assertNoDuplicates(await A.localTree(), 'client A after the resume')
      assertNoDuplicates(harness.serverTree(), 'the server after the resume')

      recordScenario()
    })

    it('does not duplicate items when interrupted during the local plan', async function() {
      const { A, B } = harness.clients
      await A.createBookmark('seed', 'http://seed.example/', await A.rootId())
      await harness.sync('A', 'B')

      // Two server changes for A to apply locally, and one local change for A
      // to carry to the server
      await B.createBookmark('fromB1', 'http://fromb1.example/', await B.rootId())
      await B.createBookmark('fromB2', 'http://fromb2.example/', await B.rootId())
      await harness.sync('B')
      await A.createBookmark('fromA', 'http://froma.example/', await A.rootId())

      A.account.onSyncProcessCreated = (syncProcess) => {
        const executeStage2 = syncProcess.executeStage2.bind(syncProcess)
        syncProcess.executeStage2 = async(resource, plan, targetLocation, ...rest) => {
          if (targetLocation === ItemLocation.LOCAL) {
            // Stop after the first of the two local creates, after the server
            // has already committed fromA.
            syncProcess.setInterruptAfterActions(syncProcess.getActionsDone() + 1)
          }
          return executeStage2(resource, plan, targetLocation, ...rest)
        }
      }
      await A.account.sync()
      A.account.onSyncProcessCreated = null
      expect(A.account.getData().error).to.contain('E026')

      // The server took fromA before the local plan started; only part of the
      // server's two items may have reached A.
      assertRootTitles(harness.serverTree(), ['fromA', 'fromB1', 'fromB2', 'seed'], 'the server')
      expect(A.account.getData().lastServerRevision).to.be.a('string')

      await A.account.sync()
      expect(A.account.getData().error).to.not.be.ok

      const expected = ['fromA', 'fromB1', 'fromB2', 'seed']
      assertRootTitles(await A.localTree(), expected, 'client A after the resume')
      assertNoDuplicates(await A.localTree(), 'client A after the resume')
      assertRootTitles(harness.serverTree(), expected, 'the server after the resume')
      assertNoDuplicates(harness.serverTree(), 'the server after the resume')

      await harness.sync('B')
      assertRootTitles(await B.localTree(), expected, 'client B after catching up')
      assertNoDuplicates(await B.localTree(), 'client B after catching up')

      recordScenario()
    })
  })

  // -------------------------------------------------------------------------
  describe('lease races over git smart-HTTP', function() {
    before(function() {
      setGitHttpClient(httpNode)
    })
    after(function() {
      setGitHttpClient(null)
    })

    it('gives the lease to one client and merges both edits', async function() {
      const server = await createGitHttpServer()
      const accounts = []
      try {
        await seedGitServer(server, 'shared')
        const A = await createGitAccount(server)
        accounts.push(A)
        await A.sync()
        const B = await createGitAccount(server)
        accounts.push(B)
        await B.sync()
        expect(A.getData().error).to.not.be.ok
        expect(B.getData().error).to.not.be.ok

        await createLocalBookmark(A, 'fromA')
        await createLocalBookmark(B, 'fromB')

        // Hold A in the middle of its sync, after it acquired the lease but
        // before it read the server tree.
        const aServer = await A.getServer()
        const originalGetBookmarksTree = aServer.getBookmarksTree.bind(aServer)
        const holding = deferred()
        const release = deferred()
        aServer.getBookmarksTree = async(...args) => {
          holding.resolve()
          await release.promise
          return originalGetBookmarksTree(...args)
        }

        const commitsBefore = await gitCommits(server)
        const aSync = A.sync()
        try {
          await holding.promise

          // A holds the lease while B tries to sync
          const leaseOid = (await server.git(['rev-parse', '--verify', LOCK_REF])).trim()
          expect(leaseOid).to.have.length(40)
          metrics.leaseRaces++

          await B.sync()
          expect(B.getData().error).to.not.be.ok

          const commitsWhileLocked = await gitCommits(server)
          const bTitlesWhileLocked = await gitLocalTitles(B)
          if (commitsWhileLocked !== commitsBefore || bTitlesWhileLocked.includes('fromA')) {
            metrics.leaseDoubleHolders++
          }
          expect(commitsWhileLocked, 'the locked client must not write').to.equal(commitsBefore)
          expect(bTitlesWhileLocked).to.deep.equal(['fromB', 'shared'])
          expect((await server.git(['rev-parse', '--verify', LOCK_REF])).trim())
            .to.equal(leaseOid)
        } finally {
          release.resolve()
          await aSync
          aServer.getBookmarksTree = originalGetBookmarksTree
        }

        // A committed and released the lease; B now gets it and pushes its
        // own change on top of A's, without overwriting anything.
        expect(A.getData().error).to.not.be.ok
        await expect(server.git(['rev-parse', '--verify', LOCK_REF])).to.be.rejected
        expect(await gitServerTitles(server)).to.deep.equal(['fromA', 'shared'])

        await B.sync()
        expect(B.getData().error).to.not.be.ok

        // A picks B's commit up on its next sync
        await A.sync()
        expect(A.getData().error).to.not.be.ok

        const expected = ['fromA', 'fromB', 'shared']
        assertRootTitles(await gitLocalTree(A), expected, 'client A')
        assertRootTitles(await gitLocalTree(B), expected, 'client B')
        assertRootTitles(await gitServerTree(server), expected, 'the git server')
        assertNoDuplicates(await gitLocalTree(A), 'client A')
        assertNoDuplicates(await gitLocalTree(B), 'client B')
        // Ordering has a scenario group of its own; this one is about lost
        // updates.
        expectTreeEqual(await gitLocalTree(A), await gitLocalTree(B), false, false)

        recordScenario()
      } finally {
        for (const account of accounts) {
          await clearLocalResource(account)
          await account.delete()
        }
        await server.close()
      }
    })

    it('retries a rejected push without duplicating the local change', async function() {
      const server = await createGitHttpServer()
      const accounts = []
      try {
        await seedGitServer(server, 'shared')
        const A = await createGitAccount(server)
        accounts.push(A)
        await A.sync()
        const B = await createGitAccount(server)
        accounts.push(B)
        await B.sync()

        await createLocalBookmark(A, 'fromA')
        await createLocalBookmark(B, 'fromB')
        await B.sync()
        expect(B.getData().error).to.not.be.ok
        expect(await gitServerTitles(server)).to.deep.equal(['fromB', 'shared'])

        const before = await storedState(A)

        // Move the branch to a commit that is not a descendant of the revision
        // A read, so the non-force push is rejected.
        let raced = false
        server.beforeRequest = async(req) => {
          if (raced || req.method !== 'POST' || !req.url.includes('git-receive-pack')) {
            return
          }
          raced = true
          const tree = (await server.git(['rev-parse', 'refs/heads/main^{tree}'])).trim()
          const oid = (await server.git(['commit-tree', tree, '-m', 'concurrent writer'])).trim()
          await server.git(['update-ref', 'refs/heads/main', oid])
        }

        await A.sync()
        server.beforeRequest = null
        expect(raced).to.be.true
        expect(A.getData().error).to.be.ok

        // A failed push must not touch the cache, and must not run the local
        // plan: A still has only its own change.
        assertCachePreserved(before, await storedState(A), 'rejected push')
        expect(await gitLocalTitles(A)).to.deep.equal(['fromA', 'shared'])
        expect(await gitServerTitles(server)).to.deep.equal(['fromB', 'shared'])

        await A.sync()
        expect(A.getData().error).to.not.be.ok

        const expected = ['fromA', 'fromB', 'shared']
        assertRootTitles(await gitLocalTree(A), expected, 'client A after the retry')
        assertRootTitles(await gitServerTree(server), expected, 'the git server after the retry')
        assertNoDuplicates(await gitLocalTree(A), 'client A after the retry')
        assertNoDuplicates(await gitServerTree(server), 'the git server after the retry')

        await B.sync()
        expect(B.getData().error).to.not.be.ok
        assertRootTitles(await gitLocalTree(B), expected, 'client B after catching up')
        assertNoDuplicates(await gitLocalTree(B), 'client B after catching up')

        recordScenario()
      } finally {
        for (const account of accounts) {
          await clearLocalResource(account)
          await account.delete()
        }
        await server.close()
      }
    })
  })

  // -------------------------------------------------------------------------
  describe('reordering', function() {
    async function reorder(client, order) {
      const resource = await client.getResource()
      const folder = findFolder(await resource.getBookmarksTree(true), 'ordered')
      const byTitle = {}
      for (const child of folder.children) {
        byTitle[child.title] = child
      }
      await resource.orderFolder(
        folder.id,
        order.map((title) => ({ type: byTitle[title].type, id: byTitle[title].id }))
      )
    }

    function folderOrder(tree, title) {
      return findFolder(tree, title).children.map((child) => child.title)
    }

    it('propagates a real reorder and stays quiet once both clients agree', function() {
      return withFileSnapshotHarness(async(harness) => {
        const { A, B } = harness.clients
        const folderId = await A.createFolder('ordered', await A.rootId())
        for (const title of ['one', 'two', 'three']) {
          await A.createBookmark(title, `http://${title}.example/`, folderId)
        }
        await harness.sync('A', 'B')
        expect(harness.server.writes).to.deep.equal(['A'])

        await reorder(B, ['three', 'two', 'one'])
        await harness.sync('B')
        expect(harness.server.writes).to.deep.equal(['A', 'B'])
        expect(folderOrder(harness.serverTree(), 'ordered')).to.deep.equal(['three', 'two', 'one'])

        await harness.sync('A')
        expect(harness.server.writes).to.deep.equal(['A', 'B'])
        expect(folderOrder(await A.localTree(), 'ordered')).to.deep.equal(['three', 'two', 'one'])

        await harness.sync('A', 'B', 'A', 'B')
        expect(harness.server.writes).to.deep.equal(['A', 'B'])
        expect(folderOrder(await A.localTree(), 'ordered')).to.deep.equal(['three', 'two', 'one'])
        expect(folderOrder(await B.localTree(), 'ordered')).to.deep.equal(['three', 'two', 'one'])
        expect(folderOrder(harness.serverTree(), 'ordered')).to.deep.equal(['three', 'two', 'one'])
        assertNoDuplicates(await A.localTree(), 'client A after the reorder')

        recordScenario()
      })
    })
  })

  // -------------------------------------------------------------------------
  describe('transient failure state', function() {
    const failures = [
      {
        name: 'cancel',
        code: 'E026',
        during: 'serverPlan',
        error: () => new CancelledSyncError(),
      },
      {
        name: 'network error',
        code: 'E017',
        during: 'serverPlan',
        error: () => new NetworkError(),
      },
      {
        name: 'rejected push',
        code: 'E037',
        during: 'commit',
        error: () => new ResourceLockedError(),
      },
      {
        name: 'conditional-write conflict',
        code: 'E060',
        during: 'commit',
        error: () => new RemoteFileChangedError(),
      },
    ]

    for (const failure of failures) {
      it(`keeps the cache across a ${failure.name}`, async function() {
        const harness = await createFileSnapshotHarness()
        try {
          const { A, B } = harness.clients
          await A.createBookmark('keep', 'http://keep.example/', await A.rootId())
          await A.createBookmark('gone', 'http://gone.example/', await A.rootId())
          await harness.sync('A', 'B')

          // A deletion and a creation with work left in both directions
          await A.removeBookmark(findBookmark(await A.localTree(), 'gone').id)
          await A.createBookmark('new', 'http://new.example/', await A.rootId())
          const before = await storedState(A.account)

          const server = await A.account.getServer()
          if (failure.during === 'commit') {
            server.failNextCommit = failure.error()
            await A.account.sync()
          } else {
            const originalRemoveBookmark = server.removeBookmark.bind(server)
            server.removeBookmark = async() => {
              // A progress tick first: before the commit it must persist
              // nothing, so the cache keeps the common ancestor.
              await A.account.progressCallback(0.6, 1)
              throw failure.error()
            }
            try {
              await A.account.sync()
            } finally {
              server.removeBookmark = originalRemoveBookmark
            }
          }

          expect(A.account.getData().error).to.contain(failure.code)
          assertCachePreserved(before, await storedState(A.account), failure.name)

          // The retry carries the deletion and the creation through, once each
          await harness.syncClient('A')
          await harness.sync('B')
          const expected = ['keep', 'new']
          assertRootTitles(await A.localTree(), expected, 'client A after the retry')
          assertRootTitles(await B.localTree(), expected, 'client B after the retry')
          assertRootTitles(harness.serverTree(), expected, 'the server after the retry')
          assertNoDuplicates(await A.localTree(), 'client A after the retry')
          assertNoDuplicates(harness.serverTree(), 'the server after the retry')
          assertGone(await A.localTree(), 'gone', 'client A after the retry')
          assertGone(await B.localTree(), 'gone', 'client B after the retry')
          assertGone(harness.serverTree(), 'gone', 'the server after the retry')

          recordScenario()
        } finally {
          await harness.dispose()
        }
      })
    }
  })
})
