import Mappings from '../Mappings'
import { Folder, ItemLocation } from '../Tree'
import { ISerializedSyncProcess } from '../strategies/Default'
import { IContinuationUpdate } from '../Continuation'
import ICacheStore from './CacheStore'

export type TAccountStrategy = 'default' | 'overwrite' | 'slave'

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
