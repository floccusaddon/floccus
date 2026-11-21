/* global globalThis */
import './node-shims/indexeddb.js'
import fs from 'fs'
import os from 'os'
import path from 'path'
import * as git from 'isomorphic-git'
import httpNode from 'isomorphic-git/http/node'
import Account from '../lib/Account'
import GitAdapter, { setGitHttpClient } from '../lib/adapters/Git'
import XbelSerializer from '../lib/serializers/Xbel'
import { Bookmark, ItemLocation } from '../lib/Tree'
import { RemoteFileChangedError, ResourceLockedError } from '../errors/Error'
import { clearLocalResource, createTestLocalRoot, expect } from './utils'
import { createGitHttpServer } from './git-http-server'

// See file_snapshot_harness.test.js: LightningFS' Web Locks mutex keeps the
// test process alive long after the suite has finished.
Object.defineProperty(globalThis.navigator, 'locks', {
  value: undefined,
  configurable: true,
})

const BRANCH = 'main'
const LOCK_REF = 'refs/heads/floccus-lock'
const LOCK_TIMEOUT = 15 * 60 * 1000

function adapterFor(server, branch = BRANCH) {
  return new GitAdapter({
    type: 'git',
    url: server.url,
    branch,
    username: 'floccus',
    password: 'floccus',
    bookmark_file: 'bookmarks.xbel',
    bookmark_file_type: 'xbel',
    includeCredentials: false,
    allowRedirects: false,
    allowNetwork: false,
  })
}

function bookmark(title, parentId) {
  return new Bookmark({
    title,
    url: `http://${title}.example/`,
    parentId,
    location: ItemLocation.SERVER,
  })
}

async function addBookmark(adapter, title) {
  const root = await adapter.getBookmarksTree()
  await adapter.createBookmark(bookmark(title, root.id))
}

function titles(tree) {
  return tree.children.map((child) => child.title).sort()
}

async function remoteTitles(server) {
  const contents = await server.git(['show', BRANCH + ':bookmarks.xbel'])
  return titles(XbelSerializer.deserializeFile(contents).tree)
}

async function localTitles(adapter) {
  return titles(await adapter.getBookmarksTree(true))
}

async function remoteHead(server, ref = 'refs/heads/' + BRANCH) {
  try {
    return (await server.git(['rev-parse', '--verify', ref])).trim()
  } catch (e) {
    return null
  }
}

async function tempRepo() {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'floccus-git-writer-'))
  await git.init({ fs, dir, defaultBranch: BRANCH })
  await fs.promises.writeFile(path.join(dir, 'README.md'), 'writer')
  await git.add({ fs, dir, filepath: 'README.md' })
  return dir
}

function author(timestamp = Date.now()) {
  return {
    name: 'Another floccus client',
    email: 'floccus@example.org',
    timestamp: Math.floor(timestamp / 1000),
  }
}

async function writeRemoteLease(server, { owner, timestamp }) {
  const dir = await tempRepo()
  try {
    const oid = await git.commit({
      fs,
      dir,
      message: `floccus lock\n\nowner: ${owner}\ntimestamp: ${timestamp}\n`,
      author: author(timestamp),
    })
    await git.addRemote({ fs, dir, remote: 'origin', url: server.url })
    await git.push({
      fs,
      http: httpNode,
      dir,
      remote: 'origin',
      ref: BRANCH,
      remoteRef: 'refs/heads/floccus-lock',
    })
    return oid
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true })
  }
}

/**
 * Backdate the lease on the server without touching the data branch: a commit
 * on top of the current lease, as a client whose lease expired would leave it.
 */
async function ageRemoteLease(server, timestamp) {
  const head = (await server.git(['rev-parse', '--verify', LOCK_REF])).trim()
  const tree = (await server.git(['rev-parse', '--verify', head + '^{tree}'])).trim()
  const aged = (await server.git([
    '-c', 'user.name=an-old-client', '-c', 'user.email=old@example.org',
    'commit-tree', tree, '-p', head,
    '-m', `floccus lock\n\nowner: an-old-client\ntimestamp: ${timestamp}\n`,
  ])).trim()
  await server.git(['update-ref', LOCK_REF, aged])
  return aged
}

