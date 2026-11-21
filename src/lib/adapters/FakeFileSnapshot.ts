import CachingAdapter from './Caching'
import { Folder, hydrate, TItemLocation } from '../Tree'

export const FAKE_FILE_SNAPSHOT_TYPE = 'fake-file-snapshot'

export interface IFileSnapshotWrite {
  writer: string | null
  tree: Folder<TItemLocation>
}

type TBeforeWrite = (write: IFileSnapshotWrite) => Promise<void> | void

const servers = new Map<string, FakeFileSnapshotServer>()
let nextServerId = 0

/**
 * The "file" a file-snapshot backend stores on its server.
 *
 * One instance is shared by every client that syncs against it. The tree is
 * kept as plain JSON, so the instance never carries a live Folder (and its
 * index) around, and two clients can each hold their own cache and mappings
 * without seeing each other's in-memory copies.
 *
 * `beforeWrite` is a deterministic pause point for tests: it is awaited before
 * the snapshot is replaced, so a test can let another client finish its sync
 * while this writer is still between reading and writing -- the lost update a
 * whole-file backend actually has.
 */
export class FakeFileSnapshotServer {
  readonly snapshotId: string
  revision = 0
  writes: (string | null)[] = []
  beforeWrite: TBeforeWrite | null = null
  private treeJSON: any = null

  constructor() {
    this.snapshotId = 'fake-file-snapshot-' + ++nextServerId
    servers.set(this.snapshotId, this)
  }

  static get(snapshotId: string): FakeFileSnapshotServer {
    const server = servers.get(snapshotId)
    if (!server) {
      throw new Error('Unknown fake file snapshot server: ' + snapshotId)
    }
    return server
  }

  /** The current file contents, or null if nothing has been written yet. */
  readTree(): Folder<TItemLocation> | null {
    return this.treeJSON
      ? hydrate<TItemLocation>(this.treeJSON) as Folder<TItemLocation>
      : null
  }

  async writeTree(tree: Folder<TItemLocation>, writer: string | null): Promise<void> {
    if (this.beforeWrite) {
      await this.beforeWrite({ writer, tree: tree.copy() })
    }
    this.treeJSON = tree.toJSON()
    this.revision++
    this.writes.push(writer)
  }

  dispose(): void {
    this.beforeWrite = null
    servers.delete(this.snapshotId)
  }
}

function highestIdIn(tree: Folder<TItemLocation>): number {
  let highest = Number(tree.id) || 0
  for (const child of tree.children) {
    const childId = Number(child.id)
    if (Number.isFinite(childId)) {
      highest = Math.max(highest, childId)
    }
    if (child instanceof Folder) {
      highest = Math.max(highest, highestIdIn(child))
    }
  }
  return highest
}

/**
 * A file-snapshot server for tests, shaped like Git/WebDAV/S3: the server side
 * is one whole tree, read once in onSyncStart and written back whole in
 * onSyncComplete.
 *
 * Deliberately not atomic: a mutation changes only this adapter's cache, and
 * an upload replaces the whole file. Two clients that read the same snapshot
 * and write in turn therefore overwrite each other's changes, which is what
 * the two-client harness needs to reproduce.
 *
 * The whole snapshot lives in {@link FakeFileSnapshotServer}, keyed by
 * `snapshotId` in the account data, so two adapters constructed from separate
 * account data objects still share one server instance.
 */
export default class FakeFileSnapshotAdapter extends CachingAdapter {
  private config: any
  private committed = false
  // The hash of the snapshot as it was read; see getBookmarksTree
  private initialTreeHash: string | null = null
  /**
   * Test hook: throw from the next onSyncCommit instead of writing, as a
   * failed push would. The server snapshot stays as it was.
   */
  public failNextCommit: Error | null = null

  constructor(server: any) {
    super(server)
    this.config = { ...server }
  }

  static getDefaultValues() {
    return {
      type: FAKE_FILE_SNAPSHOT_TYPE,
    }
  }

  private get snapshotServer(): FakeFileSnapshotServer {
    return FakeFileSnapshotServer.get(this.config.snapshotId)
  }

  setData(data: any): void {
    this.config = { ...this.config, ...data }
  }

  getData(): any {
    return { ...this.config }
  }

  getLabel(): string {
    return this.config.label || 'Fake file snapshot account (floccus)'
  }

  async getBookmarksTree(): Promise<Folder<TItemLocation>> {
    // setHashSettings is called after onSyncStart and before this, as for the
    // real file backends; take the hash the first commit compares against
    this.initialTreeHash = await this.bookmarksCache.hash(this.hashSettings)
    return super.getBookmarksTree()
  }

  isAtomic(): boolean {
    return false
  }

  async onSyncStart(): Promise<void> {
    this.resetCache()
    this.committed = false
    const tree = this.snapshotServer.readTree()
    if (tree) {
      this.bookmarksCache = tree
      this.highestId = highestIdIn(tree)
    }
  }

  /**
   * Write the whole snapshot, like Git/WebDAV/S3 do in their onSyncCommit.
   * A failure restores the id counter and the cached tree, so a retry starts
   * from the state the server still has.
   */
  async onSyncCommit(): Promise<string | null> {
    if (this.failNextCommit) {
      const error = this.failNextCommit
      this.failNextCommit = null
      throw error
    }
    const newTreeHash = await this.bookmarksCache.hash(this.hashSettings)
    if (newTreeHash === this.initialTreeHash) {
      // A whole-file backend has nothing to upload if this run changed nothing
      this.committed = true
      return String(this.snapshotServer.revision)
    }
    const highestIdBefore = this.highestId
    const treeBefore = this.bookmarksCache.clone(true)
    try {
      await this.snapshotServer.writeTree(
        this.bookmarksCache,
        this.config.clientLabel || null
      )
    } catch (e) {
      this.highestId = highestIdBefore
      this.bookmarksCache = treeBefore
      throw e
    }
    // A second commit of this run (the reorderings) compares against what it
    // just wrote
    this.initialTreeHash = newTreeHash
    this.committed = true
    return String(this.snapshotServer.revision)
  }

  async onSyncComplete(): Promise<void> {
    // A caller that used the adapter directly never committed; do it here so
    // that the old call pattern keeps working.
    if (!this.committed) {
      await this.onSyncCommit()
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  async onSyncFail(): Promise<void> {}
}
