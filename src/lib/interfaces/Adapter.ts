import { Bookmark } from '../Tree'
import TResource from './Resource'

export default interface IAdapter {
  setData(data: Record<string, any>): void
  getData() :Record<string, any>
  getLabel(): string
  acceptsBookmark(bookmark:Bookmark): boolean
  onSyncStart():Promise<void|boolean>
  onSyncComplete():Promise<void>
  onSyncFail():Promise<void>
}

export type TAdapter = IAdapter & TResource
