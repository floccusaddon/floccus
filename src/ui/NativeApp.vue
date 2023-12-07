<template>
  <v-app
    id="app"
    :style="{ background }">
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
    background() {
      return this.$vuetify.theme.dark ? '#000' : '#fff'
    }
  },
  async created() {
    setInterval(() => {
      this.$store.dispatch(actions.LOAD_ACCOUNTS)
    }, 5000)
    const controller = await Controller.getSingleton()
    controller.onLoad()
    controller.onStatusChange(() => {
      this.$store.dispatch(actions.LOAD_ACCOUNTS)
    })
  }
}
</script>
<style>
body {
  padding-top: env(safe-area-inset-top);
  padding-bottom: env(safe-area-inset-bottom);
  padding-left: env(safe-area-inset-left);
  padding-right: env(sage-area-inset-right);
  background: v-bind(background);
}
.v-navigation-drawer {
  top: env(safe-area-inset-top) !important;
}
</style>
