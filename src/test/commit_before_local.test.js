/* global globalThis */
import './node-shims/indexeddb.js'
import httpNode from 'isomorphic-git/http/node'
import Account from '../lib/Account'
import Controller from '../lib/Controller'
import GitAdapter, { setGitHttpClient } from '../lib/adapters/Git'
import XbelSerializer from '../lib/serializers/Xbel'
import { Bookmark, ItemLocation } from '../lib/Tree'
import { clearLocalResource, createTestLocalRoot, expect } from './utils'
import { createFileSnapshotHarness } from './file-snapshot-harness'
import { createGitHttpServer } from './git-http-server'

// LightningFS picks its Web Locks mutex when navigator.locks exists (node ships
// it), and that mutex keeps the process alive long after the suite has ended.
// See file_snapshot_harness.test.js.
Object.defineProperty(globalThis.navigator, 'locks', {
  value: undefined,
  configurable: true,
})

function titles(tree) {
  return tree.children.map((child) => child.title).sort()
}

async function localTitles(client) {
  return titles(await client.localTree())
}

function serverTitles(harness) {
  return titles(harness.serverTree())
}

function folderTitles(tree, title) {
  const folder = tree.children.find((child) => child.title === title)
  if (!folder) {
    throw new Error(`No folder ${title}`)
  }
  return folder.children.map((child) => child.title)
}

