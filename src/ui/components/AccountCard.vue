<template>
  <v-card
    :loading="Boolean(account.data.syncing)"
    color="light-blue-lighten-5">
    <template #progress>
      <v-progress-linear
        v-if="account.data.syncing"
        :value="account.data.syncing * 100 || 0" />
    </template>
    <v-container class="pa-4">
      <v-row
        no-gutters
        class="flex-column">
        <v-col>
          <v-row
            no-gutters
            class="account-card__header">
            <v-col class="flex-grow-1">
              <div class="overline">
                {{ account.data.type }}
              </div>
              <div
                class="text-h6"
                role="heading"
                aria-level="2">
                <v-icon
                  v-if="account.data.localRoot === 'tabs'"
                  color="primary"
                  aria-hidden="true">
                  mdi-tab
                </v-icon>
                <v-icon
                  v-else
                  color="primary"
                  aria-hidden="true">
                  mdi-folder
                </v-icon>
                {{ folderName }}
              </div>
              <div class="caption">
                {{ uri }}
              </div>
            </v-col>
            <v-col class="align-end flex-grow-0 account-card__statusColumn">
              <div class="pa-3 d-inline-block font-weight-light body-2">
                <v-icon
                  :color="statusColor"
                  :class="{ spinning: account.data.syncing }"
                  aria-hidden="true">
                  {{ statusIcon }}
                </v-icon>
                <span :style="{ color: statusColor }">{{ statusLabel }}</span>
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
            :type="statusType"
            class="pa-2 text-caption">
            {{ statusDetail }}
            <template v-if="account.data.error">
              <v-btn
                :color="statusType"
                class="float-right ml-1 mt-1"
                x-small
                target="_blank"
                href="https://github.com/floccusaddon/floccus/issues">
                {{ t('LabelReportproblem') }}
              </v-btn>
              <v-btn
                :color="statusType"
                class="float-right ml-1 mt-1"
                x-small
                target="_blank"
                href="https://floccus.org/faq/">
                {{ t('LabelFaq') }}
              </v-btn>
              <v-btn
                :color="statusType"
                class="float-right ml-1 mt-1"
                x-small
                @click="onGetLogs">
                {{ t('LabelDebuglogs') }}
              </v-btn>
            </template>
            <template v-if="status === 'scheduled'">
              <v-btn
                :color="statusType"
                class="float-right"
                x-small
                @click="onForceSync">
                {{ t('LabelScheduledforcesync') }}
              </v-btn>
            </template>
          </v-alert>
          <v-alert
            v-if="legacyWarning"
            dense
            outlined
            :type="'warning'">
            {{ legacyWarning }}
          </v-alert>
          <v-alert
            v-if="!account.data.failsafe"
            dense
            outlined
            :type="'warning'">
            {{ t('StatusFailsafeoff') }}
          </v-alert>
        </v-col>
        <v-col>
          <v-row
            no-gutters
            class="mt-2 account-card__footer">
            <v-col class="d-flex flex-row account-card__options">
              <v-btn
                small
                class="ma-1"
                :to="{
                  name: routes.ACCOUNT_OPTIONS,
                  params: { accountId: account.id },
                }"
                target="_blank">
                <v-icon aria-hidden="true">mdi-cog</v-icon>
                {{ t('LabelOptions') }}
              </v-btn>
            </v-col>
            <v-col class="d-flex flex-row justify-end account-card__actions">
              <v-btn
                class="ma-1 ml-0"
                small
                :disabled="account.data.syncing || account.data.scheduled"
                :title="t('LabelSyncDownOnce')"
                :aria-label="t('LabelSyncDownOnce')"
                @click="onTriggerSyncDown">
                <v-icon aria-hidden="true">mdi-arrow-down-bold</v-icon>
              </v-btn>
              <v-btn
                class="ma-1"
                small
                :disabled="account.data.syncing || account.data.scheduled"
                :title="t('LabelSyncUpOnce')"
                :aria-label="t('LabelSyncUpOnce')"
                @click="onTriggerSyncUp">
                <v-icon aria-hidden="true">mdi-arrow-up-bold</v-icon>
              </v-btn>
              <v-btn
                v-if="!account.data.syncing"
                :disabled="account.data.scheduled"
                class="primary ma-1"
                small
                :title="t('LabelSyncnow')"
                :aria-label="t('LabelSyncnow')"
                @click="onTriggerSync">
                <v-icon aria-hidden="true">mdi-sync</v-icon>
              </v-btn>
              <v-btn
                v-else
                class="ma-1 mr-0"
                small
                :title="t('LabelCancelsync')"
                :aria-label="t('LabelCancelsync')"
                @click="onCancelSync">
                <v-icon aria-hidden="true">mdi-cancel</v-icon>
              </v-btn>
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
import { actions } from '../store/definitions'
import { routes } from '../router'
import BrowserTree from '../../lib/browser/BrowserTree'

