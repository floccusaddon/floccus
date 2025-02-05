<template>
  <v-app
    id="app"
    :style="{ background }">
    <router-view />
  </v-app>
</template>

<script>
import { version as VERSION } from '../../package.json'
import { actions } from './store/definitions'
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
      return this.$vuetify.theme.dark ? '#000000' : '#ffffff'
    }
  },
  async created() {
    const controller = await Controller.getSingleton()
    await controller.onLoad()
    setInterval(() => {
      this.$store.dispatch(actions.LOAD_ACCOUNTS)
    }, 5000)
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
  font-size: 0.45cm !important;
}
@media (prefers-color-scheme: dark) {
  html {
    background-color: #000000;
  }
}
html {
  font-size: 0.45cm !important;
}
.v-navigation-drawer {
  top: env(safe-area-inset-top) !important;
  bottom: 0;
}
</style>
