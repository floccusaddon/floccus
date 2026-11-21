import * as git from 'isomorphic-git'
import webHttp from 'isomorphic-git/http/web'
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import FS from '@isomorphic-git/lightning-fs'
import * as Parallel from 'async-parallel'
import CachingAdapter from './Caching'
import XbelSerializer from '../serializers/Xbel'
import Logger from '../Logger'
import Html from '../serializers/Html'
import { IDeserializedFile } from '../interfaces/Serializer'
import {
  FileUnreadableError, GitPushError,
  MissingPermissionsError,
  RemoteFileChangedError,
  ResourceLockedError,
  SlashError
} from '../../errors/Error'
import Crypto from '../Crypto'
import { Folder, TItemLocation } from '../Tree'
import CapacitorGitHttp from '../native/CapacitorGitHttp'
import type { HttpClient } from 'isomorphic-git'

declare const IS_BROWSER: boolean

// In the app, fetch can't reach git servers and can't carry packfiles
let http: HttpClient = IS_BROWSER ? webHttp : CapacitorGitHttp

/**
 * Test seam: the node test suite has neither the browser's fetch nor the
 * Capacitor plugin, so it points the adapter at isomorphic-git's node client
 * (which can talk to the local `git http-backend` harness). Passing null puts
 * the platform client back.
 */
export function setGitHttpClient(client: HttpClient | null): void {
  http = client || (IS_BROWSER ? webHttp : CapacitorGitHttp)
}

const LOCK_INTERVAL = 2 * 60 * 1000 // Refresh the lease every 2mins while syncing
const LOCK_TIMEOUT = 15 * 60 * 1000 // Take over a lease 0.25h after its last refresh
// One fixed ref for the lease. A branch rather than a tag: a tag that is
// updated is rejected by some servers and silently overwritten by others,
// while a non-fast-forward branch update is rejected by both sides.
const LOCK_REF = 'refs/heads/floccus-lock'
const LOCK_BRANCH = 'floccus-lock'
const LEGACY_LOCK_PREFIX = 'floccus-lock-'
// The name of a lightning-fs file system of ours: the sha256 of the account
// config, followed by the millisecond the sync that created it started
const FS_DB_NAME = /^[0-9a-f]{64}(\d{13})$/
export default class GitAdapter extends CachingAdapter {
  private lockingInterval: any
  private lockingPromise: Promise<void>
  private cancelCallback: () => void
  private initialTreeHash: string
  // Write the file even if the tree hash didn't change, see mustPersistDerivedIds
  private alwaysUpload = false
  // Whether this run already wrote and pushed its server plan (see onSyncCommit)
  private committed = false
  private dir: string
  private hash: string
  private fs: FS|null
  // The tip of the synced branch as it was fetched. Every write has to land on
  // top of exactly this revision; a remote that moved on since is a conflict.
  private expectedRevision: string|null = null
  // The lease this adapter holds, if any. `lockOid` is the commit the lease ref
  // pointed at when we last wrote it; we only ever delete that ref while it
  // still points there.
  private lockOwner: string
  private lockOid: string|null = null

