import Vue from 'vue'
import Vuex, { Store } from 'vuex'
import { mutationsDefinition } from './mutations'
import { actionsDefinition } from './actions'

Vue.use(Vuex)

export { mutations } from './mutations'
export { actions } from './actions'

export default new Store({
  mutations: mutationsDefinition,
  actions: actionsDefinition,
  state: {
    locked: false,
    secured: false,
    accounts: {},
  },
  getters: {},
})
