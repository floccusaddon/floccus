import { Capacitor } from '@capacitor/core'
import { App } from '@capacitor/app'

let backButtonListener = null

export default {
  computed: {
    isBrowser() {
      return Capacitor.getPlatform() === 'web' || !Capacitor.getPlatform()
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
