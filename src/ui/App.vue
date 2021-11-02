<template>
  <v-app
    id="app"
    :style="appStyle">
    <v-content>
      <router-view />
    </v-content>
    <v-footer
      color="blue darken-1"
      app>
      <v-row no-gutters>
        <v-col>
          <v-btn
            text
            x-small
            href="https://floccus.org"
            target="_blank"
            class="white--text">
            floccus v{{ VERSION }}
          </v-btn>
          <v-tooltip top>
            <template #activator="{ on, attrs }">
              <v-btn
                x-small
                text
                class="white--text"
                v-bind="attrs"
                :to="{name: routes.DONATE}"
                target="_blank"
                v-on="on">
                <v-icon>mdi-heart-outline</v-icon>
              </v-btn>
            </template>
            <span>{{ t('LabelFunddevelopment') }}</span>
          </v-tooltip>
        </v-col>
        <v-col class="d-flex flex-row-reverse">
          <v-btn
            v-if="secured"
            text
            x-small
            :to="{name: routes.SET_KEY}"
            target="_blank"
            class="white--text">
            <v-icon>mdi-lock-outline</v-icon>
            {{ t('LabelSecuredcredentials') }}
          </v-btn>
          <v-btn
            v-else
            text
            x-small
            :to="{name: routes.SET_KEY}"
            target="_blank"
            class="white--text">
            <v-icon>mdi-lock-open-outline</v-icon>
            {{ t('LabelSecurecredentials') }}
          </v-btn>
        </v-col>
      </v-row>
    </v-footer>
    <v-dialog
      v-model="locked"
      :max-width="600"
      persistent>
      <v-card>
        <v-card-title><v-icon>mdi-lock-outline</v-icon>{{ t('LabelUnlock') }}</v-card-title>
        <v-card-text>
          <v-alert
            v-if="unlockError"
            outlined
            dense
            :icon="false"
            type="warning">
            {{ unlockError }}
          </v-alert>
          <v-text-field
            v-model="key"
            :label="t('LabelKey')"
            type="password"
            @keyup.enter="onUnlock" />
          <div class="d-flex flex-row-reverse">
            <v-btn
              class="primary"
              @click="onUnlock">
              {{ t('LabelUnlock') }}
            </v-btn>
          </div>
        </v-card-text>
      </v-card>
    </v-dialog>
  </v-app>
</template>

<script>
import { version as VERSION } from '../../package.json'
import { actions } from './store'
import { routes } from './router'
import Controller from '../lib/Controller'
export default {
  name: 'App',
  data() {
    return {
      VERSION,
      key: '',
      unlockError: null,
    }
  },
  computed: {
    locked() {
      return this.$store.state.locked
    },
    secured() {
      return this.$store.state.secured
    },
    routes() {
      return routes
    },
    appStyle() {
      return {
        background: this.$vuetify.theme.dark ? '#000' : '#e1f5fe'
      }
    }
  },
  async created() {
    await Promise.all([
      this.$store.dispatch(actions.LOAD_LOCKED),
      this.$store.dispatch(actions.LOAD_ACCOUNTS)
    ])
    const controller = await Controller.getSingleton()
    const unregister = controller.onStatusChange(() =>
      this.$store.dispatch(actions.LOAD_ACCOUNTS)
    )
    window.addEventListener('beforeunload', unregister)
    window.addEventListener('beforeunload', unregister)
    window.addEventListener('unload', unregister)
    window.addEventListener('close', unregister)
  },
  methods: {
    async onUnlock() {
      try {
        await this.$store.dispatch(actions.UNLOCK, this.key)
      } catch (e) {
        this.unlockError = e.message
        this.key = ''
      }
    }
  }
}
</script>

<style scoped>
#app {
  min-width: 460px;
}
</style>
