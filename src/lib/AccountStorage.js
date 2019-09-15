import browser from './browser-api'
import Cryptography from './Crypto'
import Mappings from './Mappings'
import { Folder } from './Tree'
import AsyncLock from 'async-lock'

const storageLock = new AsyncLock()

export default class AccountStorage {
  constructor(id) {
    this.accountId = id
  }

  static async changeEntry(entryName, fn, defaultVal) {
    await storageLock.acquire(entryName, async () => {
      const d = await browser.storage.local.get({
        [entryName]: defaultVal || {} // default: {}
      })
      var entry = d[entryName]
      entry = fn(entry)
      await browser.storage.local.set({ [entryName]: entry })
    })
  }

  static getEntry(entryName, defaultVal) {
    return browser.storage.local
      .get({ [entryName]: defaultVal || {} }) // default: {}
      .then(d => {
        return d[entryName]
      })
  }

  async getAccountData(key) {
    let accounts = await AccountStorage.getEntry(`accounts`)
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
    return AccountStorage.changeEntry(`accounts`, accounts => {
      accounts = accounts || {}
      accounts[this.accountId] = encData
      return accounts
    })
  }

  async deleteAccountData() {
    await AccountStorage.changeEntry(`accounts`, accounts => {
      delete accounts[this.accountId]
      return accounts
    })
    await this.initCache()
    await this.initMappings()
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
    return Folder.hydrate(Object.keys(data).length ? data : {})
  }

  async setCache(data) {
    await AccountStorage.changeEntry(
      `bookmarks[${this.accountId}].cache`,
      () => data
    )
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
      Object.keys(data).length
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
}
