import Vue from 'nativescript-vue'
import App from './App'

// Vue.config.debug = true
// Vue.config.silent = false
new Vue({
  render: (h) => h('frame', [h(App)]),
}).$start()
