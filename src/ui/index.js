import Vue from 'vue'
import vuetify from './plugins/vuetify'
import App from './App'
import { router } from './router'
import store from './store'
import i18n from './plugins/i18n'

Vue.mixin(i18n)

const app = (global['Floccus'] = new Vue({
  el: '#app',
  store,
  router,
  vuetify,
  render: (h) => h(App),
}))

export default app
