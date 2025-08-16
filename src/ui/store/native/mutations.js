import Vue from 'vue'
import { mutations } from '../definitions'

export const mutationsDefinition = {
  [mutations.SET_LOCKED](state, locked) {
    state.locked = locked
  },
  [mutations.LOAD_ACCOUNTS](state, accounts) {
    state.accounts = accounts
  },
  [mutations.STORE_ACCOUNT_DATA](state, {id, data}) {
    Vue.set(state.accounts[id], 'data', data)
  },
  [mutations.REMOVE_ACCOUNT](state, id) {
    Vue.delete(state.accounts, id)
  },
  [mutations.LOAD_TREE](state, tree) {
    state.tree = tree
  },
  [mutations.SET_LOGIN_FLOW_STATE](state, running) {
    Vue.set(state.loginFlow, 'isRunning', running)
  },
  [mutations.LOADING_START](state, label) {
    Vue.set(state.loading, label, true)
  },
  [mutations.LOADING_END](state, label) {
    Vue.set(state.loading, label, false)
  },
  [mutations.SET_LAST_FOLDER](state, {accountId, folderId}) {
    Vue.set(state.lastFolders, accountId, folderId)
  }
}
