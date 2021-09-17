import Vue from 'vue'
import vuetify from './plugins/vuetify'
import capacitor from './plugins/capacitor'
import App from './NativeApp'
import store from './store/native'
import i18nPlugin from './plugins/NativeI18n'
import { router } from './NativeRouter'
import {i18n} from '../lib/native/I18n'

Vue.mixin(i18nPlugin)
Vue.mixin(capacitor)

const app = (global['Floccus'] = new Vue({
  el: '#app',
  router,
  store,
  vuetify,
  render: (h) => h(App),
}))

i18n.load()

export default app
