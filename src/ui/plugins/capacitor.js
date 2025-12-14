/* global IS_BROWSER */
import { App } from '@capacitor/app'

let backButtonListener = null

export default {
  computed: {
    isBrowser() {
      return IS_BROWSER
    },
  },
  mounted() {
    if (this.$options.backButton) {
      if (backButtonListener) {
        backButtonListener.remove()
      }
      backButtonListener = App.addListener('backButton', () => this.$options.backButton.call(this))
    }
  }
}
