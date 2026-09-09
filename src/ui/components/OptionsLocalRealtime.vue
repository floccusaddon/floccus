<template>
  <v-container>
    <v-text-field
      append-icon="mdi-label"
      class="mt-2 mb-4"
      :value="label"
      :label="t('LabelAccountlabel')"
      @input="$emit('update:label', $event)" />

    <v-card class="mb-4">
      <v-card-title id="server" class="text-h5">
        <v-icon aria-hidden="true">mdi-lan-connect</v-icon>
        {{ t('LabelOptionsServerDetails') }}
      </v-card-title>
      <v-card-text>
        <v-text-field :value="url" :label="t('LabelLocalRealtimeUrl')" @input="$emit('update:url', $event)" />
        <v-text-field :value="username" :label="t('LabelLocalClientId')" readonly />
        <v-text-field
          :value="password"
          :label="t('LabelLocalAccessToken')"
          :type="showToken ? 'text' : 'password'"
          @input="$emit('update:password', $event)">
          <template #append>
            <v-icon @click="showToken = !showToken">{{ showToken ? 'mdi-eye' : 'mdi-eye-off' }}</v-icon>
          </template>
        </v-text-field>
        <v-chip small :color="connectionColor">{{ connectionText }}</v-chip>
        <span v-if="localRealtimeVersion !== undefined" class="caption ml-2">
          {{ t('LabelLocalVersion') }} {{ localRealtimeVersion }}
        </span>
      </v-card-text>
    </v-card>

    <v-card class="mb-4">
      <v-card-title id="folder" class="text-h5">
        <v-icon aria-hidden="true">mdi-folder-outline</v-icon>
        {{ t('LabelOptionsFolderMapping') }}
      </v-card-title>
      <v-card-text>
        <OptionSyncFolder :value="localRoot" @input="$emit('update:localRoot', $event)" />
      </v-card-text>
    </v-card>

    <v-card class="mb-4">
      <v-card-title id="sync" class="text-h5">
        <v-icon aria-hidden="true">mdi-sync-circle</v-icon>
        {{ t('LabelOptionsSyncBehavior') }}
      </v-card-title>
      <v-card-text>
        <OptionAutoSync :value="enabled" @input="$emit('update:enabled', $event)" />
        <OptionSyncOnStartup :value="syncOnStartupEnabled" @input="$emit('update:syncOnStartupEnabled', $event)" />
        <OptionSyncIntervalEnabled :value="syncIntervalEnabled" @input="$emit('update:syncIntervalEnabled', $event)" />
        <OptionSyncInterval v-if="syncIntervalEnabled" :value="syncInterval" @input="$emit('update:syncInterval', $event)" />
        <OptionSyncStrategy :value="strategy" @input="$emit('update:strategy', $event)" />
        <OptionNestedSync :value="nestedSync" @input="$emit('update:nestedSync', $event)" />
      </v-card-text>
    </v-card>

    <v-card class="mb-4">
      <v-card-title id="danger" class="text-h5">
        <v-icon aria-hidden="true">mdi-history</v-icon>
        {{ t('LabelLocalHistory') }}
      </v-card-title>
      <v-card-text>
        <v-alert v-if="hasConflict" type="error" outlined>
          <div>{{ t('DescriptionLocalConflict') }}</div>
          <div class="caption mt-2">{{ conflict ? conflict.details : error }}</div>
          <v-btn small color="error" class="mt-3" @click="resolveConflict('shared')">{{ t('LabelLocalUseShared') }}</v-btn>
          <v-btn small color="error" outlined class="mt-3 ml-2" @click="resolveConflict('local')">{{ t('LabelLocalUseLocal') }}</v-btn>
        </v-alert>
        <v-alert v-if="historyError" dense type="error">{{ historyError }}</v-alert>
        <v-btn small :loading="historyLoading" @click="loadHistory">{{ t('LabelLocalRefreshHistory') }}</v-btn>
        <v-btn small class="ml-2" :loading="historyLoading" @click="createBackup">{{ t('LabelLocalCreateBackup') }}</v-btn>
        <v-simple-table v-if="history.length" class="mt-3">
          <thead><tr><th>{{ t('LabelLocalVersion') }}</th><th>{{ t('LabelLocalReason') }}</th><th>{{ t('LabelLocalActions') }}</th></tr></thead>
          <tbody>
            <tr v-for="item in history" :key="item.version">
              <td>{{ item.version }} <v-icon v-if="item.pinned" x-small>mdi-pin</v-icon></td>
              <td>{{ item.reason }}</td>
              <td><v-btn text x-small @click="previewRestore(item.version)">{{ t('LabelPreview') }}</v-btn></td>
            </tr>
          </tbody>
        </v-simple-table>
        <v-alert v-if="preview" class="mt-3" type="warning" outlined>
          {{ t('DescriptionLocalRestorePreview', [preview.version, preview.added, preview.removed, preview.changed]) }}
          <div v-for="line in preview.lines" :key="line" class="caption">{{ line }}</div>
          <v-btn small color="warning" class="mt-2" @click="restoreVersion(preview.version)">{{ t('LabelLocalRestore') }}</v-btn>
        </v-alert>
        <v-divider class="my-4" />
        <OptionFailsafe :value="failsafe" @input="$emit('update:failsafe', $event)" />
        <OptionResetCache @click="$emit('reset')" />
        <OptionDeleteAccount @click="$emit('delete')" />
      </v-card-text>
    </v-card>
  </v-container>