async function writeLegacyLockTag(server, timestamp) {
  const dir = await tempRepo()
  try {
    const oid = await git.commit({
      fs,
      dir,
      message: 'legacy lock',
      author: author(timestamp),
    })
    await git.addRemote({ fs, dir, remote: 'origin', url: server.url })
    const tag = 'floccus-lock-' + timestamp
    await git.tag({ fs, dir, ref: tag, object: oid })
    await git.push({
      fs,
      http: httpNode,
      dir,
      remote: 'origin',
      ref: tag,
    })
    return oid
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true })
  }
}

describe('Git conditional writes and lease', function() {
  this.timeout(120000)
  this.slow(20000)

  let server

  before(function() {
    setGitHttpClient(httpNode)
  })
  after(function() {
    setGitHttpClient(null)
  })
  beforeEach(async function() {
    server = await createGitHttpServer()
  })
  afterEach(async function() {
    if (server) {
      await server.close()
      server = null
    }
  })

  async function seed(bookmarks = ['seed']) {
    const adapter = adapterFor(server)
    await adapter.onSyncStart(false)
    for (const title of bookmarks) {
      await addBookmark(adapter, title)
    }
    await adapter.onSyncComplete()
    return adapter
  }

  describe('conditional write', function() {
    // The write tests start both adapters without the lease (onSyncStart(false)),
    // so both get past the read and the second one hits the conditional push.
    it('writes on top of the revision it fetched', async function() {
      await seed()
      const revision = await remoteHead(server)
      expect(revision).to.have.length(40)

      const second = adapterFor(server)
      await second.onSyncStart(false)
      expect(await localTitles(second)).to.deep.equal(['seed'])
      await addBookmark(second, 'second')
      await second.onSyncComplete()

      const head = await remoteHead(server)
      expect(head).to.not.equal(revision)
      // The commit carrying the bookmark file is parented on the revision the
      // adapter fetched, not on any newer remote state.
      const [, parent] = (await server.git(['rev-list', '--parents', '-1', head])).trim().split(' ')
      expect(parent).to.equal(revision)
    })

    it('rejects a write when the remote branch moved on since the read', async function() {
      await seed(['seed'])

      const slow = adapterFor(server)
      await slow.onSyncStart(false)
      await addBookmark(slow, 'fromSlow')

      const fast = adapterFor(server)
      await fast.onSyncStart(false)
      await addBookmark(fast, 'fromFast')
      await fast.onSyncComplete()

      expect(await remoteTitles(server)).to.deep.equal(['fromFast', 'seed'])

      await expect(slow.onSyncComplete()).to.be.rejectedWith(RemoteFileChangedError)
      await slow.onSyncFail()

      // The racing writer's change was not overwritten
      expect(await remoteTitles(server)).to.deep.equal(['fromFast', 'seed'])
    })

    it('retries against the new tip without losing either side', async function() {
      await seed(['seed'])

      const slow = adapterFor(server)
      await slow.onSyncStart(false)
      await addBookmark(slow, 'fromSlow')

      const fast = adapterFor(server)
      await fast.onSyncStart(false)
      await addBookmark(fast, 'fromFast')
      await fast.onSyncComplete()
      await expect(slow.onSyncComplete()).to.be.rejectedWith(RemoteFileChangedError)
      await slow.onSyncFail()

      // What Account's retry does: refetch, re-merge, write again
      const retry = adapterFor(server)
      await retry.onSyncStart(false)
      expect(await localTitles(retry)).to.deep.equal(['fromFast', 'seed'])
      await addBookmark(retry, 'fromSlow')
      await retry.onSyncComplete()

      expect(await remoteTitles(server)).to.deep.equal(['fromFast', 'fromSlow', 'seed'])
    })

    // The race the pre-push head check cannot see: the branch moves after the
    // check and before the push reaches the server. The non-force push is the
    // actual compare-and-swap, and the other client's commit must survive.
    it('surfaces a branch moved between the head check and the push as a conflict', async function() {
      await seed(['seed'])

      const adapter = adapterFor(server)
      await adapter.onSyncStart(false)
      await addBookmark(adapter, 'fromSlow')

      const parent = await remoteHead(server)
      const tree = (await server.git(['rev-parse', '--verify', parent + '^{tree}'])).trim()
      const racing = (await server.git([
        '-c', 'user.name=racing', '-c', 'user.email=racing@example.org',
        'commit-tree', tree, '-p', parent, '-m', 'racing commit',
      ])).trim()

      let receivePackRequests = 0
      server.beforeRequest = async(req) => {
        if (!req.url.includes('git-receive-pack')) {
          return
        }
        receivePackRequests++
        // GET #1 is the head check, GET #2 the push's discovery; moving the
        // branch when the push itself arrives makes the server reject it
        if (req.method === 'POST' && receivePackRequests === 3) {
          await server.git(['update-ref', 'refs/heads/' + BRANCH, racing])
        }
      }

      await expect(adapter.onSyncComplete()).to.be.rejectedWith(RemoteFileChangedError)
      await adapter.onSyncFail()
      server.beforeRequest = null

      expect(await remoteHead(server)).to.equal(racing)
      expect(await remoteTitles(server)).to.deep.equal(['seed'])
    })

    // A concurrent client may push on top of our commit between our push and
    // the post-push head check. Our commit is then still on the remote, so the
    // sync has not conflicted with anything.
    it('accepts a remote branch that moved on top of our commit after the push', async function() {
      await seed(['seed'])

      const adapter = adapterFor(server)
      await adapter.onSyncStart(false)
      await addBookmark(adapter, 'fromSlow')

      let receivePackRequests = 0
      let descendant = null
      server.beforeRequest = async(req) => {
        if (!req.url.includes('git-receive-pack')) {
          return
        }
        receivePackRequests++
        // GET #4 is the head check after the push (POST #3)
        if (req.method === 'GET' && receivePackRequests === 4) {
          const head = (await server.git(['rev-parse', '--verify', 'refs/heads/' + BRANCH])).trim()
          const tree = (await server.git(['rev-parse', '--verify', head + '^{tree}'])).trim()
          descendant = (await server.git([
            '-c', 'user.name=racing', '-c', 'user.email=racing@example.org',
            'commit-tree', tree, '-p', head, '-m', 'concurrent commit',
          ])).trim()
          await server.git(['update-ref', 'refs/heads/' + BRANCH, descendant])
        }
      }

      await adapter.onSyncComplete()
      server.beforeRequest = null

      expect(await remoteHead(server)).to.equal(descendant)
      expect(await remoteTitles(server)).to.deep.equal(['fromSlow', 'seed'])
    })
  })

  describe('lease', function() {
    it('gives the lease to exactly one of two racing clients', async function() {
      await seed(['seed'])

      const first = adapterFor(server)
      const firstRun = first.onSyncStart()
      await new Promise((resolve) => setTimeout(resolve, 5))
      const second = adapterFor(server)
      const secondRun = second.onSyncStart()

      const results = await Promise.allSettled([firstRun, secondRun])
      const fulfilled = results.filter((result) => result.status === 'fulfilled')
      const rejected = results.filter((result) => result.status === 'rejected')
      const holder = results[0].status === 'fulfilled' ? first : second
      const loser = holder === first ? second : first
      try {
        expect(fulfilled).to.have.length(1)
        expect(rejected).to.have.length(1)
        expect(rejected[0].reason).to.be.an.instanceof(ResourceLockedError)

        const leaseOid = await remoteHead(server, LOCK_REF)
        expect(leaseOid).to.have.length(40)
        const message = await server.git(['log', '-1', '--format=%B', LOCK_REF])
        expect(message).to.contain('owner:')
        expect(message).to.contain('timestamp:')
      } finally {
        // A failed assertion must not leave the holder's refresh interval
        // behind, or the test process never exits.
        await loser.onSyncFail()
        await holder.onSyncComplete()
      }
      expect(await remoteHead(server, LOCK_REF)).to.be.null
    })

    it('never deletes a fresh lease owned by another client', async function() {
      const holder = adapterFor(server)
      await holder.onSyncStart()
      const leaseOid = await remoteHead(server, LOCK_REF)
      expect(leaseOid).to.have.length(40)

      const bystander = adapterFor(server)
      await expect(bystander.onSyncStart()).to.be.rejectedWith(ResourceLockedError)
      await bystander.onSyncFail()
      expect(await remoteHead(server, LOCK_REF)).to.equal(leaseOid)

      // A forced sync proceeds without the lease and does not clear it either
      const forced = adapterFor(server)
      await forced.onSyncStart(false, true)
      await forced.onSyncComplete()
      expect(await remoteHead(server, LOCK_REF)).to.equal(leaseOid)

      await holder.onSyncComplete()
      expect(await remoteHead(server, LOCK_REF)).to.be.null
    })

    it('takes over an expired lease', async function() {
      const expiredOid = await writeRemoteLease(server, {
        owner: 'an-old-client',
        timestamp: Date.now() - LOCK_TIMEOUT - 60000,
      })

      const fresh = adapterFor(server)
      await fresh.onSyncStart()
      const leaseOid = await remoteHead(server, LOCK_REF)
      expect(leaseOid).to.not.equal(expiredOid)

      const other = adapterFor(server)
      await expect(other.onSyncStart()).to.be.rejectedWith(ResourceLockedError)
      await other.onSyncFail()

      await fresh.onSyncComplete()
      expect(await remoteHead(server, LOCK_REF)).to.be.null
    })

    // A sync whose lease delete failed leaves a fresh lease behind, recorded
    // as this adapter's own. Blocking it out of its next sync over that would
    // keep the account from syncing for LOCK_TIMEOUT.
    it('adopts a fresh lease it wrote itself instead of blocking', async function() {
      await seed(['seed'])

      const adapter = adapterFor(server)
      const ownLease = await writeRemoteLease(server, {
        owner: adapter.lockOwner,
        timestamp: Date.now() - 60000,
      })

      await adapter.onSyncStart()
      const refreshed = await remoteHead(server, LOCK_REF)
      expect(refreshed).to.not.equal(ownLease)
      expect(refreshed).to.have.length(40)

      // The refreshed lease still keeps other clients out
      const other = adapterFor(server)
      await expect(other.onSyncStart()).to.be.rejectedWith(ResourceLockedError)
      await other.onSyncFail()

      await adapter.onSyncComplete()
      expect(await remoteHead(server, LOCK_REF)).to.be.null
    })

    // Deleting the lease can fail (a server with receive.denyDeletes, say).
    // Retrying once is not enough then: the lease has to stop looking fresh,
    // or it keeps every client, this one included, out for LOCK_TIMEOUT.
    it('ages a lease it cannot delete so another client can take over', async function() {
      await seed(['seed'])
      await server.git(['config', 'receive.denyDeletes', 'true'])

      const holder = adapterFor(server)
      await holder.onSyncStart()
      const leaseOid = await remoteHead(server, LOCK_REF)
      expect(leaseOid).to.have.length(40)
      await addBookmark(holder, 'fromHolder')
      await holder.onSyncComplete()

      await server.git(['config', 'receive.denyDeletes', 'false'])

      const remaining = await remoteHead(server, LOCK_REF)
      expect(remaining).to.not.equal(null)
      expect(remaining).to.not.equal(leaseOid)
      const message = await server.git(['log', '-1', '--format=%B', LOCK_REF])
      const timestamp = Number(/^timestamp:\s*(\d+)/m.exec(message)[1])
      expect(Date.now() - timestamp).to.be.greaterThan(LOCK_TIMEOUT)

      const next = adapterFor(server)
      await next.onSyncStart()
      expect(await remoteHead(server, LOCK_REF)).to.not.equal(remaining)
      await next.onSyncComplete()
      expect(await remoteHead(server, LOCK_REF)).to.be.null
      expect(await remoteTitles(server)).to.deep.equal(['fromHolder', 'seed'])
    })

    // The old holder must not delete a lease a third client took over after
    // it expired -- not even when its own onSyncFail runs afterwards.
    it('does not delete a lease another client took over after expiry', async function() {
      await seed(['seed'])

      const oldHolder = adapterFor(server)
      await oldHolder.onSyncStart()
      const oldLease = await remoteHead(server, LOCK_REF)
      expect(oldLease).to.have.length(40)

      // Let the lease expire and a third client take it over
      await ageRemoteLease(server, Date.now() - LOCK_TIMEOUT - 60000)
      const third = adapterFor(server)
      await third.onSyncStart()
      const newLease = await remoteHead(server, LOCK_REF)
      expect(newLease).to.not.equal(oldLease)

      await oldHolder.onSyncFail()
      expect(await remoteHead(server, LOCK_REF)).to.equal(newLease)

      await third.onSyncComplete()
      expect(await remoteHead(server, LOCK_REF)).to.be.null
    })

    it('recognizes fresh legacy lock tags and ignores expired ones', async function() {
      const now = Date.now()
      const freshTag = 'floccus-lock-' + now
      await writeLegacyLockTag(server, now)
      const blocked = adapterFor(server)
      await expect(blocked.onSyncStart()).to.be.rejectedWith(ResourceLockedError)
      await blocked.onSyncFail()

      await server.git(['tag', '-d', freshTag])
      await writeLegacyLockTag(server, Date.now() - LOCK_TIMEOUT - 60000)

      const adapter = adapterFor(server)
      await adapter.onSyncStart()
      expect(await remoteHead(server, LOCK_REF)).to.have.length(40)
      await adapter.onSyncComplete()
      expect(await remoteHead(server, LOCK_REF)).to.be.null
    })
  })

  // The lease lives on refs/heads/floccus-lock. A data branch by that name
  // would be the lease itself, so the adapter has to stay away from it.
  it('syncs without a lease when the branch is named like the lock ref', async function() {
    const adapter = adapterFor(server, 'floccus-lock')
    await adapter.onSyncStart()
    await addBookmark(adapter, 'only')
    await adapter.onSyncComplete()

    // The data branch is the only ref, and it carries the bookmark file
    expect(await remoteHead(server, LOCK_REF)).to.have.length(40)
    expect(titles(XbelSerializer.deserializeFile(
      await server.git(['show', 'floccus-lock:bookmarks.xbel'])
    ).tree)).to.deep.equal(['only'])
  })

  describe('read failures', function() {
    it('treats a missing bookmark file as an empty server', async function() {
      const adapter = adapterFor(server)
      const status = await adapter.onSyncStart(false)
      expect(status).to.equal(false)
      expect(await localTitles(adapter)).to.deep.equal([])
    })

    it('keeps the cache when the bookmark file cannot be read for another reason', async function() {
      await seed(['seed'])
      const adapter = adapterFor(server)
      await adapter.onSyncStart(false)
      expect(await localTitles(adapter)).to.deep.equal(['seed'])

      adapter.fs.promises.readFile = async() => {
        const error = new Error('Input/output error')
        error.code = 'EIO'
        throw error
      }
      await expect(adapter.pullFromServer()).to.be.rejected

      expect(await localTitles(adapter)).to.deep.equal(['seed'])
    })

    // Account turns `false` from onSyncStart into init(), which wipes cache and
    // mappings. A read error that is not a missing file must never do that.
    it('keeps the stored cache and mappings when a sync hits a read error', async function() {
      const account = await Account.create({
        type: 'git',
        url: server.url,
        branch: BRANCH,
        username: 'floccus',
        password: 'floccus',
        bookmark_file: 'bookmarks.xbel',
        bookmark_file_type: 'xbel',
        ...(await createTestLocalRoot()),
      })
      try {
        await account.init()
        const localResource = await account.getResource()
        const localRoot = (await localResource.getBookmarksTree(true)).id
        await localResource.createBookmark(new Bookmark({ title: 'keep', url: 'http://keep.example/', parentId: localRoot, location: ItemLocation.LOCAL }))
        await localResource.createBookmark(new Bookmark({ title: 'gone', url: 'http://gone.example/', parentId: localRoot, location: ItemLocation.LOCAL }))
        await account.sync()
        expect(account.getData().error).to.not.be.ok

        const cacheTitles = async() => (await account.storage.getCache()).children.map(item => item.title).sort()
        const mappedBookmarks = async() => Object.keys((await account.storage.getMappings()).getSnapshot().LocalToServer.bookmark).length
        const cacheBefore = await cacheTitles()
        const mappingsBefore = await mappedBookmarks()

        // A local deletion the failed sync must not record as synced
        const localTree = await localResource.getBookmarksTree(true)
        await localResource.removeBookmark(localTree.children.find(item => item.title === 'gone'))

        const adapter = account.server
        const originalPull = adapter.pullFromServer.bind(adapter)
        adapter.pullFromServer = async function() {
          this.fs.promises.readFile = async() => {
            const error = new Error('Input/output error')
            error.code = 'EIO'
            throw error
          }
          return originalPull()
        }
        await account.sync()
        adapter.pullFromServer = originalPull

        expect(account.getData().error).to.contain('Input/output error')
        expect(await cacheTitles()).to.deep.equal(cacheBefore)
        expect(await mappedBookmarks()).to.equal(mappingsBefore)

        // The next sync carries the deletion through
        await account.sync()
        expect(account.getData().error).to.not.be.ok
        expect(await remoteTitles(server)).to.deep.equal(['keep'])
      } finally {
        await clearLocalResource(account)
        await account.delete()
      }
    })
  })
})
