import Vue from 'vue'
import vuetify from './plugins/vuetify'
import App from './NativeApp'
import i18nPlugin, {i18n} from './plugins/NativeI18n'
import { router } from './NativeRouter'

Vue.mixin(i18nPlugin)

const app = (global['Floccus'] = new Vue({
  el: '#app',
  router,
  vuetify,
  render: (h) => h(App),
}))

i18n.load()

export default app
