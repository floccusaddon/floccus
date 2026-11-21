import AdapterFactory from '../lib/AdapterFactory'
import Account from '../lib/Account'
import { Bookmark, Folder, ItemLocation } from '../lib/Tree'
import { createTestLocalRoot } from './utils'
import FakeFileSnapshotAdapter, {
  FAKE_FILE_SNAPSHOT_TYPE,
  FakeFileSnapshotServer,
} from '../lib/adapters/FakeFileSnapshot'

export { FAKE_FILE_SNAPSHOT_TYPE, FakeFileSnapshotServer }

let registered = false
function registerFakeFileSnapshotAdapter() {
  if (registered) {
    return
  }
  AdapterFactory.register(FAKE_FILE_SNAPSHOT_TYPE, async() => FakeFileSnapshotAdapter)
  registered = true
}

function deferred() {
  let resolve
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

/**
 * One of the two clients in a {@link FileSnapshotHarness}.
 *
 * The client owns its account and therefore its own local tree, cache and
 * mappings; only the server snapshot is shared. The helpers below are thin
 * wrappers around the local tree so a test reads as "A creates this, B
 * removes that".
 */
export class FileSnapshotClient {
  constructor(label, account) {
    this.label = label
    this.account = account
    this.rootIdPromise = null
  }

  async getResource() {
    return this.account.getResource()
  }

  async localTree() {
    return (await this.getResource()).getBookmarksTree(true)
  }

  async rootId() {
    if (!this.rootIdPromise) {
      this.rootIdPromise = (async() => (await this.localTree()).id)()
    }
    return this.rootIdPromise
  }

  async createFolder(title, parentId) {
    return (await this.getResource()).createFolder(new Folder({
      title,
      parentId: parentId ?? (await this.rootId()),
      location: ItemLocation.LOCAL,
    }))
  }

  async createBookmark(title, url, parentId) {
    return (await this.getResource()).createBookmark(new Bookmark({
      title,
      url,
      parentId: parentId ?? (await this.rootId()),
      location: ItemLocation.LOCAL,
    }))
  }

  async removeBookmark(id) {
    const tree = await this.localTree()
    const bookmark = tree.findBookmark(id)
    if (!bookmark) {
      throw new Error(`Client ${this.label} has no bookmark ${id}`)
    }
    await (await this.getResource()).removeBookmark(bookmark)
  }

  async removeFolder(id) {
    const tree = await this.localTree()
    const folder = tree.findFolder(id)
    if (!folder) {
      throw new Error(`Client ${this.label} has no folder ${id}`)
    }
    await (await this.getResource()).removeFolder(folder)
  }
}

/**
 * A deterministic two-client setup for file-snapshot backends.
 *
 * Both clients are real accounts syncing through a shared
 * {@link FakeFileSnapshotServer}. A test chooses the order of syncs, and
 * {@link holdWrite} pauses one client between reading the snapshot and
 * replacing it, so an overlapping pair of syncs happens in an explicit order
 * rather than on a timer.
 */
export class FileSnapshotHarness {
  constructor(server, clients) {
    this.server = server
    this.clients = clients
    this.disposed = false
  }

  /** The shared server snapshot, or null before the first upload. */
  serverTree() {
    return this.server.readTree()
  }

  async sync(...labels) {
    for (const label of labels) {
      await this.syncClient(label)
    }
  }

  async syncClient(label) {
    const client = this.clients[label]
    if (!client) {
      throw new Error('Unknown client: ' + label)
    }
    await client.account.sync()
    const error = client.account.getData().error
    if (error) {
      throw new Error(`Client ${label} failed to sync: ${error}`)
    }
  }

  /**
   * Pause `label` right before it replaces the server snapshot.
   *
   * Returns `reached` (resolved once that client is at the write) and
   * `release()` to let it continue. Nothing else is held up, so the test can
   * run the other client to completion in between.
   */
  holdWrite(label) {
    const gate = deferred()
    const reached = deferred()
    const previous = this.server.beforeWrite
    this.server.beforeWrite = async(write) => {
      if (write.writer !== label) {
        if (previous) {
          await previous(write)
        }
        return
      }
      reached.resolve()
      await gate.promise
    }
    return {
      reached: reached.promise,
      release: () => gate.resolve(),
    }
  }

  async dispose() {
    if (this.disposed) {
      return
    }
    this.disposed = true
    this.server.beforeWrite = null
    for (const client of Object.values(this.clients)) {
      try {
        await client.account.delete()
      } catch (e) {
        console.error(e)
      }
    }
    this.server.dispose()
  }
}

export async function createFileSnapshotHarness(options = {}) {
  registerFakeFileSnapshotAdapter()
  const server = new FakeFileSnapshotServer()
  const labels = options.labels || ['A', 'B']
  const clients = {}

  for (const label of labels) {
    const account = await Account.create({
      ...(await createTestLocalRoot()),
      type: FAKE_FILE_SNAPSHOT_TYPE,
      snapshotId: server.snapshotId,
      clientLabel: label,
      ...(options.accountData || {}),
    })
    await account.init()
    clients[label] = new FileSnapshotClient(label, account)
  }

  return new FileSnapshotHarness(server, clients)
}
