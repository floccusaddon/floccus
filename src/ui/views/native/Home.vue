<template>
  <v-progress-circular
    indeterminate
    color="blue darken-1"
    class="ma-auto" />
</template>

<script>
import { actions } from '../../store/definitions'
import { routes } from '../../NativeRouter'
import { SplashScreen } from '@capacitor/splash-screen'
import { SendIntent } from 'send-intent'
import Controller from '../../../lib/Controller'
import packageJson from '../../../../package.json'
import { Preferences as Storage } from '@capacitor/preferences'
import { Http } from '@capacitor-community/http'
import Logger from '../../../lib/Logger'

export default {
  name: 'Home',
  async created() {
    const controller = await Controller.getSingleton()
    await controller.onLoad()
    SplashScreen.hide()
    await this.$store.dispatch(actions.LOAD_ACCOUNTS)

    const {value: currentVersion} = await Storage.get({key: 'currentVersion'})
    if (currentVersion && packageJson.version !== currentVersion) {
      await Storage.set({ key: 'currentVersion', value: packageJson.version })

      const packageVersion = packageJson.version.split('.')
      const lastVersion = currentVersion ? currentVersion.split('.') : []
      if (packageVersion[0] !== lastVersion[0] || packageVersion[1] !== lastVersion[1]) {
        if (this.$route !== routes.UPDATE) {
          this.$router.push({ name: routes.UPDATE })
        }
      }
    } else if (Object.keys(this.$store.state.accounts).length) {
      const intentReceived = await this.checkForIntent()
      if (!intentReceived) {
        const accountId = Object.keys(this.$store.state.accounts)[0]
        this.$router.push({ name: routes.TREE, params: { accountId } })
      }
    } else {
      this.$router.push({name: routes.NEW_ACCOUNT})
    }

    window.addEventListener('sendIntentReceived', () => this.checkForIntent())
  },
  methods: {
    async checkForIntent() {
      let result = {}
      try {
        result = await SendIntent.checkSendIntentReceived()
      } catch (e) {
        console.log(e)
        return false
      }
      if (result.text) {
        console.log(result.text)
        let url, title
        const match = result.text.match(/https?:\/\/\S*/i)
        url = match[0]
        title = result.text.substring(0, match.index) + result.text.substring(match.index + match[0].length)
        title = title.replace('\n', ' ').trim()
        if (!title) {
          try {
            const response = await Http.get({ url })
            const parser = new DOMParser()
            const document = parser.parseFromString(response.data, 'text/html')
            const titleElement = document.getElementsByTagName('title')[0]
            if (titleElement) {
              title = titleElement.textContent
            }
          } catch (e) {
            Logger.log('Failed to fetch shared URL')
          }
        }
        this.$router.push({
          name: routes.ADD_BOOKMARK,
          params: {
            accountId: Object.keys(this.$store.state.accounts)[0],
            url,
            title
          }
        })
        return true
      }
      return false
    }
  }
}
</script>

<style scoped>

</style>
