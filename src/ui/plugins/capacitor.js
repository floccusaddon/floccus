import { Device } from '@capacitor/device'

let deviceInfo
Device.getInfo().then(info => {
  deviceInfo = info
})

export default {
  computed: {
    isBrowser() {
      return deviceInfo.platform === 'web'
    },
  },
}
