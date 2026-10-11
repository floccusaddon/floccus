import Vue from 'vue'
import Vuetify from 'vuetify/lib'
import 'vuetify/dist/vuetify.min.css'

Vue.use(Vuetify)

const rtlLocales = ['ar', 'fa', 'he', 'ur', 'dv', 'ps', 'sd', 'ug', 'yi']
const isRTL = rtlLocales.some((lang) =>
  (navigator.language || '').toLowerCase().startsWith(lang) ||
  (navigator.languages || []).some((l) => l.toLowerCase().startsWith(lang))
)

const opts = {
  rtl: isRTL,
  theme: {
    dark: Boolean(window.matchMedia('(prefers-color-scheme: dark)').matches)
  }
}

export default new Vuetify(opts)
