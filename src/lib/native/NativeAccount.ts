import NativeAccountStorage from './NativeAccountStorage'
import NativeTree from './NativeTree'
import AdapterFactory from '../AdapterFactory'
import Account from '../Account'
import { IAccountData } from '../interfaces/AccountStorage'
import Controller from '../Controller'

export default class NativeAccount extends Account {
  static async get(id:string):Promise<Account> {
    const storage = new NativeAccountStorage(id)
    const controller = await Controller.getSingleton()
    const data = await storage.getAccountData(controller.key)
    const tree = new NativeTree(storage)
    await tree.load()
    return new NativeAccount(id, storage, AdapterFactory.factory(data), tree)
  }

  static async create(data: IAccountData):Promise<Account> {
    const id = '' + Date.now() + Math.random()
    const adapter = AdapterFactory.factory(data)
    const storage = new NativeAccountStorage(id)

    const controller = await Controller.getSingleton()
    await storage.setAccountData(data, controller.key)
    const tree = new NativeTree(storage)
    await tree.load()
    return new NativeAccount(id, storage, adapter, tree)
  }

  async init():Promise<void> {
    console.log('initializing account ' + this.id)
    await this.storage.initMappings()
    await this.storage.initCache()
    const nativeTree = new NativeTree(this.storage)
    await nativeTree.load()
    this.localTree = nativeTree
  }

  async isInitialized():Promise<boolean> {
    try {
      return Boolean(NativeAccountStorage.getEntry(`bookmarks[${this.storage.accountId}].mappings`))
    } catch (e) {
      console.log('Apparently not initialized, because:', e)
      return false
    }
  }

  async updateFromStorage():Promise<void> {
    const controller = await Controller.getSingleton()
    const data = await this.storage.getAccountData(controller.key)
    this.server.setData(data)
    this.localTree = new NativeTree(this.storage)
  }

  static async getAllAccounts():Promise<Account[]> {
    return Promise.all(
      (await NativeAccountStorage.getAllAccounts()).map((accountId) =>
        NativeAccount.get(accountId)
      )
    )
  }
}
