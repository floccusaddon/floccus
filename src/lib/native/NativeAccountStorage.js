import { Preferences as Storage } from '@capacitor/preferences'
import Cryptography from '../Crypto'
import DefunctCryptography from '../DefunctCrypto'
import Mappings from '../Mappings'
import { Folder, ItemLocation } from '../Tree'
import AsyncLock from 'async-lock'
import Logger from '../Logger'
import NativeMappingsStore from './NativeMappingsStore'
import NativeTreeStore from './NativeTreeStore'
import NativeContinuationStore from './NativeContinuationStore'
import NativeLogStore from './NativeLogStore'

const storageLock = new AsyncLock()

export default class NativeAccountStorage {
  constructor(id) {
    this.accountId = id
    this.mappingsStore = new NativeMappingsStore(id)
    this.continuationStore = new NativeContinuationStore(id)
  }

  /**
   * changeEntry without the read, for the callers that replace an entry
   * wholesale. Reading the old value back first means pulling a blob out of
   * the preferences and parsing it only to throw it away -- which for the
   * cache, the continuation and the logs of a large account is megabytes of
   * JSON on every single persist, and those happen throughout a sync.
   */
  static async setEntry(entryName, value) {
    await storageLock.acquire(entryName, async() => {
      await Storage.set({ key: entryName, value: JSON.stringify(value) })
    })
  }

  static async changeEntry(entryName, fn, defaultVal) {
    await storageLock.acquire(entryName, async() => {
      let entry = await NativeAccountStorage.getEntry(entryName, defaultVal)
      entry = fn(entry)

      await Storage.set({ key: entryName, value: JSON.stringify(entry) })
    })
  }

  static async getEntry(entryName, defaultVal) {
    let entry = await Storage.get({key: entryName })
    try {
      if (entry.value) {
        if (typeof entry.value === 'string') {
          entry.value = JSON.parse(entry.value)
        }
        return entry.value
      } else {
        return defaultVal
      }
    } catch (e) {
      Logger.log('Error while parsing NativeAccountStorage entry value ' + e.message)
      console.error(e)
      return defaultVal
    }
  }

  static deleteEntry(entryName) {
    return Storage.remove({key: entryName})
  }

  /**
   * The log is rows rather than an entry, so that adding to it doesn't mean
   * rewriting it -- see NativeLogStore.
   */
  static appendLogs(messages) {
    return NativeLogStore.append(messages)
  }

  static getLogs() {
    return NativeLogStore.read()
  }

  static clearLogs() {
    return NativeLogStore.clear()
  }

  static async getAllAccounts() {
    let accounts = await NativeAccountStorage.getEntry(`accounts`, {})
    return Object.keys(accounts)
  }

  async getAccountData(key) {
    let accounts = await NativeAccountStorage.getEntry(`accounts`, {})
    let data = accounts[this.accountId]
    if (key) {
      if (data.iv) {
        data.password = await DefunctCryptography.decryptAES(key, data.iv, data.password)
        delete data.iv
      } else {
        data.password = await Cryptography.decryptAES(key, data.password, data.username)
        if (data.passphrase) {
          data.passphrase = await Cryptography.decryptAES(key, data.passphrase, data.username)
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
        password: await Cryptography.encryptAES(key, data.password, data.username),
        ...(data.passphrase && {passphrase: await Cryptography.encryptAES(key, data.passphrase, data.username)})
      }
    }
    return NativeAccountStorage.changeEntry(
      `accounts`,
      accounts => {
        accounts[this.accountId] = encData
        return accounts
      },
      {}
    )
  }

  async deleteAccountData() {
    await NativeAccountStorage.changeEntry(`accounts`, accounts => {
      delete accounts[this.accountId]
      return accounts
    })
    await this.deleteCache()
    await this.deleteMappings()
    await this.setCurrentContinuation(null)
    // Unlike the preferences keys of old, the rows of a deleted account would
    // stay in the shared database forever, so drop the local tree as well
    await new NativeTreeStore(this.accountId).clear()
  }

  async isMappingsInitialized() {
    return this.mappingsStore.isInitialized()
  }

  async initCache() {
    await NativeAccountStorage.setEntry(`bookmarks[${this.accountId}].cache`, {})
  }

  async getCache() {
    const data = await NativeAccountStorage.getEntry(
      `bookmarks[${this.accountId}].cache`
    )
    return Folder.hydrate(data && Object.keys(data).length ? data : {location: ItemLocation.LOCAL})
  }

  async setCache(data) {
    await NativeAccountStorage.setEntry(
      `bookmarks[${this.accountId}].cache`,
      data.toJSON ? data.toJSON() : data
    )
  }

  async deleteCache() {
    await NativeAccountStorage.deleteEntry(`bookmarks[${this.accountId}].cache`)
  }

  async initMappings() {
    await this.mappingsStore.init()
  }

  async getMappings() {
    return new Mappings(this, await this.mappingsStore.load())
  }

  async setMappings(data) {
    await this.mappingsStore.save(data)
  }

  async deleteMappings() {
    await this.mappingsStore.clear()
  }

  /**
   * Continuations are stored as rows, one per action of the sync plan, so that a
   * progress tick only writes what has changed since the last one instead of the
   * whole plan -- see Continuation.ts.
   */
  async canPersistContinuationIncrementally() {
    return true
  }

  async getCurrentContinuation() {
    const stored = await this.continuationStore.load()
    if (stored) {
      return stored
    }
    // A continuation written before this account was moved to row storage, or
    // by a version of floccus that didn't have it yet
    return NativeAccountStorage.getEntry(`bookmarks[${this.accountId}].continuation`)
  }

  async updateCurrentContinuation(update) {
    await this.continuationStore.update(update)
    if (!this.legacyContinuationCleared) {
      // So that a blob from before the row storage can't outlive the rows and
      // be resumed after they were cleared
      await NativeAccountStorage.deleteEntry(`bookmarks[${this.accountId}].continuation`)
      this.legacyContinuationCleared = true
    }
  }

  async setCurrentContinuation(continuation) {
    await this.continuationStore.clear()
    await NativeAccountStorage.setEntry(
      `bookmarks[${this.accountId}].continuation`,
      // Account#sync discards continuations older than half an hour by their
      // createdAt; without one that check is `Date.now() - undefined > x`, i.e.
      // NaN > x, i.e. false, and a zombie continuation is resumed forever
      continuation && { ...continuation, createdAt: Date.now() }
    )
  }
}
