import { Bookmark, ItemLocation, TItemLocation } from '../Tree'
import TResource from './Resource'
import { IAccountData } from './AccountStorage'

export default interface IAdapter {
  setData(data: IAccountData): void
  getData() :IAccountData
  getLabel(): string
  acceptsBookmark(bookmark:Bookmark<TItemLocation>): boolean
  onSyncStart(needLock?:boolean, forceLock?: boolean):Promise<void|boolean>
  /**
   * Make the server-side plan durable, before any local action is applied.
   *
   * Adapters that stage their changes in memory and upload a whole snapshot
   * (Git, WebDAV, S3, Google Drive, Dropbox) implement this: the strategy calls
   * it once the server plan has been executed and before the local plan runs,
   * and again if the server-side reorderings changed anything afterwards.
   * Returning a revision lets a continuation record what the server has, so a
   * resumed sync can skip work that is already there.
   *
   * Adapters that apply every action to the server as it happens (Nextcloud
   * Bookmarks, Linkwarden, Karakeep) leave this out: their changes are durable
   * by the time the action is done, so there is nothing to commit separately.
   *
   * Throwing means the server did not take the changes; the strategy then stops
   * before touching the local tree and restores the mappings it had before.
   */
  onSyncCommit?():Promise<string|null>
  /**
   * Tear down the sync: release the lock and clean up. For an adapter that
   * implements onSyncCommit this must not upload again; it commits only as a
   * fallback when the caller never called onSyncCommit (direct adapter use).
   */
  onSyncComplete():Promise<void>
  onSyncFail():Promise<void>
  /**
   * Tell a history-carrying adapter whether this run's server-side deletions
   * are the user's deletions (true, the default) or the mirroring of a one-way
   * overwrite (false).
   *
   * Only the former may become a tombstone: an overwrite replaces the server
   * with the local tree, so the items it removes there were never deleted by
   * anyone. Treating them as deletions would make a client with a fresh cache
   * delete its own items over a server that was merely overwritten.
   */
  setDeletionRecording?(records: boolean):void
}

export type TAdapter = IAdapter & TResource<typeof ItemLocation.SERVER>
