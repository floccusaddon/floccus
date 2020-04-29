import Vue from 'vue'

export const mutations = {
  SET_LOCKED: 'SET_LOCKED',
  SET_SECURED: 'SET_SECURED',
  LOAD_ACCOUNTS: 'LOAD_ACCOUNTS',
  STORE_ACCOUNT_DATA: 'STORE_ACCOUNT_DATA',
  REMOVE_ACCOUNT: 'REMOVE_ACCOUNT',
}
export const mutationsDefinition = {
  [mutations.SET_LOCKED](state, locked) {
    state.locked = locked
  },
  [mutations.SET_SECURED](state, secured) {
    state.secured = secured
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
}
