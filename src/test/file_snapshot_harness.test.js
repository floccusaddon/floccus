/* global globalThis */
import './node-shims/indexeddb.js'
import fs from 'fs'
import path from 'path'
import * as git from 'isomorphic-git'
import httpNode from 'isomorphic-git/http/node'
import Controller from '../lib/Controller'
import GitAdapter, { setGitHttpClient } from '../lib/adapters/Git'
import { Bookmark, Folder, ItemLocation } from '../lib/Tree'
import { expect, expectTreeEqual } from './utils'
import { createFileSnapshotHarness } from './file-snapshot-harness'
import { createGitHttpServer } from './git-http-server'

// Node ships navigator.locks (and nodejs-shim leaves an existing navigator
// alone), which makes LightningFS pick its Web Locks mutex. That mutex arms a
// ten-minute timeout that is never cleared, so the test process would linger
// long after the suite finished. The IndexedDB mutex next door works with
// fake-indexeddb and leaves nothing behind.
Object.defineProperty(globalThis.navigator, 'locks', {
  value: undefined,
  configurable: true,
})

function titles(tree) {
  return tree.children.map((child) => child.title).sort()
}

function folder(title, children = []) {
  return new Folder({ title, children })
}

function bookmark(title, url) {
  return new Bookmark({ title, url })
}

describe('File snapshot harness', function() {
  this.timeout(120000)
  this.slow(20000)

  before(async function() {
    const controller = await Controller.getSingleton()
    controller.setEnabled(false)
  })
  after(async function() {
    const controller = await Controller.getSingleton()
    controller.setEnabled(true)
  })

  describe('fake file-snapshot adapter', function() {
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

    it('syncs a local tree into one whole-file snapshot', async function() {
      const client = harness.clients.A
      expect((await client.account.getServer()).isAtomic()).to.be.false

      const rootId = await client.rootId()
      const fooId = await client.createFolder('foo', rootId)
      const barId = await client.createFolder('bar', fooId)
      await client.createBookmark('url', 'http://ur.l/', barId)

      await harness.sync('A')

      const local = await client.localTree()
      const expected = folder(local.title, [
        folder('foo', [
          folder('bar', [bookmark('url', 'http://ur.l/')]),
        ]),
      ])
      expectTreeEqual(local, expected, false)

      const serverTree = harness.serverTree()
      expect(serverTree).to.be.ok
      expectTreeEqual(serverTree, expected, false)
      expect(harness.server.revision).to.equal(1)
      expect(harness.server.writes).to.deep.equal(['A'])
    })

    it('shares one server between two clients, each with its own cache', async function() {
      const { A, B } = harness.clients
      await A.createBookmark('seed', 'http://seed.example/', await A.rootId())
      await harness.sync('A')

      // B's first sync imports the server's tree into its own local tree
      await harness.sync('B')
      expect(titles(await B.localTree())).to.deep.equal(['seed'])

      await B.createBookmark('fromB', 'http://b.example/', await B.rootId())
      await harness.sync('B')
      await harness.sync('A')

      expect(titles(await A.localTree())).to.deep.equal(['fromB', 'seed'])
      expect(titles(await B.localTree())).to.deep.equal(['fromB', 'seed'])
      expectTreeEqual(await A.localTree(), harness.serverTree(), false)
      expectTreeEqual(await A.localTree(), await B.localTree(), false)
    })

    it('lets overlapping writers overwrite each other', async function() {
      const { A, B } = harness.clients
      await A.createBookmark('seed', 'http://seed.example/', await A.rootId())
      await harness.sync('A', 'B')

      // A reads the current file and is paused right before writing it back
      await A.createBookmark('fromA', 'http://a.example/', await A.rootId())
      const hold = harness.holdWrite('A')
      const pendingA = harness.sync('A')
      await Promise.race([
        hold.reached,
        pendingA.then(() => {
          throw new Error('client A finished without reaching its snapshot write')
        }),
      ])

      // B, which started from the same snapshot, writes its own whole file in
      // the meantime
      await B.createBookmark('fromB', 'http://b.example/', await B.rootId())
      await harness.sync('B')

      hold.release()
      await pendingA

      // A's upload replaced the file with the tree it read at the start, so
      // B's change is gone -- the lost update the harness exists to reproduce
      expect(titles(harness.serverTree())).to.deep.equal(['fromA', 'seed'])
      expect(harness.server.writes).to.deep.equal(['A', 'B', 'A'])

      // And B converges onto the overwritten file on its next sync
      await harness.sync('B')
      expect(titles(await B.localTree())).to.deep.equal(['fromA', 'seed'])
      expect(titles(harness.serverTree())).to.deep.equal(['fromA', 'seed'])
    })
  })

  describe('local git smart-HTTP server', function() {
    let server

    beforeEach(async function() {
      server = await createGitHttpServer()
    })
    afterEach(async function() {
      if (server) {
        await server.close()
        server = null
      }
    })

    it('supports push and fetch over smart HTTP', async function() {
      const work = path.join(server.root, 'work')
      await fs.promises.mkdir(work)
      await git.init({ fs, dir: work, defaultBranch: 'main' })
      await fs.promises.writeFile(path.join(work, 'a.txt'), 'hello')
      await git.add({ fs, dir: work, filepath: 'a.txt' })
      await git.commit({
        fs,
        dir: work,
        message: 'first',
        author: { name: 'Floccus test', email: 'test@floccus.example' },
      })
      await git.addRemote({ fs, dir: work, remote: 'origin', url: server.url })
      await git.push({ fs, http: httpNode, dir: work, remote: 'origin', ref: 'main' })

      const head = (await server.git(['rev-parse', '--verify', 'refs/heads/main'])).trim()
      expect(head).to.have.length(40)

      const clone = path.join(server.root, 'clone')
      await git.clone({
        fs,
        http: httpNode,
        dir: clone,
        url: server.url,
        ref: 'main',
        singleBranch: true,
      })
      expect(await fs.promises.readFile(path.join(clone, 'a.txt'), 'utf8')).to.equal('hello')
    })

    it('is usable by the Git adapter', async function() {
      const data = {
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
      setGitHttpClient(httpNode)
      try {
        const first = new GitAdapter(data)
        await first.onSyncStart()
        const root = await first.getBookmarksTree(true)
        await first.createBookmark(new Bookmark({
          title: 'url',
          url: 'http://ur.l/',
          parentId: root.id,
          location: ItemLocation.SERVER,
        }))
        await first.onSyncComplete()

        expect(await server.git(['log', '--oneline', 'main'])).to.contain('Floccus update')

        const second = new GitAdapter(data)
        await second.onSyncStart()
        const tree = await second.getBookmarksTree(true)
        expect(titles(tree)).to.deep.equal(['url'])
        await second.onSyncComplete()
      } finally {
        setGitHttpClient(null)
      }
    })
  })
})