export default {
  name: 'AccountCard',
  props: {
    account: {
      type: Object,
      required: true,
    },
  },
  data() {
    return {
      rootPath: '',
      statusColors: {
        disabled: 'rgb(125, 114, 128)',
        ok: '#3d8e39',
        error: '#8e3939',
        syncing: '#2196F3',
        scheduled: '#2196F3',
      },
      statusIcons: {
        disabled: 'mdi-sync-off',
        ok: 'mdi-check',
        error: 'mdi-sync-alert',
        syncing: 'mdi-sync',
        scheduled: 'mdi-timer-sync-outline',
      },
      statusLabels: {
        disabled: this.t('StatusDisabled'),
        ok: this.t('StatusAllgood'),
        error: this.t('StatusError'),
        syncing: this.t('StatusSyncing'),
        scheduled: this.t('StatusScheduled'),
      },
      strategyIcons: {
        slave: 'mdi-arrow-down-bold',
        overwrite: 'mdi-arrow-up-bold',
        default: 'mdi-merge',
      },
      strategyLabels: {
        slave: this.t('LabelSyncDown'),
        overwrite: this.t('LabelSyncUp'),
        default: this.t('LabelSyncNormal'),
      },
      strategyDescriptions: {
        slave: this.t('DescriptionSyncDown'),
        overwrite: this.t('DescriptionSyncUp'),
        default: this.t('DescriptionSyncNormal'),
      },
      showDetails: false,
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
      if (this.account.data.scheduled) {
        return 'scheduled'
      }
      if (this.account.data.error) {
        return 'error'
      }
      if (
        !this.account.data.enabled &&
        !this.account.data.syncIntervalEnabled
      ) {
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
        return (
          this.account.data.error +
          ' | ' +
          this.t('StatusLastsynced', [
            humanizeDuration(Date.now() - this.account.data.lastSync, {
              largest: 1,
              round: true,
              language: navigator.language.split('-')[0],
              fallbacks: navigator.languages
                .map((lang) => lang.split('-')[0])
                .concat(['en']),
            }),
          ])
        )
      }
      if (this.account.data.syncing) {
        return this.t('DescriptionSyncinprogress')
      }
      if (this.account.data.scheduled) {
        return this.t('DescriptionSyncscheduled')
      }
      if (this.account.data.lastSync) {
        return this.t('StatusLastsynced', [
          humanizeDuration(Date.now() - this.account.data.lastSync, {
            largest: 1,
            round: true,
            language: navigator.language.split('-')[0],
            fallbacks: navigator.languages
              .map((lang) => lang.split('-')[0])
              .concat(['en']),
          }),
        ])
      }
      return this.t('StatusNeversynced')
    },
    legacyWarning() {
      if (
        this.account.data.type === 'nextcloud' ||
        this.account.data.type === 'nextcloud-legacy'
      ) {
        return this.t('LegacyAdapterDeprecation')
      }
      return null
    },
    routes() {
      return routes
    },
  },
  watch: {
    async localRoot(localRoot) {
      this.rootPath = await BrowserTree.getPathFromLocalId(localRoot)
    },
  },
  async created() {
    this.rootPath = await BrowserTree.getPathFromLocalId(this.localRoot)
  },
  methods: {
    onChangeStrategy() {
      this.$store.dispatch(actions.STORE_ACCOUNT, {
        id: this.account.id,
        data: this.account.data,
      })
    },
    onTriggerSync() {
      this.$store.dispatch(actions.TRIGGER_SYNC, this.account.id)
    },
    onTriggerSyncUp() {
      this.$store.dispatch(actions.TRIGGER_SYNC_UP, this.account.id)
    },
    onTriggerSyncDown() {
      this.$store.dispatch(actions.TRIGGER_SYNC_DOWN, this.account.id)
    },
    onCancelSync() {
      this.$store.dispatch(actions.CANCEL_SYNC, this.account.id)
    },
    onToggleEnabled() {
      this.$store.dispatch(actions.STORE_ACCOUNT, {
        id: this.account.id,
        data: this.account.data,
      })
    },
    onGetLogs() {
      this.$store.dispatch(actions.DOWNLOAD_LOGS)
    },
    onForceSync() {
      if (confirm(this.t('DescriptionScheduledforcesync'))) {
        this.$store.dispatch(actions.FORCE_SYNC, this.account.id)
      }
    },
  },
}
</script>

<style scoped>
.spinning {
  animation: spin 2s infinite linear;
}

@media (min-width: 420px) {
  .account-card__statusColumn {
    min-width: max-content;
  }
}

@media (max-width: 419px) {
  .account-card__header {
    flex-direction: column;
  }
  .account-card__footer {
    flex-direction: column !important;
  }
  .account-card__actions {
    flex-direction: column !important;
  }
  .account-card__actions .ml-0 {
    margin-left: 4px !important;
  }
  .account-card__options {
    flex-direction: column !important;
  }
}

@keyframes spin {
  0% {
    transform: rotate(360deg);
  }
  99.9% {
    transform: rotate(0deg);
  }
}
</style>
