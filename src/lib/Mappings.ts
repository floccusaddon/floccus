import { Folder, ItemLocation, ItemType, TItem, TItemLocation, TItemType } from './Tree'
import Logger from './Logger'

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

  async gc(
    localTree: Folder<typeof ItemLocation.LOCAL>,
    serverTree?: Folder<typeof ItemLocation.SERVER>
  ) {
    const localIndex = localTree.createIndex()
    for (const localId in this.bookmarks.LocalToServer) {
      if (!(localId in localIndex[ItemType.BOOKMARK])) {
        await this.removeBookmark({localId})
      }
    }
    for (const localId in this.folders.LocalToServer) {
      if (!(localId in localIndex[ItemType.FOLDER])) {
        await this.removeFolder({localId})
      }
    }
    // Caller must only pass serverTree when it is complete and trusted (i.e. an atomic
    // adapter's in-memory cache). A sparse tree would falsely drop mappings for unloaded
    // items.
    if (serverTree) {
      const serverIndex = serverTree.createIndex()
      for (const remoteId in this.bookmarks.ServerToLocal) {
        if (!(remoteId in serverIndex[ItemType.BOOKMARK])) {
          await this.removeBookmark({remoteId})
        }
      }
      for (const remoteId in this.folders.ServerToLocal) {
        if (!(remoteId in serverIndex[ItemType.FOLDER])) {
          await this.removeFolder({remoteId})
        }
      }
    }
  }

  async addFolder({ localId, remoteId }: { localId?:string|number, remoteId?:string|number }):Promise<void> {
    Mappings.logCollateralEviction('folder', this.folders, { localId, remoteId })
    Mappings.remove(this.folders, { localId, remoteId })
    Mappings.add(this.folders, { localId, remoteId })
  }

  async removeFolder({ localId, remoteId }: { localId?:string|number, remoteId?:string|number }):Promise<void> {
    Mappings.remove(this.folders, { localId, remoteId })
  }

  async addBookmark({ localId, remoteId }: { localId?:string|number, remoteId?:string|number }):Promise<void> {
    Mappings.logCollateralEviction('bookmark', this.bookmarks, { localId, remoteId })
    Mappings.remove(this.bookmarks, { localId, remoteId })
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
    if (typeof localId === 'undefined' || typeof remoteId === 'undefined' || localId === null || remoteId === null) {
      throw new Error('Cannot add empty mapping')
    }
    mappings.LocalToServer[localId] = remoteId
    mappings.ServerToLocal[remoteId] = localId
  }

  private static remove(mappings, { localId, remoteId }: { localId?:string|number, remoteId?:string|number }):InternalItemTypeMapping {
    if (localId && remoteId && mappings.LocalToServer[localId] !== remoteId) {
      this.remove(mappings, { localId })
      this.remove(mappings, { remoteId })
      return
    }

    if (typeof localId !== 'undefined') {
      delete mappings.ServerToLocal[mappings.LocalToServer[localId]]
      delete mappings.LocalToServer[localId]
    }
    if (typeof remoteId !== 'undefined') {
      delete mappings.LocalToServer[mappings.ServerToLocal[remoteId]]
      delete mappings.ServerToLocal[remoteId]
    }
  }

  static mapRawId(mappingsSnapshot:MappingSnapshot, id: string|number, type: TItemType, source: TItemLocation, target: TItemLocation) : string|number {
    if (target === source) {
      return id
    }
    return mappingsSnapshot[source + 'To' + target][type][id]
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

  // Returns true iff binding item1 <-> item2 would tear down an existing mapping that points
  // at a *different* counterpart on either side. Sub-scanner mergeable predicates use this to
  // reject ambiguous canMergeWith matches (e.g. duplicate-title folders) before the wrong pair
  // is recorded and a third-party mapping is silently evicted.
  static wouldEvictUnrelatedMapping(
    snapshot: MappingSnapshot,
    item1: TItem<TItemLocation>,
    item2: TItem<TItemLocation>
  ): boolean {
    if (item1.location === item2.location) {
      // No cross-location mapping is recorded in this case (see Scanner#addMapping)
      return false
    }
    const item1Counterpart = Mappings.mapId(snapshot, item1, item2.location)
    if (
      typeof item1Counterpart !== 'undefined' &&
      String(item1Counterpart) !== String(item2.id)
    ) {
      return true
    }
    const item2Counterpart = Mappings.mapId(snapshot, item2, item1.location)
    if (
      typeof item2Counterpart !== 'undefined' &&
      String(item2Counterpart) !== String(item1.id)
    ) {
      return true
    }
    return false
  }

  private static logCollateralEviction(
    kind: 'folder' | 'bookmark',
    mappings: InternalItemTypeMapping,
    { localId, remoteId }: { localId?: string | number, remoteId?: string | number }
  ): void {
    if (typeof localId === 'undefined' || typeof remoteId === 'undefined') return
    const existingLocal = mappings.ServerToLocal[remoteId as string]
    if (
      typeof existingLocal !== 'undefined' &&
      String(existingLocal) !== String(localId)
    ) {
      Logger.log(
        `Mappings.add(${kind}): replacing ${existingLocal}->${remoteId} with ${localId}->${remoteId}; ` +
        `${existingLocal} will become unmapped`
      )
    }
  }

  static mappable(mappingsSnapshot: MappingSnapshot, item1: TItem<TItemLocation>, item2: TItem<TItemLocation>) : boolean {
    if (String(Mappings.mapId(mappingsSnapshot, item1, item2.location)) === String(item2.id)) {
      return true
    }
    if (String(Mappings.mapId(mappingsSnapshot, item2, item1.location)) === String(item1.id)) {
      return true
    }
    return false
  }
}