async function localBookmarkByTitle(client, title) {
  const tree = await client.localTree()
  return tree.children.find((child) => child.title === title)
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

async function gitServerTitles(server) {
  const contents = await server.git(['show', 'main:bookmarks.xbel'])
  return titles(XbelSerializer.deserializeFile(contents).tree)
}

async function gitLocalTitles(account) {
  const resource = await account.getResource()
  return titles(await resource.getBookmarksTree(true))
}

async function createLocalBookmark(account, title) {
  const resource = await account.getResource()
  const root = await resource.getBookmarksTree(true)
  await resource.createBookmark(new Bookmark({
    title,
    url: `http://${title}.example/`,
    parentId: root.id,
    location: ItemLocation.LOCAL,
  }))
}

describe('Commit-before-local ordering', function() {
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

    it('aborts before applying the local plan when the commit fails', async function() {
      const { A, B } = harness.clients

      // B has a cache, so the second sync runs the default strategy
      await A.createBookmark('shared', 'http://shared.example/', await A.rootId())
      await harness.sync('A')
      await harness.sync('B')

      // A change on the server that B has not seen yet, and one made locally
      await A.createBookmark('later', 'http://later.example/', await A.rootId())
      await harness.sync('A')
      await B.createBookmark('local', 'http://local.example/', await B.rootId())

      const server = await B.account.getServer()
      server.failNextCommit = new Error('simulated push failure')

      await B.account.sync()
      expect(B.account.getData().error).to.be.ok

      // The server did not take B's change, and B's local tree did not take
      // the server's: the local plan only runs after a successful commit.
      expect(serverTitles(harness)).to.deep.equal(['later', 'shared'])
      expect(await localTitles(B)).to.deep.equal(['local', 'shared'])

      // A retry converges, with every item exactly once
      await harness.syncClient('B')
      expect(serverTitles(harness)).to.deep.equal(['later', 'local', 'shared'])
      expect(await localTitles(B)).to.deep.equal(['later', 'local', 'shared'])
    })

    it('resumes after a committed server plan without creating anything twice', async function() {
      const { A } = harness.clients

      await A.createBookmark('one', 'http://one.example/', await A.rootId())
      A.account.onSyncProcessCreated = (syncProcess) => {
        syncProcess.setInterruptAfterCommit()
      }

      await A.account.sync()
      expect(A.account.getData().error).to.contain('E026')

      // The boundary was persisted: the next sync knows the server plan is done
      const continuation = await A.account.storage.getCurrentContinuation()
      expect(continuation).to.be.ok
      expect(continuation.committedRevision).to.be.a('string').and.not.empty
      expect(serverTitles(harness)).to.deep.equal(['one'])
      expect(harness.server.writes).to.deep.equal(['A'])

      A.account.onSyncProcessCreated = null
      await A.account.sync()
      expect(A.account.getData().error).to.not.be.ok

      // A resumed sync that re-ran the server plan would create a second 'one'
      // and write the snapshot again.
      expect(serverTitles(harness)).to.deep.equal(['one'])
      expect(harness.server.writes).to.deep.equal(['A'])
      expect(await localTitles(A)).to.deep.equal(['one'])
    })

    it('persists a cache that both the committed server and the local side agree on', async function() {
      const { A, B } = harness.clients

      await A.createBookmark('gone', 'http://gone.example/', await A.rootId())
      await harness.sync('A')
      await harness.sync('B')

      // The server drops 'gone' while B still has it; B adds 'kept'
      await A.removeBookmark((await localBookmarkByTitle(A, 'gone')).id)
      await harness.sync('A')
      await B.createBookmark('kept', 'http://kept.example/', await B.rootId())

      B.account.onSyncProcessCreated = (syncProcess) => {
        syncProcess.setInterruptAfterCommit()
      }
      await B.account.sync()
      expect(B.account.getData().error).to.contain('E026')

      // The commit landed, so the server has 'kept' and no longer has 'gone'.
      // The local plan has not run, so B's tree still has 'gone'. The cache is
      // exactly that common ancestor: it must not drop 'gone' (the local side
      // still has it, and dropping it would make the next scan think the item
      // was created locally and resurrect it) and it must not gain anything B
      // has not got yet.
      expect(serverTitles(harness)).to.deep.equal(['kept'])
      expect(await localTitles(B)).to.deep.equal(['gone', 'kept'])
      expect(titles(await B.account.storage.getCache())).to.deep.equal(['gone', 'kept'])

      B.account.onSyncProcessCreated = null
      await B.account.sync()
      expect(B.account.getData().error).to.not.be.ok
      expect(serverTitles(harness)).to.deep.equal(['kept'])
      expect(await localTitles(B)).to.deep.equal(['kept'])
    })

    it('keeps mappings and the id counter usable after a failed commit', async function() {
      const { A, B } = harness.clients

      await A.createBookmark('shared', 'http://shared.example/', await A.rootId())
      await harness.sync('A')
      await harness.sync('B')

      await B.createBookmark('first', 'http://first.example/', await B.rootId())
      const server = await B.account.getServer()
      server.failNextCommit = new Error('simulated push failure')
      await B.account.sync()
      expect(B.account.getData().error).to.be.ok

      // The server plan's mappings must not survive the failed commit: adding
      // another item and retrying has to create both exactly once.
      await B.createBookmark('second', 'http://second.example/', await B.rootId())
      await harness.syncClient('B')

      const tree = harness.serverTree()
      const serverIds = tree.children.map((child) => String(child.id))
      expect(new Set(serverIds).size).to.equal(serverIds.length)
      expect(serverTitles(harness)).to.deep.equal(['first', 'second', 'shared'])
      expect(await localTitles(B)).to.deep.equal(['first', 'second', 'shared'])
    })

    it('does not record server reorders before the commit that makes them durable', async function() {
      const { A, B } = harness.clients

      const folderId = await A.createFolder('ordered', await A.rootId())
      for (const title of ['one', 'two', 'three']) {
        await A.createBookmark(title, `http://${title}.example/`, folderId)
      }
      await harness.sync('A', 'B')
      expect(harness.server.writes).to.deep.equal(['A'])

      // B reorders locally, so its sync has to push that order to the server
      const resource = await B.getResource()
      const folder = (await resource.getBookmarksTree(true)).children
        .find((child) => child.title === 'ordered')
      const reversed = folder.children.slice().reverse()
      await resource.orderFolder(
        folder.id,
        reversed.map((item) => ({ type: item.type, id: item.id }))
      )

      B.account.onSyncProcessCreated = (syncProcess) => {
        const executeServerReorders = syncProcess.executeServerReorders.bind(syncProcess)
        syncProcess.executeServerReorders = async(reorderings) => {
          if (reorderings && reorderings.peekActions().length) {
            // A progress tick just before the drain persists the pending
            // reorders: that continuation is what a resume starts from.
            await B.account.progressCallback(0.9, Math.max(1, syncProcess.getActionsDone()))
            // Stop at the first server reorder, after it has left its diff but
            // before its commit -- the window this test is about.
            syncProcess.setInterruptAfterActions(syncProcess.getActionsDone() + 1)
          }
          return executeServerReorders(reorderings)
        }
      }

      await B.account.sync()
      B.account.onSyncProcessCreated = null
      expect(B.account.getData().error).to.contain('E026')

      // The reorder only reached the adapter, whose staged snapshot is gone
      // with the process: the server still has the old order.
      expect(folderTitles(harness.serverTree(), 'ordered')).to.deep.equal(['one', 'two', 'three'])
      expect(harness.server.writes).to.deep.equal(['A'])

      // The interrupt must not have recorded the drained reorder as done: the
      // continuation still has the action for a resume to replay.
      const continuation = await B.account.storage.getCurrentContinuation()
      expect(continuation).to.be.ok
      expect(continuation.serverReorders).to.have.length(1)

      await B.account.sync()
      expect(B.account.getData().error).to.not.be.ok

      // The reorder was pushed exactly once, after the resume committed it
      expect(harness.server.writes).to.deep.equal(['A', 'B'])
      expect(folderTitles(harness.serverTree(), 'ordered')).to.deep.equal(['three', 'two', 'one'])
      expect(folderTitles(await B.localTree(), 'ordered')).to.deep.equal(['three', 'two', 'one'])
      expect((await B.localTree()).children
        .find((child) => child.title === 'ordered').children).to.have.length(3)
      expect(await B.account.storage.getCurrentContinuation()).to.not.be.ok
    })

    it('does not commit a second time when there are no reorders', async function() {
      const { A } = harness.clients
      const server = await A.account.getServer()
      let commits = 0
      const commit = server.onSyncCommit.bind(server)
      server.onSyncCommit = async() => {
        commits++
        return commit()
      }

      await A.createBookmark('one', 'http://one.example/', await A.rootId())
      await A.account.sync()
      expect(A.account.getData().error).to.not.be.ok

      // One commit for the server plan; the reorder commit has nothing to do
      // and must not hash and upload the unchanged tree again.
      expect(commits).to.equal(1)
      expect(harness.server.writes).to.deep.equal(['A'])
    })
  })

  describe('git smart-HTTP backend', function() {
    it('does not advance the local tree when the push is rejected', async function() {
      setGitHttpClient(httpNode)
      const server = await createGitHttpServer()
      let account
      try {
        await seedGitServer(server, 'shared')

        account = await Account.create({ ...gitData(server), ...(await createTestLocalRoot()) })
        await account.init()
        await account.sync()
        expect(account.getData().error).to.not.be.ok
        expect(await gitLocalTitles(account)).to.deep.equal(['shared'])

        // A server-side change the account has not seen, and a local change
        await seedGitServer(server, 'later')
        await createLocalBookmark(account, 'local')

        // Reject the next push by moving the branch to a commit that is not a
        // descendant of the revision this sync read.
        let raced = false
        server.beforeRequest = async(req) => {
          if (!raced && req.method === 'POST' && req.url.includes('git-receive-pack')) {
            raced = true
            const tree = (await server.git(['rev-parse', 'refs/heads/main^{tree}'])).trim()
            const oid = (await server.git(['commit-tree', tree, '-m', 'concurrent writer'])).trim()
            await server.git(['update-ref', 'refs/heads/main', oid])
          }
        }

        await account.sync()
        server.beforeRequest = null
        expect(raced).to.be.true
        expect(account.getData().error).to.be.ok

        // The push failed, so no local action ran: 'later' is not local yet.
        expect(await gitLocalTitles(account)).to.deep.equal(['local', 'shared'])
        expect(await gitServerTitles(server)).to.deep.equal(['later', 'shared'])

        await account.sync()
        expect(account.getData().error).to.not.be.ok
        expect(await gitLocalTitles(account)).to.deep.equal(['later', 'local', 'shared'])
        expect(await gitServerTitles(server)).to.deep.equal(['later', 'local', 'shared'])
      } finally {
        if (account) {
          await clearLocalResource(account)
          await account.delete()
        }
        await server.close()
        setGitHttpClient(null)
      }
    })
  })
})
