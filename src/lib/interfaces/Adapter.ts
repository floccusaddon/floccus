import { Bookmark, ItemLocation, TItemLocation } from '../Tree'
import TResource from './Resource'
import { IAccountData } from './AccountStorage'

export default interface IAdapter {
  setData(data: IAccountData): void
  getData() :IAccountData
  getLabel(): string
  acceptsBookmark(bookmark:Bookmark<TItemLocation>): boolean
  onSyncStart(needLock?:boolean, forceLock?: boolean):Promise<void|boolean>
  onSyncComplete():Promise<void>
  onSyncFail():Promise<void>
  cancel():void
}

export type TAdapter = IAdapter & TResource<typeof ItemLocation.SERVER>
