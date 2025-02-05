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
import packageJson from '../../../../package.json'
import { Preferences as Storage } from '@capacitor/preferences'
import { CapacitorHttp as Http } from '@capacitor/core'
import Logger from '../../../lib/Logger'

export default {
  name: 'Home',
  async created() {
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
      let url, title
      if (!result.url) {
        if (!result.additionalItems || !result.additionalItems.length) {
          return false
        }
        result.additionalItems.forEach(share => {
          if (!share.url) return
          url = share.url
          title = ''
        })
      } else {
        url = this.findUrl(result.url)
        title = ''
      }

      console.log(url)
      try {
        const response = await Http.get({ url,
          headers: {
            'user-agent': 'curl/8.6.0'
          }
        })
        const parser = new DOMParser()
        console.log(response.data)
        const document = parser.parseFromString(response.data, 'text/html')
        const titleElement = document.getElementsByTagName('title')[0]
        if (titleElement) {
          title = titleElement.textContent
        }
      } catch (e) {
        Logger.log('Failed to fetch shared URL')
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
    },
    /**
     * Check that the supplied string is a valid URL. If not, look for a
     * URL at the end of the string, to match the input we see from the
     * Share action in some apps.
     */
    findUrl(url) {
      try {
        // If we can parse this string as a URL, we are done.
        // eslint-disable-next-line no-new
        new URL(url)
        return url
      } catch (e1) {
        // If not, see whether we can find a URL at the end of this string.
        // This happens when we share from the Amazon Shopping app.
        const lastWord = url.trim().split(' ').slice(-1)[0]
        try {
          // eslint-disable-next-line no-new
          new URL(lastWord)
          // The last word is a URL - return it
          return lastWord
        } catch (e2) {
          // We didn't find a valid URL - return our input unchanged
          return url
        }
      }
    }
  }
}
</script>

<style scoped>

</style>