</template>

<script>
import OptionAutoSync from './OptionAutoSync.vue'
import OptionDeleteAccount from './OptionDeleteAccount.vue'
import OptionFailsafe from './OptionFailsafe.vue'
import OptionNestedSync from './OptionNestedSync.vue'
import OptionResetCache from './OptionResetCache.vue'
import OptionSyncFolder from './OptionSyncFolder.vue'
import OptionSyncInterval from './OptionSyncInterval.vue'
import OptionSyncIntervalEnabled from './OptionSyncIntervalEnabled.vue'
import OptionSyncOnStartup from './OptionSyncOnStartup.vue'
import OptionSyncStrategy from './OptionSyncStrategy.vue'
import { actions } from '../store/definitions'

export default {
  name: 'OptionsLocalRealtime',
  components: { OptionAutoSync, OptionDeleteAccount, OptionFailsafe, OptionNestedSync, OptionResetCache, OptionSyncFolder, OptionSyncInterval, OptionSyncIntervalEnabled, OptionSyncOnStartup, OptionSyncStrategy },
  props: ['label', 'url', 'username', 'password', 'libraryId', 'localRoot', 'enabled', 'syncOnStartupEnabled', 'syncIntervalEnabled', 'syncInterval', 'strategy', 'nestedSync', 'failsafe', 'localRealtimeVersion', 'localRealtimeConflictId', 'localRealtimeConflictBaseVersion', 'error'],
  data() {
    return { showToken: false, history: [], historyLoading: false, historyError: '', preview: null, serviceOnline: null, conflict: null }
  },
  computed: {
    hasConflict() { return Boolean(this.conflict || (this.error && this.error.startsWith('E058:'))) },
    connectionColor() { return this.serviceOnline === null ? '' : (this.serviceOnline ? 'success' : 'error') },
    connectionText() { return this.serviceOnline === null ? this.t('LabelLocalUnchecked') : (this.serviceOnline ? this.t('LabelLocalConnected') : this.t('LabelLocalOffline')) },
  },
  mounted() { this.checkConnection() },
  methods: {
    endpoint(path) { return this.url.replace(/\/$/, '') + '/api/v1' + path },
    async request(path, options = {}) {
      const response = await fetch(this.endpoint(path), { ...options, cache: 'no-store', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + this.password } })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.message || 'Request failed')
      return payload
    },
    async checkConnection() {
      try {
        await this.request(`/libraries/${this.libraryId || 'default'}/state`)
        this.serviceOnline = true
        const pending = (await this.request(`/libraries/${this.libraryId || 'default'}/conflict`)).conflict
        this.conflict = pending || (this.localRealtimeConflictId
          ? { id: this.localRealtimeConflictId, baseVersion: this.localRealtimeConflictBaseVersion, details: this.error }
          : null)
      } catch (error) { this.serviceOnline = false }
    },
    async loadHistory() {
      this.historyLoading = true
      this.historyError = ''
      try { this.history = (await this.request(`/libraries/${this.libraryId || 'default'}/history`)).versions } catch (error) { this.historyError = error.message }
      this.historyLoading = false
    },
    async createBackup() {
      this.historyLoading = true
      this.historyError = ''
      try {
        await this.request(`/libraries/${this.libraryId || 'default'}/backup`, { method: 'POST', body: JSON.stringify({ reason: 'manual-backup' }) })
        await this.loadHistory()
      } catch (error) { this.historyError = error.message; this.historyLoading = false }
    },
    flatten(tree, path = '', result = {}) {
      for (const child of tree.children || []) {
        const childPath = path + '/' + child.title
        result[child.id] = { value: JSON.stringify([child.type, child.title, child.url || '', path]), label: childPath }
        if (child.children) this.flatten(child, childPath, result)
      }
      return result
    },
    async previewRestore(version) {
      this.historyError = ''
      try {
        const library = this.libraryId || 'default'
        const [current, target] = await Promise.all([this.request(`/libraries/${library}/state`), this.request(`/libraries/${library}/history/${version}`)])
        const a = this.flatten(current.tree)
        const b = this.flatten(target.tree)
        const added = Object.keys(b).filter(id => !a[id])
        const removed = Object.keys(a).filter(id => !b[id])
        const changed = Object.keys(a).filter(id => b[id] && a[id].value !== b[id].value)
        this.preview = { version, baseVersion: current.version, added: added.length, removed: removed.length, changed: changed.length, lines: [...added.map(id => '+ ' + b[id].label), ...removed.map(id => '- ' + a[id].label), ...changed.map(id => '~ ' + b[id].label)].slice(0, 20) }
      } catch (error) { this.historyError = error.message }
    },
    async restoreVersion(version) {
      this.historyLoading = true
      this.historyError = ''
      try {
        await this.request(`/libraries/${this.libraryId || 'default'}/restore`, {
          method: 'POST',
          body: JSON.stringify({ version, baseVersion: this.preview?.baseVersion }),
        })
        this.preview = null
        await this.loadHistory()
      } catch (error) { this.historyError = error.message; this.historyLoading = false }
    },
    async resolveConflict(choice) {
      const message = choice === 'shared' ? this.t('ConfirmLocalUseShared') : this.t('ConfirmLocalUseLocal')
      if (!confirm(message)) return
      this.historyError = ''
      try {
        if (!this.conflict) await this.checkConnection()
        if (!this.conflict) throw new Error(this.t('DescriptionLocalConflict'))
        const transactionId = choice === 'local' ? crypto.randomUUID() : undefined
        const accountId = this.$route.params.accountId
        if (choice === 'shared') {
          const currentData = this.$store.state.accounts[accountId].data
          await this.$store.dispatch(actions.STORE_ACCOUNT, {
            id: accountId,
            data: {
              ...currentData,
              localRealtimePending: {
                strategy: 'slave',
                conflictId: this.conflict.id,
                baseVersion: this.conflict.baseVersion,
                startedAt: Date.now(),
              },
            },
          })
        }
        const result = await this.request(`/libraries/${this.libraryId || 'default'}/conflict/${this.conflict.id}/resolve`, {
          method: 'POST',
          body: JSON.stringify({ resolution: choice, baseVersion: this.conflict.baseVersion, transactionId }),
        })
        const currentData = this.$store.state.accounts[accountId].data
        await this.$store.dispatch(actions.STORE_ACCOUNT, {
          id: accountId,
          data: {
            ...currentData,
            error: null,
            errorCount: 0,
            conflictPending: false,
            localRealtimePending: result.prepared
              ? {
                transactionId: result.transactionId,
                leaseId: result.leaseId,
                baseVersion: result.baseVersion,
                startedAt: Date.now(),
                strategy: 'overwrite',
                conflictId: this.conflict.id,
                preparedConflict: true,
              }
              : {
                ...currentData.localRealtimePending,
                strategy: 'slave',
                baseVersion: result.baseVersion,
              },
            localRealtimeConflictId: this.conflict.id,
            localRealtimeConflictBaseVersion: result.baseVersion,
          },
        })
        this.conflict = null
        const syncData = await this.$store.dispatch(
          result.prepared ? actions.TRIGGER_SYNC_UP : actions.TRIGGER_SYNC_DOWN,
          accountId
        )
        if (syncData?.error) throw new Error(syncData.error)
      } catch (error) { this.historyError = error.message }
    },
  },
}
</script>
