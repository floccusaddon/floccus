<template>
  <v-app
    id="app"
    :style="appStyle">
    <v-content />
    <v-footer
      color="#3893cc"
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
            <template v-slot:activator="{ on, attrs }">
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
            type="password" />
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
        background: this.$vuetify.theme.dark ? '#000' : '#e1f5fe'
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
