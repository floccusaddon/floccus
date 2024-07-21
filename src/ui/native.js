import './native-public-path'
import Vue from 'vue'
import vuetify from './plugins/vuetify'
import capacitor from './plugins/capacitor'
import App from './NativeApp'
import store from './store/native'
import i18nPlugin from './plugins/i18n'
import { router } from './NativeRouter'
import {i18n} from '../lib/native/I18n'
import '@mdi/font/css/materialdesignicons.css'

Vue.mixin(i18nPlugin)
Vue.mixin(capacitor)

const app = () => {
  i18n.setLocales(navigator.languages)
  i18n.load().then(() => {
    window['floccus'] = global['Floccus'] = new Vue({
      el: '#app',
      router,
      store,
      vuetify,
      render: (h) => h(App),
    })
  })
}

export default app
