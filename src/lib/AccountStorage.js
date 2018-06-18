import browser from './browser-api'
import Cryptography from './Crypto'
import Folder from './Tree'
import AsyncLock from 'async-lock'

const storageLock = new AsyncLock()

export default class AccountStorage {
  constructor(id) {
    this.accountId = id
  }

  static async changeEntry(entryName, fn) {
    await storageLock.acquire(entryName, async () => {
      const d = await browser.storage.local.get({ [entryName]: {} }) // default: {}
      var entry = d[entryName]
      entry = fn(entry)
      await browser.storage.local.set({ [entryName]: entry })
    })
  }

  static getEntry(entryName) {
    return browser.storage.local
      .get({ [entryName]: {} }) // default: {}
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

  deleteAccountData() {
    return AccountStorage.changeEntry(`accounts`, accounts => {
      delete accounts[this.accountId]
      return accounts
    })
  }

  async getCache() {
    const data = await AccountStorage.getEntry(
      `bookmarks[${this.accountId}].cache`
    )
    return Folder.hydrate(data)
  }

  async setCache(data) {
    await AccountStorage.changeEntry(
      `bookmarks[${this.accountId}].cache`,
      () => data
    )
  }

  async getMappings() {
    const data = await AccountStorage.getEntry(
      `bookmarks[${this.accountId}].mappings`
    )
    return new Mappings(
      this,
      data || {
        ServerToLocal: {},
        LocalToServer: {},
        UrlToLocal: {},
        LocalToUrl: {}
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
