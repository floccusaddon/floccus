import browser from '../browser-api'
import Cryptography from '../Crypto'
import DefunctCryptography from '../DefunctCrypto'
import Mappings from '../Mappings'
import { Folder, ItemLocation } from '../Tree'
import AsyncLock from 'async-lock'
import Logger from '../Logger'
import BrowserContinuationStore from './BrowserContinuationStore'
import { continuationUpdateToJSON } from '../Continuation'

const storageLock = new AsyncLock()

export default class BrowserAccountStorage {
  constructor(id) {
    this.accountId = id
    this.continuationStore = new BrowserContinuationStore(id)
  }

  static async setEntry(entryName, value) {
    await storageLock.acquire(entryName, async() => {
      await browser.storage.local.set({ [entryName]: value })
    })
  }

  static async changeEntry(entryName, fn, defaultVal) {
    await storageLock.acquire(entryName, async() => {
      let entry = await BrowserAccountStorage.getEntry(entryName, defaultVal)
      entry = fn(entry)

      await browser.storage.local.set({ [entryName]: JSON.stringify(entry) })
    })
  }

  static async getEntry(entryName, defaultVal) {
    let entry = await browser.storage.local.get(entryName)
    try {
      if (entry[entryName]) {
        while (typeof entry[entryName] === 'string') {
          entry[entryName] = JSON.parse(entry[entryName])
        }
        return entry[entryName]
      } else {
        return defaultVal
      }
    } catch (e) {
      Logger.log(
        'Error while parsing BrowserAccountStorage entry value ' + e.message
      )
      console.error(e)
      return defaultVal
    }
  }

  static deleteEntry(entryName) {
    return browser.storage.local.remove(entryName)
  }

  static async getAllAccounts() {
    let accounts = await BrowserAccountStorage.getEntry(`accounts`, {})
    return Object.keys(accounts)
  }

  async getAccountData(key) {
    let accounts = await BrowserAccountStorage.getEntry(`accounts`, {})
    let data = accounts[this.accountId]
    if (key) {
      if (data.iv) {
        data.password = await DefunctCryptography.decryptAES(
          key,
          data.iv,
          data.password
        )
        delete data.iv
      } else {
        data.password = await Cryptography.decryptAES(
          key,
          data.password,
          data.username
        )
        if (data.passphrase) {
          data.passphrase = await Cryptography.decryptAES(
            key,
            data.passphrase,
            data.username
          )
        }
      }
    }
    return data
  }

  async setAccountData(data, key) {
    let encData = data
    if (key) {
      if (data.iv) {
        delete data.iv
      }
      encData = {
        ...data,
        password: await Cryptography.encryptAES(
          key,
          data.password,
          data.username
        ),
        ...(data.passphrase && {
          passphrase: await Cryptography.encryptAES(
            key,
            data.passphrase,
            data.username
          ),
        }),
      }
    }
    return BrowserAccountStorage.changeEntry(
      `accounts`,
      (accounts) => {
        accounts[this.accountId] = encData
        return accounts
      },
      {}
    )
  }

  async deleteAccountData() {
    await BrowserAccountStorage.changeEntry(`accounts`, (accounts) => {
      delete accounts[this.accountId]
      return accounts
    })
    await this.deleteCache()
    await this.deleteMappings()
    await this.setCurrentContinuation(null)
  }

  async initCache() {
    await BrowserAccountStorage.setEntry(
      `bookmarks[${this.accountId}].cache`,
      {}
    )
  }

  async getCache() {
    const data = await BrowserAccountStorage.getEntry(
      `bookmarks[${this.accountId}].cache`
    )
    return Folder.hydrate(
      data && Object.keys(data).length ? data : { location: ItemLocation.LOCAL }
    )
  }

  async setCache(data) {
    await BrowserAccountStorage.setEntry(
      `bookmarks[${this.accountId}].cache`,
      data.toJSON ? data.toJSON() : data
    )
  }

  async deleteCache() {
    await BrowserAccountStorage.deleteEntry(
      `bookmarks[${this.accountId}].cache`
    )
  }

