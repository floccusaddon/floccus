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
  created() {
    setInterval(() => {
      this.$store.dispatch(actions.LOAD_ACCOUNTS)
    }, 5000)
  },
  methods: {
  }
}
</script>
