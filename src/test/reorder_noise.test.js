/* global globalThis */
import './node-shims/indexeddb.js'
import httpNode from 'isomorphic-git/http/node'
import Account from '../lib/Account'
import Controller from '../lib/Controller'
import GitAdapter, { setGitHttpClient } from '../lib/adapters/Git'
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

const FOLDER = 'ordered'
const SEEDED = ['one', 'two', 'three']

function folderByTitle(tree, title) {
  const folder = tree.children.find((child) => child.title === title)
  if (!folder) {
    throw new Error(`No folder ${title}`)
  }
  return folder
}

function titlesOf(folder) {
  return folder.children.map((child) => child.title)
}

async function localFolder(client, title = FOLDER) {
  return folderByTitle(await client.localTree(), title)
}

async function localFolderTitles(client, title = FOLDER) {
  return titlesOf(await localFolder(client, title))
}

function serverFolderTitles(harness) {
  return titlesOf(folderByTitle(harness.serverTree(), FOLDER))
}

/**
 * Every bookmark and folder below the root as "path/title", sorted, so two
 * trees can be compared item by item without depending on ids or locations.
 */
function flatten(tree) {
  const items = []
  const walk = (folder, path) => {
    for (const child of folder.children) {
      if (child.children) {
        walk(child, path + '/' + child.title)
      } else {
        items.push(path + '/' + child.title)
      }
    }
  }
  walk(tree, '')
  return items.sort()
}

async function reorder(client, order, title = FOLDER) {
  const resource = await client.getResource()
  const folder = folderByTitle(await resource.getBookmarksTree(true), title)
  const childrenByTitle = {}
  for (const child of folder.children) {
    childrenByTitle[child.title] = child
  }
  await resource.orderFolder(
    folder.id,
    order.map((childTitle) => ({
      type: childrenByTitle[childTitle].type,
      id: childrenByTitle[childTitle].id,
    }))
  )
}

/** A folder of ordered bookmarks both clients have synced. */
async function seedFolder(harness) {
  const { A } = harness.clients
  const folderId = await A.createFolder(FOLDER, await A.rootId())
  for (const title of SEEDED) {
    await A.createBookmark(title, `http://${title}.example/`, folderId)
  }
  await harness.sync('A', 'B')
  expect(harness.server.writes).to.deep.equal(['A'])
  return folderId
}

