import I18n from '../../lib/native/I18n'

export const i18n = new I18n('en')

export default {
  methods: {
    t(messageName, substitutions) {
      return i18n.getMessage(messageName, substitutions)
    },
  }
}
