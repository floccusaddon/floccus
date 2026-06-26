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
      <v-card-text
        id="server"
        class="text-h5"
        role="heading"
        aria-level="2">
        <v-icon aria-hidden="true">mdi-account-box</v-icon>
        {{ t('LabelOptionsServerDetails') }}
      </v-card-text>
      <v-card-text>
        <v-text-field
          :value="url"
          :rules="[validateUrl]"
          :label="t('LabelLinkwardenurl')"
          @input="$emit('update:url', $event)" />
        <v-text-field
          :value="username"
          :label="t('LabelUsername')"
          @input="$emit('update:username', $event)" />
        <v-text-field
          :label="t('LabelAccesstoken')"
          :type="showPassword ? 'text' : 'password'"
          @input="$emit('update:password', $event)">
          <template #append>
            <v-icon
              role="button"
              tabindex="0"
              :aria-label="showPassword ? t('LabelHidepassword') : t('LabelShowpassword')"
              @click="showPassword = !showPassword"
              @keydown.enter="showPassword = !showPassword"
              @keydown.space.prevent="showPassword = !showPassword">
              {{ showPassword ? 'mdi-eye' : 'mdi-eye-off' }}
            </v-icon>
          </template>
        </v-text-field>
      </v-card-text>
    </v-card>

    <v-card
      v-if="isBrowser"
      class="mb-4">
      <v-card-title
        id="folder"
        class="text-h5"
        role="heading"
        aria-level="2">
        <v-icon aria-hidden="true">mdi-folder-outline</v-icon>
        {{ t('LabelOptionsFolderMapping') }}
      </v-card-title>
      <v-card-text>
        <div
          class="text-h6"
          role="heading"
          aria-level="3">
          {{ t('LabelServerfolder') }}
        </div>
        <div class="caption">
          {{ t('DescriptionServerfolderlinkwarden') }}
        </div>
        <v-text-field
          v-model="serverFolder"
          :label="t('LabelServerfolder')"
          @input="$emit('update:serverFolder', $event)" />
        <OptionSyncFolder
          :value="localRoot"
          @input="$emit('update:localRoot', $event)" />
      </v-card-text>
    </v-card>

    <v-card
      v-if="!isBrowser"
      class="mb-4">
      <v-card-title
        id="mobile"
        class="text-h5"
        role="heading"
        aria-level="2">
        <v-icon aria-hidden="true">mdi-cellphone-settings</v-icon>
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
        class="text-h5"
        role="heading"
        aria-level="2">
        <v-icon aria-hidden="true">mdi-sync-circle</v-icon>
        {{ t('LabelOptionsSyncBehavior') }}
      </v-card-title>
      <v-card-text>
        <OptionAutoSync
          :value="enabled"
          @input="$emit('update:enabled', $event)" />
        <OptionSyncIntervalEnabled
          :value="syncIntervalEnabled"
          @input="$emit('update:syncIntervalEnabled', $event)" />
        <OptionSyncInterval
          v-if="syncIntervalEnabled"
          :value="syncInterval"
          @input="$emit('update:syncInterval', $event)" />
        <OptionSyncStrategy
          :value="strategy"
          @input="$emit('update:strategy', $event)" />
        <OptionNestedSync
          v-if="isBrowser"
          :value="nestedSync"
          @input="$emit('update:nestedSync', $event)" />
      </v-card-text>
    </v-card>

    <v-card class="mb-4">
      <v-card-title
        id="danger"
        class="text-h5"
        role="heading"
        aria-level="2">
        <v-icon aria-hidden="true">mdi-alert-circle</v-icon>
        {{ t('LabelOptionsDangerous') }}
      </v-card-title>
      <v-card-text>
        <OptionDownloadLogs />
        <OptionClientCert
          v-if="isBrowser"
          :value="includeCredentials"
          @input="$emit('update:includeCredentials', $event)" />
        <OptionAllowRedirects
          :value="allowRedirects"
          @input="$emit('update:allowRedirects', $event)" />
        <OptionResetCache @click="$emit('reset')" />
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
import OptionNestedSync from './OptionNestedSync'
import OptionFailsafe from './OptionFailsafe'
import OptionClientCert from './OptionClientCert'
import OptionAllowRedirects from './OptionAllowRedirects'
import OptionDownloadLogs from './OptionDownloadLogs'
import OptionAllowNetwork from './native/OptionAllowNetwork'
import OptionExportBookmarks from './OptionExportBookmarks.vue'
import OptionAutoSync from './OptionAutoSync.vue'
import OptionSyncIntervalEnabled from './OptionSyncIntervalEnabled.vue'

export default {
  name: 'OptionsLinkwarden',
  components: { OptionSyncIntervalEnabled, OptionAutoSync, OptionExportBookmarks, OptionAllowNetwork, OptionDownloadLogs, OptionAllowRedirects, OptionClientCert, OptionFailsafe, OptionSyncFolder, OptionDeleteAccount, OptionSyncStrategy, OptionResetCache, OptionSyncInterval, OptionNestedSync },
  props: ['url', 'username', 'password', 'serverFolder', 'includeCredentials', 'serverRoot', 'localRoot', 'allowNetwork', 'syncInterval', 'strategy', 'nestedSync', 'failsafe', 'allowRedirects', 'enabled', 'label', 'syncIntervalEnabled'],
  data() {
    return {
      panels: [0, 1],
      showPassword: false,
      showPassphrase: false,
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
  }
}
</script>

<style scoped>
</style>
