import NativeAccountStorage from './NativeAccountStorage'
import NativeTree from './NativeTree'
import AdapterFactory from '../AdapterFactory'
import Account from '../Account'
import { IAccountData } from '../interfaces/AccountStorage'
import Controller from '../Controller'
import {
  FailsafeError, FloccusError,
  HttpError,
  InconsistentBookmarksExistenceError, LockFileError,
  MissingItemOrderError,
  ParseResponseError,
  UnknownFolderItemOrderError
} from '../../errors/Error'
import Logger from '../Logger'
import { i18n } from './I18n'

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
    // empty
  }

  static async stringifyError(er:any):Promise<string> {
    if (er instanceof UnknownFolderItemOrderError) {
      return i18n.getMessage('Error' + String(er.code).padStart(3, '0'), [er.item])
    }
    if (er instanceof MissingItemOrderError) {
      return i18n.getMessage('Error' + String(er.code).padStart(3, '0'), [er.item])
    }
    if (er instanceof HttpError) {
      return i18n.getMessage('Error' + String(er.code).padStart(3, '0'), [er.status, er.method])
    }
    if (er instanceof ParseResponseError) {
      return i18n.getMessage('Error' + String(er.code).padStart(3, '0')) + '\n' + er.response
    }
    if (er instanceof InconsistentBookmarksExistenceError) {
      return i18n.getMessage('Error' + String(er.code).padStart(3, '0'), [er.folder, er.bookmark])
    }
    if (er instanceof LockFileError) {
      return i18n.getMessage('Error' + String(er.code).padStart(3, '0'), [er.status, er.lockFile])
    }
    if (er instanceof FailsafeError) {
      return i18n.getMessage('Error' + String(er.code).padStart(3, '0'), [er.percent])
    }
    if (er instanceof FloccusError) {
      return i18n.getMessage('Error' + String(er.code).padStart(3, '0'))
    }
    if (er.list) {
      return (await Promise.all(er.list
        .map((e) => {
          Logger.log(e)
          return this.stringifyError(e)
        })))
        .join('\n')
    }
    return er.message
  }

  static async getAllAccounts():Promise<Account[]> {
    return Promise.all(
      (await NativeAccountStorage.getAllAccounts()).map((accountId) =>
        NativeAccount.get(accountId)
      )
    )
  }
}
