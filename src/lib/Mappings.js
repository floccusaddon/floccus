import AsyncLock from 'async-lock'

export default class Mappings {
  constructor(storageAdapter, mappingsData) {
    this.storage = storageAdapter
    this.folders = mappingsData.folders
    this.bookmarks = mappingsData.bookmarks
    this.lock = new AsyncLock()
  }

  getSnapshot() {
    return {
      ServerToLocal: {
        bookmarks: { ...this.bookmarks.ServerToLocal },
        folders: { ...this.folders.ServerToLocal }
      },
      LocalToServer: {
        bookmarks: { ...this.bookmarks.LocalToServer },
        folders: { ...this.folders.LocalToServer }
      }
    }
  }

  async addFolder({ localId, remoteId }) {
    await this.lock.acquire('storage', async () => {
      Mappings.add(this.folders, { localId, remoteId })
      await this.storage.setMappings({
        folders: this.folders,
        bookmarks: this.bookmarks
      })
    })
  }

  async removeFolder({ localId, remoteId }) {
    await this.lock.acquire('storage', async () => {
      Mappings.remove(this.folders, { localId, remoteId })
      await this.storage.setMappings({
        folders: this.folders,
        bookmarks: this.bookmarks
      })
    })
  }

  async addBookmark({ localId, remoteId }) {
    await this.lock.acquire('storage', async () => {
      Mappings.add(this.bookmarks, { localId, remoteId })
      await this.storage.setMappings({
        folders: this.folders,
        bookmarks: this.bookmarks
      })
    })
  }

  async removeBookmark({ localId, remoteId }) {
    await this.lock.acquire('storage', async () => {
      Mappings.remove(this.bookmarks, { localId, remoteId })
      await this.storage.setMappings({
        folders: this.folders,
        bookmarks: this.bookmarks
      })
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
