import browser from '../../lib/browser-api'

export default {
  methods: {
    t(messageName, substitutions) {
      return browser.i18n.getMessage(messageName, substitutions)
    },
  },
}
