import Account from '../../../lib/Account'
import { actions, mutations } from '../definitions'
import Logger from '../../../lib/Logger'
import AdapterFactory from '../../../lib/AdapterFactory'
import Controller from '../../../lib/Controller'
import { i18n } from '../../../lib/native/I18n'
import { CapacitorHttp as Http } from '@capacitor/core'
import { Share } from '@capacitor/share'
import Html from '../../../lib/serializers/Html'
import { Bookmark, Folder } from '../../../lib/Tree'
import { Browser } from '@capacitor/browser'

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
  async [actions.LOAD_TREE_FROM_DISK]({ commit, dispatch, state }, id) {
    const account = await Account.get(id)
    if (account.syncing) {
      return
    }
    const tree = await account.getResource()
    const changed = await tree.load()
    const rootFolder = await tree.getBookmarksTree(true)
    await commit(mutations.LOAD_TREE, rootFolder)
    if (changed) {
      await dispatch(actions.TRIGGER_SYNC, id)
    }
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
  async [actions.COUNT_BOOKMARK_CLICK]({state}, {accountId, bookmark}) {
    if (!state.accounts[accountId].data.clickCountEnabled) {
      return
    }
    const account = await Account.get(accountId)
    const tree = await account.getServer()
    if (!tree.countClick) {
      return
    }
    await tree.countClick(bookmark.url)
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
  async [actions.SHARE_BOOKMARK]({commit}, bookmark) {
    await Share.share({
      title: bookmark.title,
      url: bookmark.url,
    })
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
  async [actions.IMPORT_BOOKMARKS]({ commit }, {accountId, parentFolder, html}) {
    const folder = Html.deserialize(html)
    const account = await Account.get(accountId)
    const tree = await account.getResource()
    await Promise.all(folder.children.map(async child => {
      child.parentId = parentFolder
      if (child instanceof Bookmark) {
        await tree.createBookmark(child)
      }
      if (child instanceof Folder) {
        const folderId = await tree.createFolder(child)
        await tree.bulkImportFolder(folderId, child)
      }
    }))
    await tree.save()
    await commit(mutations.LOAD_TREE, await tree.getBookmarksTree(true))
  },
  async [actions.CREATE_ACCOUNT]({commit, dispatch, state}, data) {
    const defaultData = await AdapterFactory.getDefaultValues(data.type)
    const account = await Account.create({...defaultData, ...data})
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
  async [actions.EXPORT_BOOKMARKS]({commit, dispatch, state}, accountId) {
    const account = await Account.get(accountId)
    const tree = await account.localTree.getBookmarksTree()
    const data = Html.serialize(tree)
    const blob = new Blob([data], {
      type: 'text/html',
      endings: 'native'
    })
    Logger.download('floccus-' + new Date().toISOString().slice(0, 10) + '.export.html', blob)
  },
  async [actions.TEST_WEBDAV_SERVER]({commit, dispatch, state}, {rootUrl, username, password}) {
    // noop, because capacitor Http doesn't support PROPFIND
    return true
  },
  async [actions.TEST_LINKWARDEN_SERVER]({commit, dispatch, state}, {rootUrl, token}) {
    let res = await Http.request({
      url: `${rootUrl}/api/v1/collections`,
      method: 'GET',
      headers: {
        'User-Agent': 'Floccus bookmarks sync',
        Authorization: 'Bearer ' + token,
      }
    })
    if (res.status !== 200) {
      throw new Error(i18n.getMessage('LabelLinkwardenconnectionerror'))
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
    let json = res.data
    await Browser.open({ url: json.login, presentationStyle: 'popover' })
    do {
      await new Promise(resolve => setTimeout(resolve, 1000))
      try {
        const data = new URLSearchParams()
        data.set('token', json.poll.token)
        res = await Http.request({
          url: json.poll.endpoint,
          method: 'POST',
          data: data.toString(),
          headers: {'Content-type': 'application/x-www-form-urlencoded'}
        })
      } catch (e) {
        res = { status: 404 }
      }
    } while ((res.status === 404 || !res.data.appPassword) && state.loginFlow.isRunning)
    commit(mutations.SET_LOGIN_FLOW_STATE, false)
    await Browser.close()
    if (res.status !== 200) {
      throw new Error(i18n.getMessage('LabelLoginFlowError'))
    }
    json = res.data
    return {username: json.loginName, password: json.appPassword}
  },
  async [actions.STOP_LOGIN_FLOW]({commit}) {
    commit(mutations.SET_LOGIN_FLOW_STATE, false)
  },
  async [actions.SET_SORTBY]({state}, {accountId, sortBy}) {
    const account = await Account.get(accountId)
    await account.setData({ sortBy })
  }
}
