<template>
  <v-app
    id="app"
    :style="appStyle">
    <router-view />
  </v-app>
</template>

<script>
import { version as VERSION } from '../../package.json'
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
    routes() {
      return {}
    },
    appStyle() {
      return {
        background: this.$vuetify.theme.dark ? '#000' : '#fff'
      }
    }
  },
  methods: {
  }
}
</script>

<style scoped>
#app {
  min-width: 460px;
}
</style>
