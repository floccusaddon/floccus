import Account from '../../../lib/Account'
import { actions, mutations } from '../definitions'
import Logger from '../../../lib/Logger'
import AdapterFactory from '../../../lib/AdapterFactory'
import Controller from '../../../lib/Controller'
import { i18n } from '../../../lib/native/I18n'
import { Share } from '@capacitor/share'
import { Http } from '@capacitor-community/http'
import { Base64 } from 'js-base64'

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
  async [actions.CREATE_BOOKMARK]({commit}, {accountId, bookmark}) {
    const account = await Account.get(accountId)
    const tree = await account.getResource()
    await tree.createBookmark(bookmark)
    await tree.save()
    await commit(mutations.LOAD_TREE, await tree.getBookmarksTree(true))
    const controller = await Controller.getSingleton()
    controller.scheduleSync(accountId, true)
  },
  async [actions.EDIT_BOOKMARK]({commit}, {accountId, bookmark}) {
    const account = await Account.get(accountId)
    const tree = await account.getResource()
    await tree.updateBookmark(bookmark)
    await tree.save()
    await commit(mutations.LOAD_TREE, await tree.getBookmarksTree(true))
  },
  async [actions.DELETE_BOOKMARK]({commit}, {accountId, bookmark}) {
    const account = await Account.get(accountId)
    const tree = await account.getResource()
    await tree.removeBookmark(bookmark)
    await tree.save()
    await commit(mutations.LOAD_TREE, await tree.getBookmarksTree(true))
    const controller = await Controller.getSingleton()
    controller.scheduleSync(accountId, true)
  },
  async [actions.CREATE_FOLDER]({commit}, {accountId, folder}) {
    const account = await Account.get(accountId)
    const tree = await account.getResource()
    await tree.createFolder(folder)
    await tree.save()
    await commit(mutations.LOAD_TREE, await tree.getBookmarksTree(true))
    const controller = await Controller.getSingleton()
    controller.scheduleSync(accountId, true)
  },
  async [actions.EDIT_FOLDER]({commit}, {accountId, folder}) {
    const account = await Account.get(accountId)
    const tree = await account.getResource()
    await tree.updateFolder(folder)
    await tree.save()
    await commit(mutations.LOAD_TREE, await tree.getBookmarksTree(true))
    const controller = await Controller.getSingleton()
    controller.scheduleSync(accountId, true)
  },
  async [actions.DELETE_FOLDER]({commit}, {accountId, folder}) {
    const account = await Account.get(accountId)
    const tree = await account.getResource()
    await tree.removeFolder(folder)
    await tree.save()
    await commit(mutations.LOAD_TREE, await tree.getBookmarksTree(true))
    const controller = await Controller.getSingleton()
    controller.scheduleSync(accountId, true)
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
    await Share.share({
      title: 'floccus.export.json',
      text: await blob.text(),
      dialogTitle: 'Share Exported Floccus accounts',
    })
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
  async [actions.DOWNLOAD_LOGS]({ commit, dispatch, state }, anonymous) {
    await Logger.downloadLogs(anonymous)
  },
  async [actions.TEST_WEBDAV_SERVER]({commit, dispatch, state}, {rootUrl, username, password}) {
    let res = await Http.request({
      url: `${rootUrl}`,
      method: 'PROPFIND',
      headers: {
        'User-Agent': 'Floccus bookmarks sync',
        Deptch: '0',
        Authorization: 'Basic ' + Base64.encode(
          username + ':' + password
        )
      }
    })
    if (res.status < 200 || res.status > 299) {
      throw new Error('Could not connect to server: ' + res.status)
    }
    return true
  },
  async [actions.TEST_NEXTCLOUD_SERVER]({commit, dispatch, state}, rootUrl) {
    let res = await Http.request({
      url: `${rootUrl}/index.php/login/v2`,
      method: 'POST',
      headers: {'User-Agent': 'Floccus bookmarks sync'}
    })
    if (res.status !== 200) {
      throw new Error(i18n.getMessage('LabelLoginFlowError'))
    }
    return true
  },
  async [actions.START_LOGIN_FLOW]({commit, dispatch, state}, rootUrl) {
    commit(mutations.SET_LOGIN_FLOW_STATE, true)
    let res = await Http.request({
      url: `${rootUrl}/index.php/login/v2`,
      method: 'POST',
      headers: {'User-Agent': 'Floccus bookmarks sync'}
    })
    if (res.status !== 200 || !state.loginFlow.isRunning) {
      commit(mutations.SET_LOGIN_FLOW_STATE, false)
      throw new Error(i18n.getMessage('LabelLoginFlowError'))
    }
    let json = res.data, browserWindow
    try {
      browserWindow = await window.open(json.login)
      do {
        await new Promise(resolve => setTimeout(resolve, 1000))
        res = await Http.request({
          url: json.poll.endpoint,
          method: 'POST',
          data: {token: json.poll.token},
          headers: {'Content-type': 'application/x-www-form-urlencoded'}
        })
      } while (res.status === 404 && state.loginFlow.isRunning)
      commit(mutations.SET_LOGIN_FLOW_STATE, false)
    } catch (e) {
      commit(mutations.SET_LOGIN_FLOW_STATE, false)
      throw e
    }
    if (res.status !== 200) {
      throw new Error(i18n.getMessage('LabelLoginFlowError'))
    }
    browserWindow.close()
    json = res.data
    return {username: json.loginName, password: json.appPassword}
  },
  async [actions.STOP_LOGIN_FLOW]({commit}) {
    commit(mutations.SET_LOGIN_FLOW_STATE, false)
  }
}
