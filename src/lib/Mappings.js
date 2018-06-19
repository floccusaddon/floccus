export default class Mappings {
  constructor(storageAdapter, mappingsData) {
    this.storage = storageAdapter
    this.folders = mappingsData.folders
    this.bookmarks = mappingsData.bookmarks
  }

  async addFolder({ localId, remoteId }) {
    Mappings.add(this.folders, { localId, remoteId })
    await this.storage.setMappings({
      folders: this.folders,
      bookmarks: this.bookmarks
    })
  }

  async removeFolder({ localId, remoteId }) {
    Mappings.remove(this.folders, { localId, remoteId })
    await this.storage.setMappings({
      folders: this.folders,
      bookmarks: this.bookmarks
    })
  }

  async addBookmark({ localId, remoteId }) {
    Mappings.add(this.bookmarks, { localId, remoteId })
    await this.storage.setMappings({
      folders: this.folders,
      bookmarks: this.bookmarks
    })
  }

  async removeBookmark({ localId, remoteId }) {
    Mappings.remove(this.bookmarks, { localId, remoteId })
    await this.storage.setMappings({
      folders: this.folders,
      bookmarks: this.bookmarks
    })
  }

  static add(mappings, { localId, remoteId }) {
    if (typeof localId === 'undefined' || typeof remoteId === 'undefined') {
      throw new Error('Cannot add empty mapping')
    }
    mappings.LocalToServer[localId] = remoteId
    mappings.ServerToLocal[remoteId] = localId
  }

  static remove(mappings, { localId, remoteId }) {
    if (localId && remoteId && mappings.LocalToServer[localId] !== remoteId) {
      this.remove(mappings, { localId })
      this.remove(mappings, { remoteId })
      return
    }
    if (localId) {
      delete mappings.ServerToLocal[mappings.LocalToServer[localId]]
      delete mappings.LocalToServer[localId]
    } else {
      delete mappings.LocalToServer[mappings.ServerToLocal[remoteId]]
      delete mappings.ServerToLocal[remoteId]
    }
  }
}
