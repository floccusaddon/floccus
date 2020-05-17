import Account from '../../lib/Account'
import browser from '../../lib/browser-api'
import { mutations } from './mutations'
import Logger from '../../lib/Logger'

export const actions = {
  LOAD_LOCKED: 'LOAD_UNLOCKED',
  UNLOCK: 'UNLOCK',
  SET_KEY: 'SET_KEY',
  UNSET_KEY: 'UNSET_KEY',
  LOAD_ACCOUNTS: 'LOAD_ACCOUNTS',
  CREATE_ACCOUNT: 'CREATE_ACCOUNT',
  DELETE_ACCOUNT: 'DELETE_ACCOUNT',
  RESET_ACCOUNT: 'RESET_ACCOUNT',
  STORE_ACCOUNT: 'STORE_ACCOUNT',
  TRIGGER_SYNC: 'TRIGGER_SYNC',
  CANCEL_SYNC: 'CANCEL_SYNC',
  DOWNLOAD_LOGS: 'DOWNLOAD_LOGS'
}
export const actionsDefinition = {
  async [actions.LOAD_LOCKED]({ commit, dispatch, state }) {
    const background = await browser.runtime.getBackgroundPage()
    commit(mutations.SET_LOCKED, !background.controller.unlocked)
    commit(mutations.SET_SECURED, !!background.controller.key || !background.controller.unlocked)
  },
  async [actions.UNLOCK]({commit, dispatch, state}, key) {
    const background = await browser.runtime.getBackgroundPage()
    try {
      await background.controller.unlock(key)
    } catch (e) {
      console.error(e.message)
      throw e
    }
    commit(mutations.SET_LOCKED, false)
  },
  async [actions.SET_KEY]({commit, dispatch, state}, key) {
    const background = await browser.runtime.getBackgroundPage()
    await background.controller.setKey(key)
  },
  async [actions.UNSET_KEY]({commit, dispatch, state}) {
    const background = await browser.runtime.getBackgroundPage()
    await background.controller.unsetKey()
  },
  async [actions.LOAD_ACCOUNTS]({ commit, dispatch, state }) {
    const accountsArray = await Account.getAllAccounts()
    const accounts = {}
    accountsArray.forEach((acc) => {
      accounts[acc.id] = {
        data: acc.getData(),
        id: acc.id,
        label: acc.getLabel(),
      }
    })
    commit(mutations.LOAD_ACCOUNTS, accounts)
  },
  async [actions.CREATE_ACCOUNT]({commit, dispatch, state}, type) {
    const account = await Account.create(Account.getDefaultValues(type))
    await dispatch(actions.LOAD_ACCOUNTS)
    return account.id
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
    const background = await browser.runtime.getBackgroundPage()
    background.syncAccount(accountId)
  },
  async [actions.CANCEL_SYNC]({ commit, dispatch, state }, accountId) {
    const background = await browser.runtime.getBackgroundPage()
    await background.controller.cancelSync(accountId)
  },
  async [actions.DOWNLOAD_LOGS]({ commit, dispatch, state }) {
    await Logger.downloadLogs()
  },
}
