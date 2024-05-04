import Mappings from '../Mappings'
import { Folder } from '../Tree'
import { ISerializedSyncProcess } from '../strategies/Default'

export type TAccountStrategy = 'default' | 'overwrite' | 'slave'

export interface IAccountData {
  localRoot?: string
  strategy?: TAccountStrategy
  syncInterval?: number
  nestedSync?: boolean
  failsafe?: boolean
  username?: string
  password?: string
  [p:string]: any
}

export default interface IAccountStorage {
  accountId: string;
  getAccountData(key): Promise<IAccountData>;
  setAccountData(data:IAccountData, key:string): Promise<void>;
  deleteAccountData(): Promise<void>
  initCache(): Promise<void>
  getCache(): Promise<Folder>
  setCache(data): Promise<void>
  deleteCache(): Promise<void>
  initMappings(): Promise<void>;
  getMappings(): Promise<Mappings>;
  setMappings(data): Promise<void>;
  deleteMappings(): Promise<void>;
  getCurrentContinuation(): Promise<ISerializedSyncProcess|null>;
  setCurrentContinuation(continuation: ISerializedSyncProcess|null): Promise<void>;
}
