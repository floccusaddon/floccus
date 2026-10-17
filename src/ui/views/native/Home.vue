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
import { extractSharedUrls } from '../../../lib/SharedUrls'

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
      const urls = [...new Set(
        [result, ...(result.additionalItems || [])]
          .flatMap((share) => extractSharedUrls(share && share.url))
      )]
      if (!urls.length) {
        return false
      }

      this.$router.push({
        name: routes.ADD_BOOKMARK,
        params: {
          accountId: Object.keys(this.$store.state.accounts).includes(
            this.$store.state.lastAccount
          )
            ? this.$store.state.lastAccount
            : Object.keys(this.$store.state.accounts)[0],
          url: urls[0],
        },
        // Several tabs shared at once are bookmarked together
        ...(urls.length > 1 && { query: { urls } }),
      })
      return true
    },
  },
}
</script>

<style scoped></style>
