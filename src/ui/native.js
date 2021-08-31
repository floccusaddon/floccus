import Vue from 'vue'
import vuetify from './plugins/vuetify'
import App from './NativeApp'

const app = (global['Floccus'] = new Vue({
  el: '#app',
  vuetify,
  render: (h) => h(App),
}))

export default app
