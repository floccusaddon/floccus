import { TItem, TItemLocation, TItemType } from './Tree'

type InternalItemTypeMapping = { LocalToServer: Record<string, string>, ServerToLocal: Record<string, string> }

export type Mapping = Record<TItemType,Record<string,number|string>>

export type MappingSnapshot = {
  ServerToLocal: Mapping,
  LocalToServer: Mapping
}

export default class Mappings {
  private folders: InternalItemTypeMapping
  private bookmarks: InternalItemTypeMapping
  private storage: any

  constructor(storageAdapter:any, mappingsData:any) {
    this.storage = storageAdapter
    this.folders = mappingsData.folders
    this.bookmarks = mappingsData.bookmarks
  }

  getSnapshot():MappingSnapshot {
    return {
      ServerToLocal: {
        bookmark: {...this.bookmarks.ServerToLocal},
        folder: {...this.folders.ServerToLocal}
      },
      LocalToServer: {
        bookmark: {...this.bookmarks.LocalToServer},
        folder: {...this.folders.LocalToServer}
      }
    }
  }

  async addFolder({ localId, remoteId }: { localId?:string|number, remoteId?:string|number }):Promise<void> {
    Mappings.add(this.folders, { localId, remoteId })
  }

  async removeFolder({ localId, remoteId }: { localId?:string|number, remoteId?:string|number }):Promise<void> {
    Mappings.remove(this.folders, { localId, remoteId })
  }

  async addBookmark({ localId, remoteId }: { localId?:string|number, remoteId?:string|number }):Promise<void> {
    Mappings.add(this.bookmarks, { localId, remoteId })
  }

  async removeBookmark({ localId, remoteId }: { localId?:string|number, remoteId?:string|number }):Promise<void> {
    Mappings.remove(this.bookmarks, { localId, remoteId })
  }

  async persist():Promise<void> {
    await this.storage.setMappings({
      folders: this.folders,
      bookmarks: this.bookmarks
    })
  }

  private static add(mappings, { localId, remoteId }: { localId?:string|number, remoteId?:string|number }) {
    if (typeof localId === 'undefined' || typeof remoteId === 'undefined') {
      throw new Error('Cannot add empty mapping')
    }
    mappings.LocalToServer[localId] = remoteId
    mappings.ServerToLocal[remoteId] = localId
  }

  private static remove(mappings, { localId, remoteId }: { localId?:string|number, remoteId?:string|number }):InternalItemTypeMapping {
    if (localId && remoteId && mappings.LocalToServer[localId] !== remoteId) {
      mappings = this.remove(mappings, { localId })
      return this.remove(mappings, { remoteId })
    }

    if (typeof localId !== 'undefined') {
      delete mappings.ServerToLocal[mappings.LocalToServer[localId]]
      delete mappings.LocalToServer[localId]
    } else {
      delete mappings.LocalToServer[mappings.ServerToLocal[remoteId]]
      delete mappings.ServerToLocal[remoteId]
    }
  }

  static mapId(mappingsSnapshot:MappingSnapshot, item: TItem<TItemLocation>, target: TItemLocation) : string|number {
    if (item.location === target) {
      return item.id
    }
    return mappingsSnapshot[item.location + 'To' + target][item.type][item.id]
  }

  static mapParentId(mappingsSnapshot:MappingSnapshot, item: TItem<TItemLocation>, target: TItemLocation) : string|number {
    if (item.location === target) {
      return item.parentId
    }
    return mappingsSnapshot[item.location + 'To' + target].folder[item.parentId]
  }

  static mappable(mappingsSnapshot: MappingSnapshot, item1: TItem<TItemLocation>, item2: TItem<TItemLocation>) : boolean {
    if (Mappings.mapId(mappingsSnapshot, item1, item2.location) === item2.id) {
      return true
    }
    if (Mappings.mapId(mappingsSnapshot, item2, item1.location) === item1.id) {
      return true
    }
    return false
  }
}
