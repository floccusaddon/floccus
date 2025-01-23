import { Preferences as Storage } from '@capacitor/preferences'
import Cryptography from '../Crypto'
import DefunctCryptography from '../DefunctCrypto'
import Mappings from '../Mappings'
import { Folder, ItemLocation } from '../Tree'
import AsyncLock from 'async-lock'
import Logger from '../Logger'

const storageLock = new AsyncLock()

export default class NativeAccountStorage {
  constructor(id) {
    this.accountId = id
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
        while (typeof entry.value === 'string') {
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
  }

  async initCache() {
    await NativeAccountStorage.changeEntry(
      `bookmarks[${this.accountId}].cache`,
      () => ({})
    )
  }

  async getCache() {
    const data = await NativeAccountStorage.getEntry(
      `bookmarks[${this.accountId}].cache`
    )
    return Folder.hydrate(data && Object.keys(data).length ? data : {location: ItemLocation.LOCAL})
  }

  async setCache(data) {
    await NativeAccountStorage.changeEntry(
      `bookmarks[${this.accountId}].cache`,
      () => data
    )
  }

  async deleteCache() {
    await NativeAccountStorage.deleteEntry(`bookmarks[${this.accountId}].cache`)
  }

  async initMappings() {
    await NativeAccountStorage.changeEntry(
      `bookmarks[${this.accountId}].mappings`,
      () => ({})
    )
  }

  async getMappings() {
    const data = await NativeAccountStorage.getEntry(
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
    await NativeAccountStorage.changeEntry(
      `bookmarks[${this.accountId}].mappings`,
      () => data
    )
  }

  async deleteMappings() {
    await NativeAccountStorage.deleteEntry(`bookmarks[${this.accountId}].mappings`)
  }

  async getCurrentContinuation() {
    return NativeAccountStorage.getEntry(`bookmarks[${this.accountId}].continuation`)
  }

  async setCurrentContinuation(continuation) {
    await NativeAccountStorage.changeEntry(`bookmarks[${this.accountId}].continuation`, (_) => continuation, null)
  }
}
