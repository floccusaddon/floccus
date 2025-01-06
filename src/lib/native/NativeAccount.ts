import NativeAccountStorage from './NativeAccountStorage'
import NativeTree from './NativeTree'
import AdapterFactory from '../AdapterFactory'
import Account from '../Account'
import { IAccountData } from '../interfaces/AccountStorage'
import {
  CreateBookmarkError,
  FailsafeError, FloccusError,
  HttpError,
  InconsistentBookmarksExistenceError, LockFileError,
  MissingItemOrderError,
  ParseResponseError,
  UnknownFolderItemOrderError, UpdateBookmarkError
} from '../../errors/Error'
import Logger from '../Logger'
import { i18n } from './I18n'

export default class NativeAccount extends Account {
  static async get(id:string):Promise<Account> {
    const storage = new NativeAccountStorage(id)
    const data = await storage.getAccountData(null)
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    const tree = new NativeTree(storage)
    await tree.load()
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    return new NativeAccount(id, storage, await AdapterFactory.factory(data), tree)
  }

  static async create(data: IAccountData):Promise<Account> {
    const id = '' + Date.now() + Math.random()
    const adapter = await AdapterFactory.factory(data)
    const storage = new NativeAccountStorage(id)

    await storage.setAccountData(data, null)
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    const tree = new NativeTree(storage)
    await tree.load()
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
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
    if (er instanceof CreateBookmarkError) {
      return i18n.getMessage('Error' + String(er.code).padStart(3, '0'), [er.bookmark.inspect()])
    }
    if (er instanceof UpdateBookmarkError) {
      return i18n.getMessage('Error' + String(er.code).padStart(3, '0'), [er.bookmark.inspect()])
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
        Account.get(accountId)
      )
    )
  }
}
