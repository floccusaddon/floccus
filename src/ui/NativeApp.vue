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
import Controller from '../lib/Controller'
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
  async created() {
    setInterval(() => {
      this.$store.dispatch(actions.LOAD_ACCOUNTS)
    }, 5000)
    const controller = await Controller.getSingleton()
    controller.onStatusChange(() => {
      this.$store.dispatch(actions.LOAD_ACCOUNTS)
    })
  }
}
</script>
