import Mappings from '../Mappings'
import { Folder, ItemLocation } from '../Tree'
import { ISerializedSyncProcess } from '../strategies/Default'
import { IContinuationUpdate } from '../Continuation'
import ICacheStore from './CacheStore'

export type TAccountStrategy = 'default' | 'overwrite' | 'slave'

/**
 * The changes a sync would make, as counted by a check. `local` are the ones
 * it would apply to the local bookmarks (coming from the server), `server` the
 * ones it would apply to the server. `initial` marks a profile that hasn't
 * synced yet: there is no cache to compare against, so everything would count.
 */
export interface IPendingChanges {
  local: number
  server: number
  initial?: boolean
}

export interface IAccountData {
  enabled?: boolean
  localRoot?: string
  strategy?: TAccountStrategy
  syncIntervalEnabled?: boolean
  syncOnStartupEnabled?: boolean
  syncInterval?: number
  nestedSync?: boolean
  failsafe?: boolean
  username?: string
  password?: string
  label?: string
  lastSync?: number
  lastAttempt?: number
  errorCount?: number
  clickCountEnabled?: boolean
  isTransientError?: boolean | null
  /** Only look for changes by itself, and leave syncing them to the user (browser only) */
  notifyOnly?: boolean
  /** Show a system notification when a notify-only profile finds changes */
  notificationsEnabled?: boolean
  /** What the last check found would be done by the next sync; null if nothing */
  pendingChanges?: IPendingChanges | null
  /** When a notify-only profile was last checked for changes */
  lastCheck?: number
  /** A check is due as soon as no other profile is syncing */
  checkScheduled?: boolean
  [p: string]: any
}

export default interface IAccountStorage {
  accountId: string;
  getAccountData(key): Promise<IAccountData>;
  setAccountData(data:IAccountData, key:string): Promise<void>;
  deleteAccountData(): Promise<void>
  initCache(): Promise<void>
  getCache(): Promise<Folder<typeof ItemLocation.LOCAL>>
  setCache(data): Promise<void>
  deleteCache(): Promise<void>
  /**
   * Where the sync cache is kept. The tree hands its changes to it as they
   * happen, so that a persist costs what has changed -- see ICacheStore.
   */
  getCacheStore(): ICacheStore
  initMappings(): Promise<void>;
  getMappings(): Promise<Mappings>;
  setMappings(data): Promise<void>;
  deleteMappings(): Promise<void>;
  getCurrentContinuation(): Promise<ISerializedSyncProcess|null>;
  setCurrentContinuation(continuation: ISerializedSyncProcess|null): Promise<void>;
  /** Whether updates may carry only what changed since the last persist */
  canPersistContinuationIncrementally(): Promise<boolean>;
  updateCurrentContinuation(update: IContinuationUpdate): Promise<void>;
}