  async initMappings() {
    await BrowserAccountStorage.setEntry(
      `bookmarks[${this.accountId}].mappings`,
      {}
    )
  }

  async getMappings() {
    const data = await BrowserAccountStorage.getEntry(
      `bookmarks[${this.accountId}].mappings`
    )
    return new Mappings(
      this,
      data && Object.keys(data).length
        ? data
        : {
          bookmarks: {
            ServerToLocal: {},
            LocalToServer: {},
          },
          folders: {
            ServerToLocal: {},
            LocalToServer: {},
          },
        }
    )
  }

  async setMappings(data) {
    await BrowserAccountStorage.setEntry(
      `bookmarks[${this.accountId}].mappings`,
      data
    )
  }

  async deleteMappings() {
    await BrowserAccountStorage.deleteEntry(
      `bookmarks[${this.accountId}].mappings`
    )
  }

  /**
   * Continuations are stored as rows, one per action of the sync plan, so that a
   * progress tick only writes what has changed since the last one instead of the
   * whole plan -- see Continuation.ts. Only if IndexedDB can't be had do we fall
   * back to the blob in extension storage that this used to be.
   */
  async canPersistContinuationIncrementally() {
    if (typeof this.continuationIncremental === 'undefined') {
      this.continuationIncremental = await BrowserContinuationStore.isAvailable()
    }
    return this.continuationIncremental
  }

  async getCurrentContinuation() {
    // A continuation written before this account was moved to row storage, by a
    // version of floccus that didn't have it yet, or by a sync that fell back to
    // the blob halfway through
    const blob = await BrowserAccountStorage.getEntry(
      `bookmarks[${this.accountId}].continuation`
    )
    if (await this.canPersistContinuationIncrementally()) {
      const stored = await this.continuationStore.load()
      // Whichever describes the later point of the sync that wrote it. Rows and
      // a blob can both be there when a sync fell back from one to the other,
      // and preferring the rows outright would resume from a point that sync
      // had already moved past.
      if (stored && !(blob && blob.createdAt > stored.createdAt)) {
        return stored
      }
    }
    return blob
  }

  async updateCurrentContinuation(update) {
    if (!(await this.canPersistContinuationIncrementally())) {
      // The update was built as a full one for exactly this case
      await this.setCurrentContinuation(continuationUpdateToJSON(update))
      return
    }
    try {
      await this.continuationStore.update(update)
    } catch (e) {
      // IndexedDB can go away under us -- the database deleted or upgraded from
      // elsewhere in this origin, storage evicted. This update carries only what
      // changed, so it can't be written as a blob as it stands; give up on the
      // rows instead, so that the next update is built as a full one and lands
      // in extension storage.
      Logger.log('Continuation store failed, falling back to extension storage: ' + e.message)
      this.continuationIncremental = false
      await this.clearContinuationStore()
      throw e
    }
    if (!this.legacyContinuationCleared) {
      // So that a blob from before the row storage can't outlive the rows and
      // be resumed after they were cleared
      await BrowserAccountStorage.deleteEntry(
        `bookmarks[${this.accountId}].continuation`
      )
      this.legacyContinuationCleared = true
    }
  }

  /**
   * Best effort: throwing here would fail a sync that has otherwise gone
   * through. Rows we can't drop are superseded by the newer stamp of whatever
   * is written next, and Account#sync discards a continuation older than half
   * an hour in any case.
   */
  async clearContinuationStore() {
    try {
      await this.continuationStore.clear()
    } catch (e) {
      Logger.log('Could not clear the continuation store: ' + e.message)
    }
  }

  async setCurrentContinuation(continuation) {
    // Unconditionally, not just while the rows are the storage in use: a sync
    // that fell back to the blob halfway through has left rows behind, and they
    // must not outlive it either
    await this.clearContinuationStore()
    await BrowserAccountStorage.setEntry(
      `bookmarks[${this.accountId}].continuation`,
      // Clearing has to store null, not { createdAt }: Account#sync takes any
      // non-null entry for a continuation and hands it to fromJSON, which then
      // throws 'Unknown strategy: undefined' on every sync after a completed one
      continuation && { ...continuation, createdAt: Date.now() }
    )
  }
}
