import { Device } from '@capacitor/device'

let deviceInfo = {}
Device.getInfo().then(info => {
  deviceInfo.platform = info.platform
})

export default {
  computed: {
    isBrowser() {
      return deviceInfo.platform === 'web' || !deviceInfo.platform
    },
  },
}
