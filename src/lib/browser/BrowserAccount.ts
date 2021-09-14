import BrowserAccountStorage from './BrowserAccountStorage'
import BrowserTree from './BrowserTree'
import browser from '../browser-api'
import AdapterFactory from '../AdapterFactory'
import Account from '../Account'
import {
  FailsafeError, FloccusError,
  HttpError,
  InconsistentBookmarksExistenceError, LockFileError,
  MissingItemOrderError,
  ParseResponseError,
  UnknownFolderItemOrderError
} from '../../errors/Error'
import Logger from '../Logger'

export default class BrowserAccount extends Account {
  static async get(id:string):Promise<Account> {
    const storage = new BrowserAccountStorage(id)
    const background = await browser.runtime.getBackgroundPage()
    const data = await storage.getAccountData(background.controller.key)
    const tree = new BrowserTree(storage, data.localRoot)
    return new BrowserAccount(id, storage, AdapterFactory.factory(data), tree)
  }

  static async create(data):Promise<Account> {
    const id = '' + Date.now() + Math.random()
    const adapter = AdapterFactory.factory(data)
    const storage = new BrowserAccountStorage(id)

    const background = await browser.runtime.getBackgroundPage()
    await storage.setAccountData(data, background.controller.key)
    const tree = new BrowserTree(storage, data.localRoot)
    return new BrowserAccount(id, storage, adapter, tree)
  }

  async init():Promise<void> {
    console.log('initializing account ' + this.id)
    const accData = this.getData()
    if (!(await this.isInitialized())) {
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
      await browser.bookmarks.getSubTree(localRoot)
      return true
    } catch (e) {
      console.log('Apparently not initialized, because:', e)
      return false
    }
  }

  async updateFromStorage():Promise<void> {
    const background = await browser.runtime.getBackgroundPage()
    const data = await this.storage.getAccountData(background.controller.key)
    this.server.setData(data)
    this.localTree = new BrowserTree(this.storage, data.localRoot)
  }

  static async stringifyError(er:any):Promise<string> {
    if (er instanceof UnknownFolderItemOrderError) {
      return browser.i18n.getMessage('Error' + String(er.code).padStart(3, '0'), [er.item])
    }
    if (er instanceof MissingItemOrderError) {
      return browser.i18n.getMessage('Error' + String(er.code).padStart(3, '0'), [er.item])
    }
    if (er instanceof HttpError) {
      return browser.i18n.getMessage('Error' + String(er.code).padStart(3, '0'), [er.status, er.method])
    }
    if (er instanceof ParseResponseError) {
      return browser.i18n.getMessage('Error' + String(er.code).padStart(3, '0')) + '\n' + er.response
    }
    if (er instanceof InconsistentBookmarksExistenceError) {
      return browser.i18n.getMessage('Error' + String(er.code).padStart(3, '0'), [er.folder, er.bookmark])
    }
    if (er instanceof LockFileError) {
      return browser.i18n.getMessage('Error' + String(er.code).padStart(3, '0'), [er.status, er.lockFile])
    }
    if (er instanceof FailsafeError) {
      return browser.i18n.getMessage('Error' + String(er.code).padStart(3, '0'), [er.percent])
    }
    if (er instanceof FloccusError) {
      return browser.i18n.getMessage('Error' + String(er.code).padStart(3, '0'))
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
      (await BrowserAccountStorage.getAllAccounts()).map((accountId) =>
        BrowserAccount.get(accountId)
      )
    )
  }

  static async getAccountsContainingLocalId(localId:string, ancestors:string[], allAccounts:Account[]):Promise<Account[]> {
    ancestors = ancestors || (await BrowserTree.getIdPathFromLocalId(localId))
    allAccounts = allAccounts || (await this.getAllAccounts())

    const accountsInvolved = allAccounts
      .filter(acc => ancestors.indexOf(acc.getData().localRoot) !== -1)
      .reverse()

    const lastNesterIdx = accountsInvolved.findIndex(acc => !acc.getData().nestedSync)
    return accountsInvolved.slice(0, lastNesterIdx)
  }
}
