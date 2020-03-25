import browser from './browser-api'
import Cryptography from './Crypto'
import Mappings from './Mappings'
import { Folder } from './Tree'
import AsyncLock from 'async-lock'
import * as localForage from 'localforage'

const storage = (window.browser && browser.storage) || (window.chrome && chrome.storage);

const storageLock = new AsyncLock()

export default class AccountStorage {
  constructor(id) {
    this.accountId = id
  }

  static async changeEntry(entryName, fn, defaultVal) {
    await storageLock.acquire(entryName, async () => {

      let entry = await AccountStorage.getEntry(entryName, defaultVal);
      entry = fn(entry)

      // extension storage can't handle "undefined" values
      if (entry === undefined) {
        entry = null;
      }
      await storage.local.set({[entryName]: JSON.stringify(entry)});
    })
  }

  static async getEntry(entryName, defaultVal) {
    let entry = await storage.local.get(entryName);
    if (entry[entryName]) {
      return JSON.parse(entry[entryName])
    } else {
      return defaultVal;
    }
  }

  static deleteEntry(entryName) {
    return storage.local.remove(entryName);
  }

  static async getAllAccounts() {
    let accounts = await AccountStorage.getEntry(`accounts`, {})
    return Object.keys(accounts)
  }

  async getAccountData(key) {
    let accounts = await AccountStorage.getEntry(`accounts`, {})
    let data = accounts[this.accountId]
    if (key) {
      data.password = await Cryptography.decryptAES(key, data.iv, data.password)
    }
    return data
  }

  async setAccountData(data, key) {
    let encData = data
    if (key) {
      if (!data.iv) {
        data.iv = Array.from(Cryptography.getRandomBytes(16))
      }
      encData = {
        ...data,
        password: await Cryptography.encryptAES(key, data.iv, data.password)
      }
    }
    return AccountStorage.changeEntry(
      `accounts`,
      accounts => {
        accounts[this.accountId] = encData
        return accounts
      },
      {}
    )
  }

  async deleteAccountData() {
    await AccountStorage.changeEntry(`accounts`, accounts => {
      delete accounts[this.accountId]
      return accounts
    })
    await this.deleteCache()
    await this.deleteMappings()
  }

  async initCache(data) {
    await AccountStorage.changeEntry(
      `bookmarks[${this.accountId}].cache`,
      () => ({})
    )
  }

  async getCache() {
    const data = await AccountStorage.getEntry(
      `bookmarks[${this.accountId}].cache`
    )
    return Folder.hydrate(data && Object.keys(data).length ? data : {})
  }

  async setCache(data) {
    await AccountStorage.changeEntry(
      `bookmarks[${this.accountId}].cache`,
      () => data
    )
  }

  async deleteCache() {
    await AccountStorage.deleteEntry(`bookmarks[${this.accountId}].cache`)
  }

  async initMappings(data) {
    await AccountStorage.changeEntry(
      `bookmarks[${this.accountId}].mappings`,
      () => ({})
    )
  }

  async getMappings() {
    const data = await AccountStorage.getEntry(
      `bookmarks[${this.accountId}].mappings`
    )
    return new Mappings(
      this,
      data && Object.keys(data).length
        ? data
        : {
            bookmarks: {
              ServerToLocal: {},
              LocalToServer: {}
            },
            folders: {
              ServerToLocal: {},
              LocalToServer: {}
            }
          }
    )
  }

  async setMappings(data) {
    await AccountStorage.changeEntry(
      `bookmarks[${this.accountId}].mappings`,
      () => data
    )
  }

  async deleteMappings() {
    await AccountStorage.deleteEntry(`bookmarks[${this.accountId}].mappings`)
  }
}
