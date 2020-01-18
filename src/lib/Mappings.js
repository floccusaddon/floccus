export default class Mappings {
  constructor(storageAdapter, mappingsData) {
    this.storage = storageAdapter
    this.folders = mappingsData.folders
    this.bookmarks = mappingsData.bookmarks
  }

  getSnapshot() {
    return {
      ServerToLocal: {
        bookmarks: this.bookmarks.ServerToLocal,
        folders: this.folders.ServerToLocal
      },
      LocalToServer: {
        bookmarks: this.bookmarks.LocalToServer,
        folders: this.folders.LocalToServer
      }
    }
  }

  async addFolder({ localId, remoteId }) {
    this.folders = Mappings.add(this.folders, { localId, remoteId })
  }

  async removeFolder({ localId, remoteId }) {
    this.folders = Mappings.remove(this.folders, { localId, remoteId })
  }

  async addBookmark({ localId, remoteId }) {
    this.bookmarks = Mappings.add(this.bookmarks, { localId, remoteId })
  }

  async removeBookmark({ localId, remoteId }) {
    this.bookmarks = Mappings.remove(this.bookmarks, { localId, remoteId })
  }

  async persist() {
    await this.storage.setMappings({
      folders: this.folders,
      bookmarks: this.bookmarks
    })
  }

  static add(mappings, { localId, remoteId }) {
    if (typeof localId === 'undefined' || typeof remoteId === 'undefined') {
      throw new Error('Cannot add empty mapping')
    }
    return {
      LocalToServer: {
        ...mappings.LocalToServer,
        [localId]: remoteId
      },
      ServerToLocal: {
        ...mappings.ServerToLocal,
        [remoteId]: localId
      }
    }
  }

  static remove(mappings, { localId, remoteId }) {
    if (localId && remoteId && mappings.LocalToServer[localId] !== remoteId) {
      mappings = this.remove(mappings, { localId })
      return this.remove(mappings, { remoteId })
    }
    if (localId) {
      return {
        LocalToServer: {
          ...mappings.LocalToServer,
          [localId]: undefined
        },
        ServerToLocal: {
          ...mappings.ServerToLocal,
          [mappings.LocalToServer[localId]]: undefined
        }
      }
    } else {
      return {
        LocalToServer: {
          ...mappings.LocalToServer,
          [mappings.ServerToLocal[remoteId]]: undefined
        },
        ServerToLocal: {
          ...mappings.ServerToLocal,
          [remoteId]: undefined
        }
      }
    }
  }
}
