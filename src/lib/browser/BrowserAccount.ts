import BrowserAccountStorage from './BrowserAccountStorage'
import BrowserTree from './BrowserTree'
import browser from '../browser-api'
import AdapterFactory from '../AdapterFactory'
import Account from '../Account'
import {
  CreateBookmarkError,
  FailsafeError, FloccusError,
  HttpError,
  InconsistentBookmarksExistenceError, LockFileError,
  MissingItemOrderError,
  ParseResponseError,
  UnknownFolderItemOrderError, UpdateBookmarkError
} from '../../errors/Error'
import {i18n} from '../native/I18n'
import { OrderFolderResource } from '../interfaces/Resource'
import { ItemLocation } from '../Tree'

export default class BrowserAccount extends Account {
  static async get(id:string):Promise<Account> {
    const storage = new BrowserAccountStorage(id)
    const data = await storage.getAccountData(null)
    const tree = new BrowserTree(storage, data.localRoot)
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    return new BrowserAccount(id, storage, await AdapterFactory.factory(data), tree)
  }

  static async create(data):Promise<Account> {
    const id = '' + Date.now() + Math.random()
    const adapter = await AdapterFactory.factory(data)
    const storage = new BrowserAccountStorage(id)

    await storage.setAccountData(data, null)
    const tree = new BrowserTree(storage, data.localRoot)
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    return new BrowserAccount(id, storage, adapter, tree)
  }

  async init():Promise<void> {
    console.log('initializing account ' + this.id)
    const accData = this.getData()
    if (!(await this.isInitialized()) && accData.localRoot !== 'tabs') {
      const parentNode = await browser.bookmarks.getTree()
      const bookmarksBar = parentNode[0].children[0]
      const node = await browser.bookmarks.create({
        title: 'Floccus (' + this.getLabel() + ')',
        parentId: bookmarksBar.id,
      })
      accData.localRoot = node.id
      accData.rootPath = await BrowserTree.getPathFromLocalId(node.id)
      await this.setData(accData)
    }
    await this.storage.initMappings()
    await this.storage.initCache()
    this.localTree = new BrowserTree(this.storage, accData.localRoot)
  }

  async isInitialized():Promise<boolean> {
    try {
      const localRoot = this.getData().localRoot
      if (localRoot === 'tabs') {
        return true
      }
      await browser.bookmarks.getSubTree(localRoot)
      return true
    } catch (e) {
      console.log('Apparently not initialized, because:', e)
      return false
    }
  }

  async getResource():Promise<OrderFolderResource<typeof ItemLocation.LOCAL>> {
    if (this.getData().localRoot !== 'tabs') {
      return this.localTree
    } else {
      const LocalTabs = (await import('../LocalTabs')).default
      this.localTabs = new LocalTabs(this.storage)
      return this.localTabs
    }
  }

  async updateFromStorage():Promise<void> {
    const data = await this.storage.getAccountData(null)
    this.server.setData(data)
    this.localTree = new BrowserTree(this.storage, data.localRoot)
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
      if (er.list[0].code === 26) {
        // Do not spam log with E026 (cancelled sync)
        return this.stringifyError(er.list[0])
      }
      return (await Promise.all(er.list
        .map((e) => {
          return this.stringifyError(e)
        })))
        .join('\n')
    }
    return er.message
  }

  static async getAllAccounts():Promise<Account[]> {
    return Promise.all(
      (await BrowserAccountStorage.getAllAccounts()).map((accountId) =>
        Account.get(accountId)
      )
    )
  }

  static async getAccountsContainingLocalId(localId:string, ancestors:string[], allAccounts:Account[], withDisallowNested = false):Promise<Account[]> {
    ancestors = ancestors || (await BrowserTree.getIdPathFromLocalId(localId))
    allAccounts = allAccounts || (await this.getAllAccounts())

    const accountsInvolved = allAccounts
      .filter(acc => ancestors.includes(acc.getData().localRoot))
      .sort((a, b) =>
        ancestors.indexOf(a.getData().localRoot) - ancestors.indexOf(b.getData().localRoot)
      )
      .reverse()

    if (!withDisallowNested) {
      const lastNesterIdx = accountsInvolved.findIndex(acc => !acc.getData().nestedSync)
      return accountsInvolved.slice(0, Math.max(1, lastNesterIdx))
    } else {
      return accountsInvolved
    }
  }
}
