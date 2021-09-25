import { Device } from '@capacitor/device'
import { App } from '@capacitor/app'

let deviceInfo = {}
Device.getInfo().then(info => {
  deviceInfo.platform = info.platform
})

let backButtonListener = null

export default {
  computed: {
    isBrowser() {
      return deviceInfo.platform === 'web' || !deviceInfo.platform
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
