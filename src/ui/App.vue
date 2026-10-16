<template>
  <v-app
    id="app"
    :style="appStyle">
    <v-banner
      v-if="isBrowser"
      color="primary"
      class="mb-1 white--text"
      single-line>
      {{ t('DescriptionDonateintervention') }}
      <template #actions>
        <v-btn
          small
          target="_blank"
          href="https://floccus.org/donate/">
          {{ t('LabelDonate') }}
        </v-btn>
      </template>
    </v-banner>
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
                :aria-label="t('LabelFunddevelopment')"
                :to="{ name: routes.DONATE }"
                target="_blank"
                v-on="on">
                <v-icon aria-hidden="true">
                  mdi-heart-outline
                </v-icon>
              </v-btn>
            </template>
            <span>{{ t('LabelFunddevelopment') }}</span>
          </v-tooltip>
          <v-tooltip top>
            <template #activator="{ on, attrs }">
              <v-btn
                x-small
                text
                class="white--text"
                v-bind="attrs"
                :aria-label="t('LabelOpeninnewtab')"
                target="_blank"
                @click="openInNewTab"
                v-on="on">
                <v-icon aria-hidden="true">
                  mdi-open-in-new
                </v-icon>
              </v-btn>
            </template>
            <span>{{ t('LabelOpeninnewtab') }}</span>
          </v-tooltip>
        </v-col>
      </v-row>
    </v-footer>
    <v-dialog
      v-model="locked"
      :max-width="600"
      persistent>
      <v-card>
        <v-card-title>
          <v-icon aria-hidden="true">
            mdi-lock-outline
          </v-icon>{{ t('LabelUnlock') }}
        </v-card-title>
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
import { actions } from './store/definitions'
import { routes } from './router'
import Controller from '../lib/Controller'
import browser from '../lib/browser-api'
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
    routes() {
      return routes
    },
    appStyle() {
      return {
        background: this.$vuetify.theme.dark ? '#000' : '#e1f5fe',
      }
    },
  },
  async created() {
    if (window.KAGI) {
      browser.storage.local.set({ isOrion: true })
    }

    await Promise.all([
      this.$store.dispatch(actions.LOAD_LOCKED),
      this.$store.dispatch(actions.LOAD_ACCOUNTS),
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
    },
    openInNewTab() {
      browser.tabs.create({ url: window.location.href })
    },
  },
}
</script>

<style>
/*
 * Extension popups are sized to their content, so the body needs a min-width
 * or the popup collapses. Apply it by default and only lift it on small touch
 * screens (mobile browsers open the popup as a full-width page): some desktop
 * browsers (e.g. Samsung Internet on Windows) don't match device-width queries
 * in popups, so the min-width must not depend on one matching.
 */
body {
  min-width: 420px;
}

@media screen and (pointer: coarse) and (max-device-width: 419px) {
  body {
    min-width: 0;
  }
}
</style>
