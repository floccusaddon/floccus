import { i18n } from '../../lib/native/I18n'

export function setupDirection(vuetify) {
  const rtl = i18n.isRTL()
  vuetify.framework.rtl = rtl
  if (typeof document !== 'undefined') {
    document.documentElement.dir = rtl ? 'rtl' : 'ltr'
    document.documentElement.lang = i18n.getLocale() || (rtl ? 'ar' : 'en')
  }
}

export default {
  methods: {
    t(messageName, substitutions) {
      return i18n.getMessage(messageName, substitutions)
    },
  },
}
