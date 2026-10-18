<template>
  <v-app id="app" :style="{ background }">
    <router-view />
  </v-app>
</template>

<script>
import { version as VERSION } from '../../package.json'
import { actions } from './store/definitions'
import Controller from '../lib/Controller'
import { SystemBars, SystemBarsStyle, SystemBarType } from '@capacitor/core'

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
    },
  },
  async created() {
    if (this.$vuetify.theme.dark) {
      await SystemBars.setStyle({
        style: SystemBarsStyle.Dark,
        bar: SystemBarType.StatusBar,
      })
      await SystemBars.setStyle({
        style: SystemBarsStyle.Dark,
        bar: SystemBarType.NavigationBar,
      })
    } else {
      await SystemBars.setStyle({
        style: SystemBarsStyle.Light,
        bar: SystemBarType.StatusBar,
      })
      await SystemBars.setStyle({
        style: SystemBarsStyle.Light,
        bar: SystemBarType.NavigationBar,
      })
    }
    const controller = await Controller.getSingleton()
    await controller.onLoad()
    setInterval(() => {
      this.$store.dispatch(actions.LOAD_ACCOUNTS)
    }, 5000)
    controller.onStatusChange(() => {
      this.$store.dispatch(actions.LOAD_ACCOUNTS)
    })
  },
}
</script>
<style>
[dir="rtl"] .v-application {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans Arabic", "Cairo", Roboto, Tahoma, sans-serif !important;
}

[dir="rtl"] .v-icon.mdi-arrow-left {
  transform: scaleX(-1);
}

body {
  padding-top: var(--safe-area-inset-top, env(safe-area-inset-top, 0px));
  padding-bottom: var(
    --safe-area-inset-bottom,
    env(safe-area-inset-bottom, 0px)
  );
  padding-left: var(--safe-area-inset-left, env(safe-area-inset-left, 0px));
  padding-right: var(--safe-area-inset-right, env(safe-area-inset-right, 0px));
  background: v-bind(background);
}
@media (prefers-color-scheme: dark) {
  html {
    background-color: #000000;
  }
}
html {
  font-size: 17px !important;
  position: absolute;
  top: 0;
  left: 0;
  bottom: 0;
  right: 0;
  overflow-x: hidden;
  overflow-y: hidden;
}
/* Follow the user's text size setting (Dynamic Type) on iOS; the UI is sized in rem */
@supports (font: -apple-system-body) {
  html {
    font: -apple-system-body !important;
  }
}
.v-navigation-drawer {
  top: var(--safe-area-inset-top, env(safe-area-inset-top)) !important;
  bottom: 0;
}

.native-scroll-container {
  position: absolute;
  top: 0;
  left: 0;
  bottom: 0;
  right: 0;
  overflow-x: hidden;
  overflow-y: hidden;
}

.native-scroll-container .v-app-bar {
  top: var(--safe-area-inset-top, env(safe-area-inset-top)) !important;
}

.native-scroll-container .v-main {
  height: 100%;
  overflow-y: auto;
}
</style>
