<template>
  <v-container>
    <div>
      <v-text-field
        append-icon="mdi-label"
        class="mt-2 mb-4"
        :value="label"
        :label="t('LabelAccountlabel')"
        :hint="t('DescriptionAccountlabel')"
        :persistent-hint="true"
        @input="$emit('update:label', $event)" />
    </div>
    <v-card class="mb-4">
      <v-card-title
        id="server">
        <v-icon>mdi-account-box</v-icon>
        {{ t('LabelOptionsServerDetails') }}
      </v-card-title>
      <v-card-text>
        <v-text-field
          :value="url"
          :rules="[validateUrl]"
          :label="t('LabelNextcloudurl')"
          @input="$emit('update:url', $event)" />
        <NextcloudLogin
          :username="username"
          :password="password"
          :server="url"
          @update:username="$emit('update:username', $event)"
          @update:password="$emit('update:password', $event)" />
      </v-card-text>
    </v-card>

    <v-card class="mb-4">
      <v-card-title
        id="folder">
        <v-icon>mdi-folder-outline</v-icon>
        {{ t('LabelOptionsFolderMapping') }}
      </v-card-title>
      <v-card-text>
        <div class="text-h6">
          {{ t('LabelServerfolder') }}
        </div>
        <div class="caption">
          {{ t('DescriptionServerfolder') }}
        </div>
        <v-text-field
          :value="serverRoot"
          :placeholder="'/'"
          :rules="[validateServerRoot]"
          :label="t('LabelServerfolder')"
          @input="$emit('update:serverRoot', $event)" />
        <OptionSyncFolder
          v-if="isBrowser"
          :value="localRoot"
          @input="$emit('update:localRoot', $event)" />
      </v-card-text>
    </v-card>

    <v-card
      v-if="!isBrowser"
      class="mb-4">
      <v-card-title
        id="mobile"
        class="text-h5">
        <v-icon>mdi-cellphone-settings</v-icon>
        {{ t('LabelMobilesettings') }}
      </v-card-title>
      <v-card-text>
        <OptionAllowNetwork
          :value="allowNetwork"
          @input="$emit('update:allowNetwork', $event)" />
        <OptionExportBookmarks />
      </v-card-text>
    </v-card>

    <v-card class="mb-4">
      <v-card-title
        id="sync"
        class="text-h5">
        <v-icon>mdi-sync-circle</v-icon>
        {{ t('LabelOptionsSyncBehavior') }}
      </v-card-title>
      <v-card-text>
        <OptionAutoSync
          :value="enabled"
          @input="$emit('update:enabled', $event)" />
        <OptionSyncInterval
          :value="syncInterval"
          @input="$emit('update:syncInterval', $event)" />
        <OptionSyncStrategy
          :value="strategy"
          @input="$emit('update:strategy', $event)" />
        <OptionNestedSync
          v-if="isBrowser"
          :value="nestedSync"
          @input="$emit('update:nestedSync', $event)" />
        <v-switch
          :input-value="clickCountEnabled"
          :aria-label="t('LabelClickcount')"
          :label="t('LabelClickcount')"
          :hint="t('DescriptionClickcount')"
          :persistent-hint="true"
          dense
          class="mt-0 pt-0"
          @change="$emit('update:clickCountEnabled', $event); requestHistoryPermissions()" />
      </v-card-text>
    </v-card>

    <v-card class="mb-4">
      <v-card-title
        id="danger"
        class="text-h5">
        <v-icon>mdi-alert-circle</v-icon>
        {{ t('LabelOptionsDangerous') }}
      </v-card-title>
      <v-card-text>
        <OptionDownloadLogs />
        <OptionClientCert
          v-if="isBrowser"
          :value="includeCredentials"
          @input="$emit('update:includeCredentials', $event)" />
        <OptionResetCache @click="$emit('reset')" />
        <OptionAllowRedirects
          v-if="isBrowser"
          :value="allowRedirects"
          @input="$emit('update:allowRedirects', $event)" />
        <OptionFailsafe
          :value="failsafe"
          @input="$emit('update:failsafe', $event)" />
        <OptionDeleteAccount @click="$emit('delete')" />
      </v-card-text>
    </v-card>
  </v-container>
</template>

<script>
import OptionSyncInterval from './OptionSyncInterval'
import OptionResetCache from './OptionResetCache'
import OptionSyncStrategy from './OptionSyncStrategy'
import OptionDeleteAccount from './OptionDeleteAccount'
import OptionSyncFolder from './OptionSyncFolder'
import NextcloudLogin from './NextcloudLogin'
import OptionNestedSync from './OptionNestedSync'
import OptionFailsafe from './OptionFailsafe'
import OptionClientCert from './OptionClientCert'
import OptionAllowRedirects from './OptionAllowRedirects'
import OptionDownloadLogs from './OptionDownloadLogs'
import OptionAllowNetwork from './native/OptionAllowNetwork'
import OptionExportBookmarks from './OptionExportBookmarks.vue'
import { actions } from '../store/definitions'
import OptionAutoSync from './OptionAutoSync.vue'

export default {
  name: 'OptionsNextcloudBookmarks',
  components: { OptionAutoSync, OptionExportBookmarks, OptionAllowNetwork, OptionDownloadLogs, OptionAllowRedirects, OptionClientCert, OptionFailsafe, OptionNestedSync, NextcloudLogin, OptionSyncFolder, OptionDeleteAccount, OptionSyncStrategy, OptionResetCache, OptionSyncInterval },
  props: ['url', 'username', 'password', 'includeCredentials', 'serverRoot', 'localRoot', 'allowNetwork', 'syncInterval', 'strategy', 'nestedSync', 'failsafe', 'allowRedirects', 'enabled', 'label', 'clickCountEnabled'],
  data() {
    return {
      panels: [0, 1]
    }
  },
  methods: {
    validateUrl(str) {
      try {
        const u = new URL(str)
        return Boolean(u) && u.protocol.startsWith('http')
      } catch (e) {
        return false
      }
    },
    validateServerRoot(path) {
      return !path || path === '/' || (path[0] === '/' && path[path.length - 1] !== '/')
    },
    requestHistoryPermissions() {
      this.$store.dispatch(actions.REQUEST_HISTORY_PERMISSIONS)
    }
  }
}
</script>

<style scoped>
</style>
