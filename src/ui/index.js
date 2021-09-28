import Vue from 'vue'
import vuetify from './plugins/vuetify'
import capacitor from './plugins/capacitor'
import App from './App'
import { router } from './router'
import store from './store'
import i18nPlugin from './plugins/i18n'
import {i18n} from '../lib/native/I18n'

Vue.mixin(i18nPlugin)
Vue.mixin(capacitor)

i18n.setLocales(navigator.languages)
i18n.load()

const app = (global['Floccus'] = new Vue({
  el: '#app',
  store,
  router,
  vuetify,
  render: (h) => h(App),
}))

export default app
