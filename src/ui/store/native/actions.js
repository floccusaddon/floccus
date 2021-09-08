import Account from '../../../lib/Account'
import { mutations } from './mutations'
import Logger from '../../../lib/Logger'
import AdapterFactory from '../../../lib/AdapterFactory'
import Controller from '../../../lib/Controller'

export const actions = {
  LOAD_ACCOUNTS: 'LOAD_ACCOUNTS',
  SELECT_ACCOUNT: 'SELECT_ACCOUNT',
  LOAD_TREE: 'LOAD_TREE',
  CREATE_BOOKMARK: 'CREATE_BOOKMARK',
  EDIT_BOOKMARK: 'EDIT_BOOKMARK',
  DELETE_BOOKMARK: 'DELETE_BOOKMARK',
  CREATE_FOLDER: 'CREATE_FOLDER',
  EDIT_FOLDER: 'EDIT_FOLDER',
  DELETE_FOLDER: 'DELETE_FOLDER',
  CREATE_ACCOUNT: 'CREATE_ACCOUNT',
  IMPORT_ACCOUNTS: 'IMPORT_ACCOUNTS',
  EXPORT_ACCOUNTS: 'EXPORT_ACCOUNTS',
  DELETE_ACCOUNT: 'DELETE_ACCOUNT',
  RESET_ACCOUNT: 'RESET_ACCOUNT',
  STORE_ACCOUNT: 'STORE_ACCOUNT',
  TRIGGER_SYNC: 'TRIGGER_SYNC',
  TRIGGER_SYNC_UP: 'TRIGGER_SYNC_UP',
  TRIGGER_SYNC_DOWN: 'TRIGGER_SYNC_DOWN',
  CANCEL_SYNC: 'CANCEL_SYNC',
  DOWNLOAD_LOGS: 'DOWNLOAD_LOGS',
}
export const actionsDefinition = {
  async [actions.LOAD_ACCOUNTS]({ commit, dispatch, state }) {
    commit(mutations.LOADING_START, 'accounts')
    const accountsArray = await Account.getAllAccounts()
    const accounts = {}
    await Promise.all(
      accountsArray.map(async(acc) => {
        accounts[acc.id] = {
          data: acc.getData(),
          id: acc.id,
          label: acc.getLabel()
        }
      })
    )
    await commit(mutations.LOAD_ACCOUNTS, accounts)
    commit(mutations.LOADING_END, 'accounts')
  },
  async [actions.LOAD_TREE]({ commit, dispatch, state }, id) {
    const account = await Account.get(id)
    const tree = await account.getResource()
    const rootFolder = await tree.getBookmarksTree(true)
    await commit(mutations.LOAD_TREE, rootFolder)
  },
  async [actions.CREATE_BOOKMARK]() {
    // todo
  },
  async [actions.EDIT_BOOKMARK]() {
    // todo
  },
  async [actions.DELETE_BOOKMARK]() {
    // todo
  },
  async [actions.CREATE_FOLDER]() {
    // todo
  },
  async [actions.EDIT_FOLDER]() {
    // todo
  },
  async [actions.DELETE_FOLDER]() {
    // todo
  },
  async [actions.CREATE_ACCOUNT]({commit, dispatch, state}, type) {
    const account = await Account.create({...AdapterFactory.getDefaultValues(type)})
    await dispatch(actions.LOAD_ACCOUNTS)
    await dispatch(mutations.SELECT_ACCOUNT, account.id)
    return account.id
  },
  async [actions.IMPORT_ACCOUNTS]({commit, dispatch, state}, accounts) {
    await Account.import(accounts)
    await dispatch(actions.LOAD_ACCOUNTS)
  },
  async [actions.EXPORT_ACCOUNTS]({commit, dispatch, state}, accountIds) {
    const data = await Account.export(accountIds)
    const blob = new Blob([JSON.stringify(data, null, '  ')], {
      type: 'text/plain',
      endings: 'native'
    })
    Logger.download('floccus.export.json', blob)
  },
  async [actions.DELETE_ACCOUNT]({commit, dispatch, state}, id) {
    const account = await Account.get(id)
    await account.delete()
    commit(mutations.REMOVE_ACCOUNT, id)
  },
  async [actions.RESET_ACCOUNT]({commit, dispatch, state}, id) {
    const account = await Account.get(id)
    await account.storage.initCache()
    await account.storage.initMappings()
  },
  async [actions.STORE_ACCOUNT]({ commit, dispatch, state }, { id,data }) {
    const account = await Account.get(id)
    await account.setData(data)
    commit(mutations.STORE_ACCOUNT_DATA, {id, data})
  },
  async [actions.TRIGGER_SYNC]({ commit, dispatch, state }, accountId) {
    const controller = await Controller.getSingleton()
    controller.syncAccount(accountId)
  },
  async [actions.TRIGGER_SYNC_DOWN]({ commit, dispatch, state }, accountId) {
    const controller = await Controller.getSingleton()
    await controller.syncAccount(accountId, 'slave')
  },
  async [actions.TRIGGER_SYNC_UP]({ commit, dispatch, state }, accountId) {
    const controller = await Controller.getSingleton()
    await controller.syncAccount(accountId, 'overwrite')
  },
  async [actions.CANCEL_SYNC]({ commit, dispatch, state }, accountId) {
    const controller = await Controller.getSingleton()
    await controller.cancelSync(accountId, true)
  },
  async [actions.DOWNLOAD_LOGS]({ commit, dispatch, state }) {
    await Logger.downloadLogs()
  }
}
