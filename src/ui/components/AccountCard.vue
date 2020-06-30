<template>
  <v-card
    :loading="Boolean(account.data.syncing)"
    color="light-blue-lighten-5">
    <v-progress-linear
      v-if="account.data.syncing"
      v-slot:progress
      :value="account.data.syncing * 100 || 0"
      :indeterminate="account.data.syncing < 0.1" />
    <v-container class="pa-5">
      <v-row
        no-gutters
        class="flex-column">
        <v-col>
          <v-row no-gutters>
            <v-col class="flex-grow-1">
              <div class="overline">
                {{ account.data.type }}
              </div>
              <div class="headline">
                {{ folderName }}
              </div>
              <div class="caption">
                {{ uri }}
              </div>
            </v-col>
            <v-col
              class="align-end flex-grow-0"
              :style="{minWidth: 'max-content'}">
              <div class="pa-3 d-inline-block font-weight-light body-2">
                <v-icon :color="statusColor">
                  {{ statusIcon }}
                </v-icon>
                <span :style="{color: statusColor}">{{ statusLabel }}</span>
              </div>
            </v-col>
          </v-row>
        </v-col>
        <v-col class="mt-3">
          <v-alert
            dense
            dark
            outlined
            :icon="false"
            :type="statusType">
            {{ statusDetail }} <v-btn
              color="blue"
              class="float-right"
              x-small
              @click="onGetLogs">
              {{ t('LabelDebuglogs') }}
            </v-btn>
          </v-alert>
          <v-alert
            v-if="legacyWarning"
            dense
            outlined
            :type="'warning'">
            {{ legacyWarning }}
          </v-alert>
        </v-col>
        <v-col>
          <v-row
            no-gutters
            class="mt-2">
            <v-col>
              <v-switch
                v-model="account.data.enabled"
                :label="t('LabelEnabled')"
                dense
                class="mt-0 pt-0"
                @change="onToggleEnabled" />
            </v-col>
            <v-col
              class="align-end flex-grow-0"
              :style="{ flexBasis: 'content' }">
              <v-btn
                icon
                small
                :aria-label="t('LabelOptions')"
                :to="{ name: routes.ACCOUNT_OPTIONS, params: { accountId: account.id } }"
                target="_blank">
                <v-icon>mdi-settings</v-icon>
              </v-btn>
              <template v-if="account.data.enabled">
                <v-btn
                  v-if="!account.data.syncing"
                  class="primary"
                  small
                  @click="onTriggerSync">
                  <v-icon>mdi-sync</v-icon>
                  {{ t('LabelSyncnow') }}
                </v-btn>
                <v-btn
                  v-else
                  small
                  @click="onCancelSync">
                  <v-icon>mdi-cancel</v-icon>
                  {{ t('LabelCancelsync') }}
                </v-btn>
              </template>
            </v-col>
          </v-row>
        </v-col>
      </v-row>
    </v-container>
  </v-card>
</template>

<script>
import PathHelper from '../../lib/PathHelper'
import humanizeDuration from 'humanize-duration'
import { actions } from '../store'
import { routes } from '../router'
import LocalTree from '../../lib/LocalTree'

export default {
  name: 'AccountCard',
  props: {
    account: {
      type: Object,
      required: true
    }
  },
  data() {
    return {
      rootPath: '',
      statusColors: {
        disabled: 'rgb(125, 114, 128)',
        ok: '#3d8e39',
        error: '#8e3939',
        syncing: 'blue'
      },
      statusIcons: {
        disabled: 'mdi-sync-off',
        ok: 'mdi-check',
        error: 'mdi-sync-alert',
        syncing: 'mdi-sync'
      },
      statusLabels: {
        disabled: this.t('StatusDisabled'),
        ok: this.t('StatusAllgood'),
        error: this.t('StatusError'),
        syncing: this.t('StatusSyncing')
      }
    }
  },
  computed: {
    folderName() {
      const pathArray = PathHelper.pathToArray(
        this.rootPath || this.t('LabelRootfolder')
      )
      return pathArray[pathArray.length - 1] || this.t('LabelUntitledfolder')
    },
    localRoot() {
      return this.account.data.localRoot
    },
    uri() {
      return this.account.label
    },
    status() {
      if (this.account.data.syncing) {
        return 'syncing'
      }
      if (this.account.data.error) {
        return 'error'
      }
      if (!this.account.data.enabled) {
        return 'disabled'
      }
      return 'ok'
    },
    statusIcon() {
      return this.statusIcons[this.status]
    },
    statusColor() {
      return this.statusColors[this.status]
    },
    statusLabel() {
      return this.statusLabels[this.status]
    },
    statusType() {
      if (this.account.data.error) {
        return 'error'
      }
      return 'info'
    },
    statusDetail() {
      if (this.account.data.error) {
        return this.account.data.error
      }
      if (this.account.data.syncing) {
        return 'Synchronization in progress.'
      }
      if (this.account.data.lastSync) {
        return this.t(
          'StatusLastsynced',
          humanizeDuration(Date.now() - this.account.data.lastSync, {
            largest: 1,
            round: true
          })
        )
      }
      return this.t('StatusNeversynced')
    },
    legacyWarning() {
      if (this.account.data.type === 'nextcloud' ||
          this.account.data.type === 'nextcloud-legacy') {
        return this.t('LegacyAdapterDeprecation')
      }
      return null
    },
    routes() {
      return routes
    }
  },
  watch: {
    async localRoot(localRoot) {
      this.rootPath = await LocalTree.getPathFromLocalId(localRoot)
    }
  },
  async created() {
    this.rootPath = await LocalTree.getPathFromLocalId(this.localRoot)
  },
  methods: {
    onTriggerSync() {
      this.$store.dispatch(actions.TRIGGER_SYNC, this.account.id)
    },
    onCancelSync() {
      this.$store.dispatch(actions.CANCEL_SYNC, this.account.id)
    },
    onToggleEnabled() {
      this.$store.dispatch(actions.STORE_ACCOUNT, {id: this.account.id, data: this.account.data})
    },
    onGetLogs() {
      this.$store.dispatch(actions.DOWNLOAD_LOGS)
    }
  }
}
</script>

<style scoped></style>
