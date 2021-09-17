import {i18n} from '../../lib/native/I18n'

export default {
  methods: {
    t(messageName, substitutions) {
      return i18n.getMessage(messageName, substitutions)
    },
  }
}
