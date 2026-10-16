<template>
  <v-alert
    v-if="!isBrowserSupported"
    type="error">
    {{ 'This browser or WebView is not supported' }}
  </v-alert>
  <v-progress-circular
    v-else
    indeterminate
    color="blue darken-1"
    class="ma-auto" />
</template>

<script>
/* global BROWSERSLIST_REGEX */
import { actions } from '../../store/definitions'
import { routes } from '../../NativeRouter'
import { SplashScreen } from '@capacitor/splash-screen'
import { SendIntent } from '@mindlib-capacitor/send-intent'
import packageJson from '../../../../package.json'
import { Preferences as Storage } from '@capacitor/preferences'

export default {
  name: 'Home',
  computed: {
    isBrowserSupported() {
      return BROWSERSLIST_REGEX.test(navigator.userAgent)
    },
  },
  async created() {
    SplashScreen.hide()
    await this.$store.dispatch(actions.LOAD_ACCOUNTS)
    let intentChecked = false

    const { value: currentVersion } = await Storage.get({
      key: 'currentVersion',
    })
    if (currentVersion && packageJson.version !== currentVersion) {
      await Storage.set({ key: 'currentVersion', value: packageJson.version })

      const packageVersion = packageJson.version.split('.')
      const lastVersion = currentVersion ? currentVersion.split('.') : []
      if (
        packageVersion[0] !== lastVersion[0] ||
        packageVersion[1] !== lastVersion[1]
      ) {
        if (this.$route !== routes.UPDATE) {
          this.$router.push({ name: routes.UPDATE })
        }
      }
    } else if (Object.keys(this.$store.state.accounts).length) {
      intentChecked = true
      const intentReceived = await this.checkForIntent()
      if (!intentReceived) {
        const accountId = Object.keys(this.$store.state.accounts).includes(
          this.$store.state.lastAccount
        )
          ? this.$store.state.lastAccount
          : Object.keys(this.$store.state.accounts)[0]
        this.$router.push({ name: routes.TREE, params: { accountId } })
      }
    } else {
      this.$router.push({ name: routes.NEW_ACCOUNT })
    }

    window.addEventListener('sendIntentReceived', () => this.checkForIntent())
    if (!intentChecked) {
      this.checkForIntent()
    }
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
      // The title is fetched by AddBookmarkIntent once it is open, so an
      // unreachable site doesn't keep us on the spinner
      let url
      if (!result.url) {
        if (!result.additionalItems || !result.additionalItems.length) {
          return false
        }
        result.additionalItems.forEach((share) => {
          if (!share.url) return
          url = share.url
        })
      } else {
        url = this.findUrl(result.url)
      }

      this.$router.push({
        name: routes.ADD_BOOKMARK,
        params: {
          accountId: Object.keys(this.$store.state.accounts).includes(
            this.$store.state.lastAccount
          )
            ? this.$store.state.lastAccount
            : Object.keys(this.$store.state.accounts)[0],
          url,
        },
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
        // noop
      }
      // If not, see whether we can find a URL at the end of this string.
      // This happens e.g. when we share from the Amazon Shopping app.
      const lastWord = url.trim().split(' ').slice(-1)[0]
      try {
        // eslint-disable-next-line no-new
        new URL(lastWord)
        // The last word is a URL - return it
        return lastWord
      } catch (e2) {
        // noop
      }
      const indexOfHttp = url.lastIndexOf('http')
      if (indexOfHttp > 0) {
        const couldBeUrl = url.substring(indexOfHttp)
        try {
          // eslint-disable-next-line no-new
          new URL(couldBeUrl)
          return couldBeUrl
        } catch (e3) {
          // noop
        }
      }
      // We didn't find a valid URL - return our input unchanged
      return url
    },
  },
}
</script>

<style scoped></style>
