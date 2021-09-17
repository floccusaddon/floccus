<template>
  <v-app
    id="app"
    :style="appStyle">
    <router-view />
  </v-app>
</template>

<script>
import { version as VERSION } from '../../package.json'
import { actions } from './store/native'
import {SendIntent} from 'send-intent'
import { routes } from './NativeRouter'
export default {
  name: 'NativeApp',
  data() {
    return {
      VERSION,
      key: '',
      unlockError: null,
    }
  },
  computed: {
    locked() {
      return false
    },
    secured() {
      return false
    },
    appStyle() {
      return {
        background: this.$vuetify.theme.dark ? '#000' : '#fff'
      }
    }
  },
  created() {
    setInterval(() => {
      this.$store.dispatch(actions.LOAD_ACCOUNTS)
    }, 5000)

    window.addEventListener('sendIntentReceived', () => {
      SendIntent.checkSendIntentReceived().then((result) => {
        if (result.text) {
          this.$router.push({
            name: routes.ADD_BOOKMARK,
            params: {
              id: Object.keys(this.$store.state.accounts)[0],
              url: result.text
            }})
        }
      })
    })
  },
  methods: {
  }
}
</script>