/** Count the reorderings a server adapter is asked to make. */
function spyOrderFolder(server) {
  const calls = []
  const orderFolder = server.orderFolder.bind(server)
  server.orderFolder = async(id, order) => {
    calls.push({ id, order })
    return orderFolder(id, order)
  }
  return calls
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

async function seedGitServer(server, titles) {
  const adapter = new GitAdapter(gitData(server))
  await adapter.onSyncStart(false)
  const root = await adapter.getBookmarksTree(true)
  for (const title of titles) {
    await adapter.createBookmark(new Bookmark({
      title,
      url: `http://${title}.example/`,
      parentId: root.id,
      location: ItemLocation.SERVER,
    }))
  }
  await adapter.onSyncComplete()
}

async function gitCommits(server) {
  return Number((await server.git(['rev-list', '--count', 'main'])).trim())
}

async function gitTitles(server) {
  const contents = await server.git(['show', 'main:bookmarks.xbel'])
  const order = []
  const pattern = /<bookmark href="[^"]*" id="[^"]*">\s*<title>([^<]*)<\/title>/g
  let match
  while ((match = pattern.exec(contents))) {
    order.push(match[1])
  }
  return order
}

describe('Reorder noise reduction', function() {
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

    it('does not write the snapshot again while the order stays the same', async function() {
      const { A, B } = harness.clients
      await seedFolder(harness)

      const server = await A.account.getServer()
      const orderFolderCalls = spyOrderFolder(server)

      // Nothing changed on either side: the syncs have nothing to write, and no
      // reorder action to hand to the server.
      await harness.sync('A', 'B', 'A', 'B')
      expect(harness.server.writes).to.deep.equal(['A'])
      expect(orderFolderCalls).to.have.length(0)
      expect(await localFolderTitles(A)).to.deep.equal(SEEDED)
      expect(await localFolderTitles(B)).to.deep.equal(SEEDED)
    })

    it('reports a reordering that already holds as unchanged', async function() {
      const { A } = harness.clients
      await seedFolder(harness)
      const server = await A.account.getServer()
      const folder = folderByTitle(await server.getBookmarksTree(), FOLDER)
      const order = folder.children.map((child) => ({ type: child.type, id: child.id }))
      const mutations = server.getMutationCount()

      // Nothing to do, so this must not count as a mutation (a second commit
      // and a file write would follow from one)
      expect(await server.orderFolder(folder.id, order)).to.be.false
      expect(server.getMutationCount()).to.equal(mutations)

      // An order that only names some of the children leaves the others where
      // they are
      expect(await server.orderFolder(folder.id, [order[2], order[0]])).to.be.true
      expect(server.getMutationCount()).to.equal(mutations + 1)
      expect(titlesOf(folderByTitle(await server.getBookmarksTree(), FOLDER)))
        .to.deep.equal(['three', 'two', 'one'])
    })

    it('propagates a reorder to the other client and then goes quiet', async function() {
      const { A, B } = harness.clients
      await seedFolder(harness)

      // Three, two, one -- a genuine user reorder
      await reorder(B, ['three', 'two', 'one'])
      await harness.sync('B')
      expect(harness.server.writes).to.deep.equal(['A', 'B'])
      expect(serverFolderTitles(harness)).to.deep.equal(['three', 'two', 'one'])

      // A picks the order up without writing it back; from then on neither
      // client has anything to say about the order any more.
      await harness.sync('A')
      expect(harness.server.writes).to.deep.equal(['A', 'B'])
      expect(await localFolderTitles(A)).to.deep.equal(['three', 'two', 'one'])
      expect(await localFolderTitles(B)).to.deep.equal(['three', 'two', 'one'])

      await harness.sync('A', 'B', 'A', 'B')
      expect(harness.server.writes).to.deep.equal(['A', 'B'])
    })

    it('keeps a bookmark the user appended at the end without reordering', async function() {
      const { A } = harness.clients
      const folderId = await seedFolder(harness)
      const server = await A.account.getServer()
      const orderFolderCalls = spyOrderFolder(server)

      // Creating a bookmark appends it; that is already where the user wants it
      await A.createBookmark('four', 'http://four.example/', folderId)
      await harness.sync('A')
      expect(orderFolderCalls).to.have.length(0)
      expect(harness.server.writes).to.deep.equal(['A', 'A'])
      expect(serverFolderTitles(harness)).to.deep.equal(['one', 'two', 'three', 'four'])
      expect(await localFolderTitles(A)).to.deep.equal(['one', 'two', 'three', 'four'])
    })

    it('does not reorder a folder that only lost a bookmark', async function() {
      const { B } = harness.clients
      await seedFolder(harness)
      const server = await B.account.getServer()
      const orderFolderCalls = spyOrderFolder(server)

      const folder = await localFolder(B)
      await B.removeBookmark(folder.children.find((child) => child.title === 'two').id)
      await harness.sync('B')
      expect(orderFolderCalls).to.have.length(0)
      expect(harness.server.writes).to.deep.equal(['A', 'B'])
      expect(serverFolderTitles(harness)).to.deep.equal(['one', 'three'])
      expect(await localFolderTitles(B)).to.deep.equal(['one', 'three'])
    })

    it('keeps the order when the same sync changes the content', async function() {
      const { A, B } = harness.clients
      const folderId = await seedFolder(harness)

      // B both reorders and adds a bookmark, which has to go in where B put it
      await reorder(B, ['three', 'two', 'one'])
      await B.createBookmark('four', 'http://four.example/', folderId)
      await reorder(B, ['four', 'three', 'two', 'one'])
      await harness.sync('B')

      // The content commit and, because the order really changed, the reorder
      // commit: the user's order must not be dropped because the content
      // changed in the same run.
      expect(harness.server.writes).to.deep.equal(['A', 'B', 'B'])
      expect(serverFolderTitles(harness)).to.deep.equal(['four', 'three', 'two', 'one'])

      await harness.sync('A')
      expect(harness.server.writes).to.deep.equal(['A', 'B', 'B'])
      expect(await localFolderTitles(A)).to.deep.equal(['four', 'three', 'two', 'one'])
      expect(await localFolderTitles(B)).to.deep.equal(['four', 'three', 'two', 'one'])

      // ... and once both have it, nothing more is written
      await harness.sync('A', 'B', 'A', 'B')
      expect(harness.server.writes).to.deep.equal(['A', 'B', 'B'])
    })

    it('converges two concurrent reorders without losing items', async function() {
      const { A, B } = harness.clients
      await seedFolder(harness)

      // Each client reorders differently before either syncs
      await reorder(A, ['two', 'three', 'one'])
      await reorder(B, ['three', 'one', 'two'])
      await harness.sync('A')
      await harness.sync('B')

      // Whichever side won, both clients and the server agree on it and nothing
      // was lost on the way.
      for (let round = 0; round < 3; round++) {
        await harness.sync('A', 'B')
      }
      const serverOrder = serverFolderTitles(harness)
      expect(serverOrder.slice().sort()).to.deep.equal([...SEEDED].sort())
      expect(await localFolderTitles(A)).to.deep.equal(serverOrder)
      expect(await localFolderTitles(B)).to.deep.equal(serverOrder)
      expect(flatten(await A.localTree())).to.deep.equal(flatten(harness.serverTree()))

      const writes = harness.server.writes.length
      await harness.sync('A', 'B', 'A', 'B')
      expect(harness.server.writes).to.have.length(writes)
    })

    it('reorders a single bookmark created in the middle of the folder', async function() {
      const { A, B } = harness.clients
      const folderId = await seedFolder(harness)
      const server = await A.account.getServer()
      const orderFolderCalls = spyOrderFolder(server)

      // A single creation, but not at the end: an appending target would put
      // it after `three`, so the order has to be stated.
      await A.createBookmark('four', 'http://four.example/', folderId)
      await reorder(A, ['one', 'four', 'two', 'three'])
      await harness.sync('A')

      expect(orderFolderCalls).to.have.length.greaterThan(0)
      expect(serverFolderTitles(harness)).to.deep.equal(['one', 'four', 'two', 'three'])
      expect(await localFolderTitles(A)).to.deep.equal(['one', 'four', 'two', 'three'])

      await harness.sync('B')
      expect(await localFolderTitles(B)).to.deep.equal(['one', 'four', 'two', 'three'])
    })

    it('keeps the order of two bookmarks created in the same sync', async function() {
      const { A, B } = harness.clients
      const folderId = await seedFolder(harness)
      const server = await A.account.getServer()
      const orderFolderCalls = spyOrderFolder(server)

      // Created concurrently, in no particular order: only a REORDER puts them
      // in the user's order.
      await A.createBookmark('four', 'http://four.example/', folderId)
      await A.createBookmark('five', 'http://five.example/', folderId)
      await harness.sync('A')

      expect(orderFolderCalls).to.have.length.greaterThan(0)
      expect(serverFolderTitles(harness)).to.deep.equal(['one', 'two', 'three', 'four', 'five'])
      expect(await localFolderTitles(A)).to.deep.equal(['one', 'two', 'three', 'four', 'five'])

      await harness.sync('B')
      expect(await localFolderTitles(B)).to.deep.equal(['one', 'two', 'three', 'four', 'five'])
    })
  })

  describe('prepending fake file-snapshot backend', function() {
    it('keeps a bookmark the user appended at the end across two syncs', async function() {
      const harness = await createFileSnapshotHarness({ accountData: { prependOnCreate: true } })
      try {
        const { A, B } = harness.clients
        const folderId = await seedFolder(harness)
        const server = await A.account.getServer()
        const orderFolderCalls = spyOrderFolder(server)

        // This backend puts the new bookmark on top. The sync has to state the
        // user's order instead of leaving it to the next sync, which would copy
        // the backend's order back to the clients and undo the append.
        await A.createBookmark('four', 'http://four.example/', folderId)
        await harness.sync('A')

        expect(orderFolderCalls).to.have.length.greaterThan(0)
        expect(serverFolderTitles(harness)).to.deep.equal(['one', 'two', 'three', 'four'])
        expect(await localFolderTitles(A)).to.deep.equal(['one', 'two', 'three', 'four'])

        await harness.sync('B')
        expect(serverFolderTitles(harness)).to.deep.equal(['one', 'two', 'three', 'four'])
        expect(await localFolderTitles(B)).to.deep.equal(['one', 'two', 'three', 'four'])

        // ... and a later round does not undo it again
        await harness.sync('A', 'B', 'A')
        expect(serverFolderTitles(harness)).to.deep.equal(['one', 'two', 'three', 'four'])
        expect(await localFolderTitles(A)).to.deep.equal(['one', 'two', 'three', 'four'])
        expect(await localFolderTitles(B)).to.deep.equal(['one', 'two', 'three', 'four'])
      } finally {
        await harness.dispose()
      }
    })
  })

  describe('git smart-HTTP backend', function() {
    it('propagates the order and adds no commits once the clients agree', async function() {
      setGitHttpClient(httpNode)
      const server = await createGitHttpServer()
      const accounts = []
      try {
        await seedGitServer(server, SEEDED)
        for (let i = 0; i < 2; i++) {
          const account = await Account.create({ ...gitData(server), ...(await createTestLocalRoot()) })
          await account.init()
          await account.sync()
          expect(account.getData().error).to.not.be.ok
          accounts.push(account)
        }
        const [A, B] = accounts

        const commits = await gitCommits(server)
        await A.sync()
        await B.sync()
        expect(await gitCommits(server)).to.equal(commits)

        // B puts the three in a different order; A picks it up, and the history
        // gets exactly one commit for it.
        const resource = await B.getResource()
        const root = await resource.getBookmarksTree(true)
        await resource.orderFolder(
          root.id,
          root.children.slice().reverse().map((item) => ({ type: item.type, id: item.id }))
        )
        await B.sync()
        expect(B.getData().error).to.not.be.ok
        expect(await gitCommits(server)).to.equal(commits + 1)

        await A.sync()
        expect(A.getData().error).to.not.be.ok
        expect(await gitTitles(server)).to.deep.equal(['three', 'two', 'one'])

        // Both agree now, so further syncs have nothing to write
        await A.sync()
        await B.sync()
        await A.sync()
        expect(await gitCommits(server)).to.equal(commits + 1)
      } finally {
        for (const account of accounts) {
          await clearLocalResource(account)
          await account.delete()
        }
        await server.close()
        setGitHttpClient(null)
      }
    })
  })
})