  constructor(server) {
    super(server)
    this.server = server
    this.lockingInterval = null
    this.lockOwner = `floccus-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  }

  static getDefaultValues() {
    return {
      type: 'git',
      url: 'https://example.org/repo.git',
      username: 'bob',
      password: 's3cret',
      branch: 'main',
      bookmark_file: 'bookmarks.xbel',
      bookmark_file_type: 'xbel',
      includeCredentials: false,
      allowRedirects: false,
      allowNetwork: false,
    }
  }

  getLabel():string {
    const data = this.getData()
    const url = new URL(data.url)
    url.protocol = ''
    return data.label || data.username + '@' + url.hostname + ':' + data.bookmark_file
  }

  getData() {
    return { ...GitAdapter.getDefaultValues(), ...this.server }
  }

  cancel() {
    this.cancelCallback && this.cancelCallback()
  }

  async getBookmarksTree(): Promise<Folder<TItemLocation>> {
    // setHashSettings is called after onSyncStart only but before getBookmarksTree
    // thus we get the hash here again
    this.initialTreeHash = await this.bookmarksCache.hash(this.hashSettings)
    return super.getBookmarksTree()
  }

  async onSyncStart(needLock = true, forceLock = false) {
    Logger.log('onSyncStart: begin')

    this.committed = false

    this.hash = await Crypto.sha256(JSON.stringify(this.server)) + Date.now()
    this.dir = '/' + this.hash + '/'

    if (IS_BROWSER) {
      const browser = (await import('../browser-api')).default
      let hasPermissions, error = false
      try {
        hasPermissions = await browser.permissions.contains({ origins: [this.server.url + '/'] })
      } catch (e) {
        error = true
        console.warn(e)
      }
      const {isOrion} = await browser.storage.local.get({'isOrion': false})
      if (!error && !hasPermissions && !isOrion) {
        throw new MissingPermissionsError()
      }
    }

    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    this.fs = new FS(this.hash, {wipe: true})

    Logger.log('(git) init')
    await git.init({ fs: this.fs, dir: this.dir })
    await git.addRemote({
      fs: this.fs,
      dir: this.dir,
      url: this.server.url,
      remote: 'origin',
      force: true
    })

    try {
      Logger.log('(git) fetch from remote')
      await git.fetch({
        http,
        fs: this.fs,
        dir: this.dir,
        ref: this.server.branch,
        remoteRef: this.server.branch,
        singleBranch: true,
        remote: 'origin',
        depth: 10,
        onAuth: () => this.onAuth()
      })
      Logger.log('(git) checkout branch ' + (this.server.branch))
      await git.checkout({ fs: this.fs, dir: this.dir, ref: this.server.branch })
      this.expectedRevision = await this.localBranchHead()
    } catch (e) {
      if (e && e.code === git.Errors.NotFoundError.code && (e.data.what === 'HEAD' || e.data.what === this.server.branch || e.data.what === 'origin/' + this.server.branch)) {
        Logger.log('(git) writeFile ' + this.dir + '/README.md')
        await this.fs.promises.writeFile(this.dir + '/README.md', 'This repository is used to synchronize bookmarks via [floccus](https://floccus.org).', {mode: 0o777, encoding: 'utf8'})
        Logger.log('(git) add .')
        await git.add({fs: this.fs, dir: this.dir, filepath: '.'})
        Logger.log('(git) commit')
        const initialCommit = await git.commit({
          fs: this.fs,
          dir: this.dir,
          message: 'Floccus bookmarks update',
          author: {
            name: 'Floccus bookmarks sync',
          }
        })
        const currentBranch = await git.currentBranch({fs: this.fs, dir: this.dir})
        if (currentBranch && currentBranch !== this.server.branch) {
          await git.renameBranch({ fs: this.fs, dir: this.dir, ref: this.server.branch, oldref: currentBranch })
        }
        // The branch we tried to fetch did not exist. If another client
        // created it in the meantime, the conditional push below refuses to
        // replace it with ours.
        this.expectedRevision = null
        Logger.log('(git) push')
        await this.pushBranch(initialCommit)
      } else {
        throw e
      }
    }

    if (this.server.bookmark_file[0] === '/') {
      throw new SlashError()
    }

    if (this.lockingInterval) {
      clearInterval(this.lockingInterval)
      this.lockingInterval = null
    }
    this.lockOid = null
    if (forceLock) {
      // A forced sync gave up waiting for the lease. It must not clear the
      // lease of another client: correctness comes from the conditional
      // write, not from the lease, and another client's fresh lease is still
      // theirs. So just go ahead without one.
      Logger.log('(git) forcing sync without taking the lease')
    } else if (needLock) {
      await this.obtainLock()
    }
    if (this.lockOid) {
      this.lockingInterval = setInterval(() => {
        this.setLock().catch((e) => Logger.log('(git) lease refresh failed', e))
      }, LOCK_INTERVAL)
    }

    const status = await this.pullFromServer()

    this.initialTreeHash = await this.bookmarksCache.hash(this.hashSettings)

    Logger.log('onSyncStart: completed')

    return status
  }

  async onSyncFail() {
    Logger.log('onSyncFail')
    clearInterval(this.lockingInterval)
    await this.freeLock()
    await this.cleanupIndexedDB()
  }

  /**
   * Write and push the server side of the sync, before the local plan runs.
   *
   * A failed write or push restores the id counter, the upload flag and the
   * initial tree hash the adapter read in onSyncStart, so the next attempt
   * compares against the state the server still has rather than against a
   * commit that never landed.
   */
  async onSyncCommit(): Promise<string | null> {
    Logger.log('onSyncCommit')
    const highestIdBefore = this.highestId
    const alwaysUploadBefore = this.alwaysUpload
    const initialTreeHashBefore = this.initialTreeHash
    const treeBefore = this.bookmarksCache.clone(true)

    try {
      this.bookmarksCache = this.bookmarksCache.clone(false)
      const newTreeHash = await this.bookmarksCache.hash(this.hashSettings)
      if (newTreeHash !== this.initialTreeHash || this.alwaysUpload) {
        this.alwaysUpload = false
        const fileContents = this.server.bookmark_file_type === 'xbel' ? createXBEL(this.bookmarksCache, this.highestId) : createHTML(this.bookmarksCache, this.highestId)
        Logger.log('(git) writeFile ' + this.dir + '/' + this.server.bookmark_file)
        await this.fs.promises.writeFile(this.dir + '/' + this.server.bookmark_file, fileContents, {mode: 0o777, encoding: 'utf8'})
        Logger.log('(git) add .')
        await git.add({fs: this.fs, dir: this.dir, filepath: '.'})
        if (!this.expectedRevision) {
          throw new RemoteFileChangedError()
        }
        Logger.log('(git) commit')
        const commitOid = await git.commit({
          fs: this.fs,
          dir: this.dir,
          message: `Floccus update: ${this.getLabel()}`,
          author: {
            name: 'Floccus bookmarks sync',
          },
          parent: [this.expectedRevision],
          ref: 'refs/heads/' + this.server.branch,
        })
        await this.pushBranch(commitOid)
      } else {
        Logger.log('No changes to the server version necessary')
      }
      // Whatever a second commit of this run (the reorderings) hashes against
      this.initialTreeHash = newTreeHash
      this.committed = true
      return this.expectedRevision
    } catch (e) {
      this.highestId = highestIdBefore
      this.alwaysUpload = alwaysUploadBefore
      this.initialTreeHash = initialTreeHashBefore
      this.bookmarksCache = treeBefore
      throw e
    }
  }

  async onSyncComplete() {
    Logger.log('onSyncComplete')
    clearInterval(this.lockingInterval)
    try {
      if (!this.committed) {
        // Direct adapter use that never called onSyncCommit
        await this.onSyncCommit()
      }
    } finally {
      await this.freeLock()
      await this.cleanupIndexedDB()
    }
  }

  /**
   * Push the synced branch iff it is still based on the revision this adapter
   * read in onSyncStart.
   *
   * A pre-push check of the advertised remote head catches most races early;
   * the non-force push is the actual compare-and-swap, because the server
   * rejects the update if the ref moved between the check and the push. The
   * post-push check confirms the remote accepted exactly our commit. Any
   * mismatch is a conflict, never a reason to force: the other side's commit
   * stays and this sync is retried against the new tip.
   */
  private async pushBranch(commitOid: string): Promise<void> {
    await this.assertRemoteHead(this.expectedRevision)
    Logger.log('(git) push')
    try {
      const result = await git.push({
        fs: this.fs,
        http,
        dir: this.dir,
        ref: this.server.branch,
        remoteRef: this.server.branch,
        remote: 'origin',
        onAuth: () => this.onAuth()
      })
      if (result.error) {
        throw new GitPushError(result.error)
      }
    } catch (e) {
      if (this.isPushConflict(e)) {
        Logger.log('(git) push rejected: the remote branch moved on')
        throw new RemoteFileChangedError()
      }
      if (e instanceof GitPushError || e instanceof RemoteFileChangedError) {
        throw e
      }
      throw new GitPushError(e && e.message ? e.message : String(e))
    }
    await this.confirmPushedHead(commitOid)
    this.expectedRevision = commitOid
  }

  /**
   * Confirm the remote actually carries our commit.
   *
   * It need not be the tip: a concurrent client may have pushed on top of it
   * between our push and this read, which is not a conflict -- their commit
   * descends from ours, so both changes are on the remote. Only when our
   * commit is not in the remote history did the write not land.
   */
  private async confirmPushedHead(commitOid: string): Promise<void> {
    const remoteHead = await this.readRemoteHeadRetrying()
    if (remoteHead === commitOid) {
      return
    }
    let remoteCarriesOurCommit = false
    if (remoteHead) {
      try {
        // isDescendent walks the commit graph locally, so the remote head has
        // to be downloaded first
        await git.fetch({
          http,
          fs: this.fs,
          dir: this.dir,
          ref: this.server.branch,
          remoteRef: this.server.branch,
          singleBranch: true,
          depth: 10,
          remote: 'origin',
          onAuth: () => this.onAuth(),
        })
        remoteCarriesOurCommit = await git.isDescendent({
          fs: this.fs,
          dir: this.dir,
          oid: remoteHead,
          ancestor: commitOid,
        })
      } catch (e) {
        Logger.log('(git) could not check whether the remote carries our commit', e)
      }
    }
    if (!remoteCarriesOurCommit) {
      Logger.log('(git) the remote does not carry the pushed commit')
      throw new RemoteFileChangedError()
    }
    Logger.log('(git) the remote branch moved on top of our commit, not a conflict')
  }

  /** The oid the remote branch points at, read once more if the read fails. */
  private async readRemoteHeadRetrying(): Promise<string|null> {
    try {
      return await this.readRemoteRef('refs/heads/' + this.server.branch)
    } catch (e) {
      Logger.log('(git) reading the remote head failed, retrying', e)
      return this.readRemoteRef('refs/heads/' + this.server.branch)
    }
  }

  private isPushConflict(e): boolean {
    if (!e || !e.code) {
      return false
    }
    if (e.code === git.Errors.PushRejectedError.code) {
      return true
    }
    if (e.code === git.Errors.GitPushError.code) {
      const details = String(e.data && e.data.prettyDetails ? e.data.prettyDetails : e.message || '')
      return /non-fast-forward|failed to update ref|fetch first|stale info|incorrect old value|reference already exists|cannot lock ref/i.test(details)
    }
    return false
  }

  private async localBranchHead(): Promise<string|null> {
    try {
      return await git.resolveRef({
        fs: this.fs,
        dir: this.dir,
        ref: 'refs/heads/' + this.server.branch,
      })
    } catch (e) {
      if (e && e.code === git.Errors.NotFoundError.code) {
        return null
      }
      throw e
    }
  }

  /** The oid the remote ref points at, or null if it does not exist. */
  private async readRemoteRef(ref: string): Promise<string|null> {
    const refs = await git.listServerRefs({
      http,
      url: this.server.url,
      prefix: ref,
      forPush: true,
      // receive-pack only speaks protocol v0; asking for v2 makes git
      // http-backend omit the service announcement the parser expects.
      protocolVersion: 1,
      onAuth: () => this.onAuth(),
    })
    const found = refs.find((remoteRef) => remoteRef.ref === ref)
    return found ? found.oid : null
  }

  private async assertRemoteHead(expected: string|null): Promise<void> {
    const actual = await this.readRemoteRef('refs/heads/' + this.server.branch)
    if (actual !== expected) {
      throw new RemoteFileChangedError()
    }
  }

  async cleanupIndexedDB() {
    try {
      // Give the FS instance time to close connections
      await new Promise(resolve => setTimeout(resolve, 100))

      // Only our own file systems: the other databases of this origin belong
      // to floccus itself -- the continuation store, say -- or to a sync of
      // another account that is still running, and deleting one of those takes
      // it down with it. A delete that an open connection blocks also stays
      // pending for good, and while one is pending indexedDB.databases() never
      // resolves again, so the next sync hangs before it has begun.
      Logger.log('Cleaning up Lightning FS IndexedDB databases')
      const databases = (await indexedDB.databases())
        .filter(dbInfo => dbInfo.name && this.isDisposableFsDatabase(dbInfo.name))

      await Parallel.map(databases, async(dbInfo) => {
        try {
          Logger.log('Deleting IndexedDB: ' + dbInfo.name)
          const deleteRequest = indexedDB.deleteDatabase(dbInfo.name)

          await new Promise<void>((resolve) => {
            deleteRequest.onsuccess = () => {
              Logger.log('IndexedDB cleanup successful: ' + dbInfo.name)
              resolve()
            }
            deleteRequest.onerror = () => {
              Logger.log('IndexedDB cleanup error for ' + dbInfo.name + ': ' + deleteRequest.error)
              resolve() // Don't reject, just log and continue
            }
            deleteRequest.onblocked = () => {
              Logger.log('IndexedDB cleanup blocked: ' + dbInfo.name)
              // Still resolve after a timeout even if blocked
              setTimeout(() => resolve(), 1000)
            }
          })
        } catch (e) {
          Logger.log('Error deleting IndexedDB ' + dbInfo.name + ': ' + e)
        }
      }, 4)
      Logger.log('IndexedDB cleanup completed')
    } catch (e) {
      Logger.log('Error during IndexedDB cleanup: ' + e)
    }

    // Clear the reference
    this.fs = null
  }

  /**
   * Whether a database is a lightning-fs file system of ours that nobody has
   * use for any more: the one this sync created, or one a sync that died
   * before it could clean up left behind. A file system younger than the lock
   * timeout may well belong to a sync that is still running.
   */
  private isDisposableFsDatabase(name: string): boolean {
    if (name === this.hash) {
      return true
    }
    const match = FS_DB_NAME.exec(name)
    return Boolean(match) && Date.now() - Number(match[1]) > LOCK_TIMEOUT
  }

  /**
   * Take the lease on LOCK_REF, if nobody holds a fresh one.
   *
   * This is only an optimization: it keeps two devices from doing the same
   * work, but the conditional push in pushBranch() is what makes concurrent
   * writes safe. A lease that cannot be taken therefore fails the sync with
   * E037, which Account retries with backoff and, after two hours without a
   * successful sync, forces past -- never indefinitely.
   */
  async obtainLock() {
    if (this.server.branch === LOCK_BRANCH) {
      // The lease lives on refs/heads/floccus-lock, so a data branch of that
      // name would be the lease itself: writing it would move the data under
      // the conditional write's feet and its parent check could never succeed.
      Logger.log('(git) the configured branch is the lock branch, syncing without a lease')
      return
    }
    const now = Date.now()
    // Old floccus versions create one tag per lock. Respect theirs while they
    // are fresh so that a mixed installation keeps some mutual exclusion.
    const legacyTimestamp = await this.freshestLegacyLockTimestamp()
    if (this.isFreshLease(legacyTimestamp, now)) {
      Logger.log('(git) legacy lock tag is still fresh')
      throw new ResourceLockedError()
    }
    const lease = await this.readServerLease()
    if (lease && !lease.readable) {
      // An unreadable lease could be a fresh one; taking it over would be
      // wrong, but blocking on it forever is worse. The conditional write
      // still protects the sync, so carry on without a lease.
      Logger.log('(git) lease is unreadable, syncing without one')
      return
    }
    if (lease && this.isFreshLease(lease.timestamp, now)) {
      if (lease.owner === this.lockOwner) {
        // Our own lease, left behind by a sync whose delete failed (this very
        // adapter instance). Waiting out LOCK_TIMEOUT over it would keep us
        // out of our own sync, so refresh it instead of throwing.
        Logger.log('(git) the fresh lease is our own, refreshing it')
        let refreshed
        try {
          refreshed = await this.writeLease(lease.oid, now)
        } catch (e) {
          // Only an optimization: carry on without the lease, as everywhere
          // else when writing it fails.
          Logger.log('(git) could not refresh our own lease, syncing without one', e)
          return
        }
        if (!refreshed) {
          Logger.log('(git) our lease was taken over in the meantime')
          throw new ResourceLockedError()
        }
        this.lockOid = refreshed
        return
      }
      Logger.log(`(git) lease held by ${lease.owner || 'another client'}`)
      throw new ResourceLockedError()
    }

    // An absent lease is created on top of the fetched branch; an expired one
    // is taken over by committing on top of it. That makes the takeover a
    // fast-forward, so the server rejects it if another client won the race.
    const parent = lease ? lease.oid : await this.localBranchHead()
    if (!parent) {
      Logger.log('(git) no commit to base the lease on, syncing without one')
      return
    }
    let oid
    try {
      oid = await this.writeLease(parent, now)
    } catch (e) {
      // Writing the lease failed for a reason other than losing a race (a
      // protected ref, a flaky connection). The lease is only an optimization:
      // go on without it instead of turning it into a new way to fail.
      Logger.log('(git) could not write the lease, syncing without one', e)
      return
    }
    if (!oid) {
      Logger.log('(git) lost the race for the lease')
      throw new ResourceLockedError()
    }
    this.lockOid = oid
  }

  async listServerLockTags(): Promise<string[]> {
    const refs = await git.listServerRefs({
      http,
      url: this.server.url,
      prefix: 'refs/tags/' + LEGACY_LOCK_PREFIX,
      onAuth: () => this.onAuth(),
    })
    return refs
      .map((ref) => ref.ref.replace('refs/tags/', ''))
      .filter((tag) => tag.startsWith(LEGACY_LOCK_PREFIX))
  }

  private async freshestLegacyLockTimestamp(): Promise<number|null> {
    const tags = await this.listServerLockTags()
    let newest: number|null = null
    for (const tag of tags) {
      const timestamp = Number(tag.slice(LEGACY_LOCK_PREFIX.length))
      if (Number.isFinite(timestamp) && (newest === null || timestamp > newest)) {
        newest = timestamp
      }
    }
    return newest
  }

  private isFreshLease(timestamp: number|null, now: number): boolean {
    return typeof timestamp === 'number' && Number.isFinite(timestamp) && now - timestamp < LOCK_TIMEOUT
  }

  private async readServerLease(): Promise<{ oid: string, owner: string|null, timestamp: number|null, readable: boolean }|null> {
    const oid = await this.readRemoteRef(LOCK_REF)
    if (!oid) {
      return null
    }
    let commit
    try {
      commit = (await git.readCommit({ fs: this.fs, dir: this.dir, oid })).commit
    } catch (e) {
      try {
        await git.fetch({
          http,
          fs: this.fs,
          dir: this.dir,
          remote: 'origin',
          ref: LOCK_BRANCH,
          remoteRef: LOCK_BRANCH,
          singleBranch: true,
          depth: 1,
          onAuth: () => this.onAuth(),
        })
        commit = (await git.readCommit({ fs: this.fs, dir: this.dir, oid })).commit
      } catch (fetchError) {
        Logger.log('(git) could not read lease ' + oid, fetchError)
        return { oid, owner: null, timestamp: null, readable: false }
      }
    }
    const owner = /^owner:\s*(\S+)/m.exec(commit.message)
    const timestamp = /^timestamp:\s*(\d+)/m.exec(commit.message)
    return {
      oid,
      owner: owner ? owner[1] : null,
      timestamp: timestamp ? Number(timestamp[1]) : null,
      readable: true,
    }
  }

  /**
   * Commit a lease update on top of `parent` and push it without force. Returns
   * the new lease oid, or null when the push was rejected -- which means another
   * client created or took over the lease first.
   */
  private async writeLease(parent: string, timestamp: number): Promise<string|null> {
    try {
      const { commit } = await git.readCommit({ fs: this.fs, dir: this.dir, oid: parent })
      const oid = await git.commit({
        fs: this.fs,
        dir: this.dir,
        ref: LOCK_REF,
        parent: [parent],
        tree: commit.tree,
        message: `floccus lock\n\nowner: ${this.lockOwner}\ntimestamp: ${timestamp}\n`,
        author: {
          name: 'Floccus bookmarks sync',
          timestamp: Math.floor(timestamp / 1000),
        },
      })
      const result = await git.push({
        fs: this.fs,
        http,
        dir: this.dir,
        ref: LOCK_REF,
        remoteRef: LOCK_REF,
        remote: 'origin',
        onAuth: () => this.onAuth()
      })
      if (result.error) {
        return null
      }
      const head = await this.readRemoteRef(LOCK_REF)
      return head === oid ? oid : null
    } catch (e) {
      if (this.isPushConflict(e)) {
        return null
      }
      throw e
    }
  }

  /**
   * Extend our own lease. If the remote ref is no longer at our commit, another
   * client took it over: forget it, never delete it.
   */
  async setLock() {
    if (!this.lockOid) {
      return
    }
    const run = (async() => {
      const oid = this.lockOid
      const head = await this.readRemoteRef(LOCK_REF)
      if (head !== oid) {
        Logger.log('(git) lease was taken over by another client')
        this.lockOid = null
        return
      }
      const refreshed = await this.writeLease(oid, Date.now())
      if (refreshed) {
        this.lockOid = refreshed
      } else {
        Logger.log('(git) lease refresh rejected, giving up the lease')
        this.lockOid = null
      }
    })()
    this.lockingPromise = run
    try {
      await run
    } finally {
      if (this.lockingPromise === run) {
        this.lockingPromise = null
      }
    }
  }

  async onAuth() {
    return { username: this.server.username, password: this.server.password }
  }

  async freeLock() {
    if (this.lockingPromise) {
      try {
        await this.lockingPromise
      } catch (e) {
        Logger.log('(git) waiting for lease operation failed', e)
      }
    }
    const oid = this.lockOid
    this.lockOid = null
    if (!oid || !this.fs) {
      return
    }

    try {
      // Only delete the ref while it still points at our own lease. A client
      // that took the lease over after ours expired owns it now.
      const head = await this.readRemoteRef(LOCK_REF)
      if (head !== oid) {
        Logger.log('(git) not deleting a lease we no longer own')
        return false
      }
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          Logger.log('(git) push: delete lease ' + LOCK_REF)
          const result = await git.push({ fs: this.fs, http, dir: this.dir, ref: oid, remoteRef: LOCK_REF, delete: true, remote: 'origin', onAuth: () => this.onAuth() })
          if (result.error) {
            throw new GitPushError(result.error)
          }
          return true
        } catch (e) {
          Logger.log(`(git) could not delete the lease (attempt ${attempt})`, e)
        }
      }
      // A lease we cannot delete would stay fresh for LOCK_TIMEOUT and keep
      // every client -- this one included -- out for that long. Age it instead:
      // a commit on top with an expired timestamp, which the next client takes
      // over at once. Never forced, so a lease someone else owns stays theirs.
      Logger.log('(git) aging the lease we could not delete')
      const expired = Date.now() - LOCK_TIMEOUT - 60000
      try {
        const aged = await this.writeLease(oid, expired)
        Logger.log(aged ? '(git) lease aged' : '(git) could not age the lease: it is no longer ours')
      } catch (e) {
        Logger.log('(git) could not age the lease', e)
      }
      return false
    } catch (e) {
      Logger.log('(git) freeing the lease failed', e)
      return false
    }
  }

  /**
   * Remove expired legacy lock tags. A fresh tag belongs to an old client that
   * may still be syncing, so it is left alone, just like the lease ref of
   * another client.
   */
  async clearAllLocks(fs:FS = null): Promise<void> {
    fs = fs || this.fs
    const refs = await git.listServerRefs({
      http,
      url: this.server.url,
      prefix: 'refs/tags/' + LEGACY_LOCK_PREFIX,
      onAuth: () => this.onAuth(),
    })
    const now = Date.now()
    for (const { ref, oid } of refs) {
      const tag = ref.replace('refs/tags/', '')
      if (!tag.startsWith(LEGACY_LOCK_PREFIX)) {
        continue
      }
      const timestamp = Number(tag.slice(LEGACY_LOCK_PREFIX.length))
      if (this.isFreshLease(timestamp, now)) {
        continue
      }
      Logger.log('(git) push: delete expired tag ' + ref)
      // ignoring result.error
      await git.push({ fs, http, dir: this.dir, ref: oid, remoteRef: ref, delete: true, remote: 'origin', onAuth: () => this.onAuth() })
    }
  }

  async pullFromServer() {
    let fileContents
    try {
      Logger.log('(git) readFile')
      fileContents = await this.fs.promises.readFile(this.dir + '/' + this.server.bookmark_file, { encoding: 'utf8' })
    } catch (e) {
      if (isMissingFileError(e)) {
        // No bookmark file yet: the account is new, or the server was reset
        this.resetCache()
        return false
      }
      // Anything else -- an I/O error, a broken file system -- says nothing
      // about the server. Mapping it to "file absent" would re-init() the
      // account and wipe cache and mappings over a transient read failure.
      throw e
    }

    if (!fileContents || (!fileContents.includes('<?xml version="1.0" encoding="UTF-8"?>') && !fileContents.includes('<!DOCTYPE NETSCAPE-Bookmark-file-1>'))) {
      throw new FileUnreadableError()
    }

    /* let's get the highestId */
    for (const line of fileContents.split('\n')) {
      if (line.indexOf('<!--- highestId :') >= 0) {
        const idxStart = line.indexOf(':') + 1
        const idxEnd = line.lastIndexOf(':')

        this.highestId = parseInt(line.substring(idxStart, idxEnd))
        break
      }
    }

    let file: IDeserializedFile
    switch (this.server.bookmark_file_type) {
      case 'xbel':
        Logger.log('(git) parse XBEL')
        file = XbelSerializer.deserializeFile(fileContents)
        break
      case 'html':
        Logger.log('(git) parse HTML')
        file = Html.deserializeFile(fileContents)
        break
      default:
        throw new Error('Invalid bookmark file type')
    }
    this.bookmarksCache = file.tree
    this.alwaysUpload = file.persistIds

    // Found file, we can keep the cache from the previous run
    return true
  }

  async clearServer() {
    const hash = await Crypto.sha256(JSON.stringify(this.server)) + Date.now()
    this.dir = '/' + hash + '/'

    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    const fs = new FS(hash, {wipe: true})

    Logger.log('(git) init')
    await git.init({ fs, dir: this.dir, defaultBranch: this.server.branch })
    await git.addRemote({
      fs,
      dir: this.dir,
      url: this.server.url,
      remote: 'origin',
      force: true
    })
    await fs.promises.writeFile(this.dir + '/README.md', 'This repository is used to synchronize bookmarks via [floccus](https://floccus.org).', {mode: 0o777, encoding: 'utf8'})
    await git.add({fs, dir: this.dir, filepath: '.'})
    await git.commit({
      fs,
      dir: this.dir,
      message: 'Floccus bookmarks update',
      author: {
        name: 'Floccus bookmarks sync',
      }
    })
    const currentBranch = await git.currentBranch({fs, dir: this.dir})
    if (currentBranch && currentBranch !== this.server.branch) {
      await git.renameBranch({ fs, dir: this.dir, ref: this.server.branch, oldref: currentBranch })
    }
    const result = await git.push({
      fs,
      http,
      dir: this.dir,
      ref: this.server.branch,
      remoteRef: this.server.branch,
      remote: 'origin',
      force: true,
      onAuth: () => this.onAuth()
    })
    if (result.error) {
      throw new GitPushError(result.error)
    }
    await this.clearAllLocks(fs)
  }
}

/**
 * Whether a read failure means the file simply isn't there. Lightning FS
 * reports a missing file as ENOENT; older code paths raise the isomorphic-git
 * NotFoundError.
 */
function isMissingFileError(e): boolean {
  return Boolean(e) && (e.code === 'ENOENT' || e.code === git.Errors.NotFoundError.code)
}

function createXBEL(rootFolder, highestId) {
  let output = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE xbel PUBLIC "+//IDN python.org//DTD XML Bookmark Exchange Language 1.0//EN//XML" "http://pyxml.sourceforge.net/topics/dtds/xbel.dtd">
<xbel version="1.0">
`

  output +=
    '<!--- highestId :' +
    highestId +
    `: for Floccus bookmark sync browser extension -->
`

  output += XbelSerializer.serialize(rootFolder)

  output += `
</xbel>`

  return output
}

function createHTML(rootFolder, highestId) {
  let output = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>`

  output +=
    '<!--- highestId :' +
    highestId +
    `: for Floccus bookmark sync browser extension -->
`

  output += Html.serialize(rootFolder)

  output += '</html>'

  return output
}
