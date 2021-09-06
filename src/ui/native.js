import Vue from 'vue'
import vuetify from './plugins/vuetify'
import capacitor from './plugins/capacitor'
import App from './NativeApp'
import i18nPlugin from './plugins/NativeI18n'
import { router } from './NativeRouter'
import {i18n} from '../lib/native/I18n'

Vue.mixin(i18nPlugin)

const app = (global['Floccus'] = new Vue({
  el: '#app',
  router,
  capacitor,
  vuetify,
  render: (h) => h(App),
}))

i18n.load()

export default app
