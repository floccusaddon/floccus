import Account from '../../lib/Account'
import browser from '../../lib/browser-api'
import { mutations, actions } from './definitions'
import Logger from '../../lib/Logger'
import BrowserTree from '../../lib/browser/BrowserTree'
import AdapterFactory from '../../lib/AdapterFactory'
import Controller from '../../lib/Controller'
import { Base64 } from 'js-base64'

export const actionsDefinition = {
  async [actions.LOAD_LOCKED]({ commit, dispatch, state }) {
    const controller = await Controller.getSingleton()
    const unlocked = await controller.getUnlocked()
    commit(mutations.SET_LOCKED, !unlocked)
  },
  async [actions.UNLOCK]({commit, dispatch, state}, key) {
    const controller = await Controller.getSingleton()
    try {
      await controller.unlock(key)
    } catch (e) {
      console.error(e.message)
      throw e
    }
    commit(mutations.SET_LOCKED, false)
  },
  async [actions.LOAD_ACCOUNTS]({ commit, dispatch, state }) {
    commit(mutations.LOADING_START, 'accounts')
    const accountsArray = await Account.getAllAccounts()
    const accounts = {}
    await Promise.all(
      accountsArray.map(async(acc) => {
        accounts[acc.id] = {
          data: acc.getData(),
          id: acc.id,
          label: acc.getLabel(),
          fullPath: await BrowserTree.getPathFromLocalId(acc.getData().localRoot)
        }
      })
    )
    await commit(mutations.LOAD_ACCOUNTS, accounts)
    commit(mutations.LOADING_END, 'accounts')
  },
  async [actions.CREATE_ACCOUNT]({commit, dispatch, state}, data) {
    const account = await Account.create({...(await AdapterFactory.getDefaultValues(data.type)), ...data})
    await dispatch(actions.LOAD_ACCOUNTS)
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
    const oldData = account.getData()
    await account.setData(data)
    if (oldData.localRoot !== data.localRoot) {
      await account.init()
    }
    if (oldData.bookmark_file !== data.bookmark_file) {
      await account.init()
    }
    if (oldData.bookmark_file_type !== data.bookmark_file_type) {
      await account.init()
    }
    commit(mutations.STORE_ACCOUNT_DATA, {id, data})
  },
  async [actions.TRIGGER_SYNC]({ commit, dispatch, state }, accountId) {
    const controller = await Controller.getSingleton()
    controller.syncAccount(accountId)
  },
  async [actions.FORCE_SYNC]({ commit, dispatch, state }, accountId) {
    const controller = await Controller.getSingleton()
    controller.syncAccount(accountId, null, true)
  },
  async [actions.TRIGGER_SYNC_ALL]({ commit, dispatch, state }, accountId) {
    const controller = await Controller.getSingleton()
    controller.scheduleAll()
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
  async [actions.DOWNLOAD_LOGS]({ commit, dispatch, state }, anonymous) {
    await Logger.downloadLogs(anonymous)
  },
  async [actions.TEST_WEBDAV_SERVER]({commit, dispatch, state}, {rootUrl, username, password}) {
    await dispatch(actions.REQUEST_NETWORK_PERMISSIONS)
    let res = await fetch(`${rootUrl}`, {
      method: 'PROPFIND',
      credentials: 'omit',
      headers: {
        'User-Agent': 'Floccus bookmarks sync',
        Depth: '0',
        Authorization: 'Basic ' + Base64.encode(
          username + ':' + password
        )
      }
    })
    if (res.status < 200 || res.status > 299) {
      throw new Error('Could not connect to your webdav server at the specified URL. The server responded with HTTP status ' + res.status + ' to a PROPFIND request with Basic Auth on the URL you entered.')
    }
    return true
  },
  async [actions.TEST_NEXTCLOUD_SERVER]({commit, dispatch, state}, rootUrl) {
    await dispatch(actions.REQUEST_NETWORK_PERMISSIONS)
    let res = await fetch(`${rootUrl}/index.php/login/v2`, {method: 'POST', headers: {'User-Agent': 'Floccus bookmarks sync'}})
    if (res.status !== 200) {
      throw new Error(browser.i18n.getMessage('LabelLoginFlowError'))
    }
    return true
  },
  async [actions.TEST_LINKWARDEN_SERVER]({commit, dispatch, state}, {rootUrl, token}) {
    await dispatch(actions.REQUEST_NETWORK_PERMISSIONS)
    let res = await fetch(`${rootUrl}/api/v1/collections`, {
      method: 'GET',
      credentials: 'omit',
      headers: {
        'User-Agent': 'Floccus bookmarks sync',
        Authorization: 'Bearer ' + token,
      }
    })
    if (res.status !== 200) {
      throw new Error(browser.i18n.getMessage('LabelLinkwardenconnectionerror'))
    }
    return true
  },
  async [actions.START_LOGIN_FLOW]({commit, dispatch, state}, rootUrl) {
    commit(mutations.SET_LOGIN_FLOW_STATE, true)
    let res = await fetch(`${rootUrl}/index.php/login/v2`, {method: 'POST', headers: {'User-Agent': 'Floccus bookmarks sync'}})
    if (res.status !== 200 || !state.loginFlow.isRunning) {
      commit(mutations.SET_LOGIN_FLOW_STATE, false)
      throw new Error(browser.i18n.getMessage('LabelLoginFlowError'))
    }
    let json = await res.json()
    const endpoint = json.poll.endpoint
    const token = json.poll.token
    await browser.tabs.create({ url: json.login })
    do {
      await new Promise(resolve => setTimeout(resolve, 1000))
      try {
        res = await fetch(endpoint, {
          method: 'POST',
          body: `token=${token}`,
          headers: {'Content-type': 'application/x-www-form-urlencoded'},
          redirect: 'manual'
        })
      } catch (e) {
        commit(mutations.SET_LOGIN_FLOW_STATE, false)
        throw e
      }
      try {
        json = await res.json()
      } catch (e) {
        res = { status: 404 }
      }
    } while (res.status === 404 && state.loginFlow.isRunning)
    commit(mutations.SET_LOGIN_FLOW_STATE, false)

    if (res.status !== 200) {
      throw new Error(browser.i18n.getMessage('LabelLoginFlowError'))
    }
    return {username: json.loginName, password: json.appPassword}
  },
  async [actions.STOP_LOGIN_FLOW]({commit}) {
    commit(mutations.SET_LOGIN_FLOW_STATE, false)
  },
  async [actions.REQUEST_NETWORK_PERMISSIONS]() {
    try {
      await browser.permissions.request({ origins: ['*://*/*'] })
    } catch (e) {
      console.warn(e)
    }
  },
  async [actions.REQUEST_HISTORY_PERMISSIONS]() {
    try {
      await browser.permissions.request({ permissions: ['history'] })
    } catch (e) {
      console.warn(e)
    }
  },
}
