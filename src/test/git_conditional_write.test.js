/* global globalThis */
import './node-shims/indexeddb.js'
import fs from 'fs'
import os from 'os'
import path from 'path'
import * as git from 'isomorphic-git'
import httpNode from 'isomorphic-git/http/node'
import GitAdapter, { setGitHttpClient } from '../lib/adapters/Git'
import XbelSerializer from '../lib/serializers/Xbel'
import { Bookmark, ItemLocation } from '../lib/Tree'
import { RemoteFileChangedError, ResourceLockedError } from '../errors/Error'
import { expect } from './utils'
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

function adapterFor(server) {
  return new GitAdapter({
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
})
