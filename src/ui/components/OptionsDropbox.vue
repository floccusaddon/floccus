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
        id="server"
        class="text-h5"
        role="heading"
        aria-level="2">
        <v-icon aria-hidden="true">mdi-account-box</v-icon>
        {{ t('LabelOptionsServerDetails') }}
      </v-card-title>
      <v-card-text>
        <div>
          <template v-if="authorized || refreshToken">
            {{ username }}
            <v-icon
              color="success">
              mdi-check
            </v-icon>
          </template>
          <v-btn
            color="primary"
            @click="authenticate">
            {{ t('LabelLogindropbox') }}
          </v-btn>
          <p class="mt-1">
            {{ authorized || refreshToken? t('DescriptionLoggedindropbox') : t('DescriptionLogindropbox') }}
          </p>
        </div>
        <v-text-field
          append-icon="mdi-file-document"
          class="mt-2"
          :value="bookmark_file"
          :rules="[validateBookmarksFile]"
          :label="t('LabelBookmarksfile')"
          :hint="t('DescriptionBookmarksfiledropbox')"
          :persistent-hint="true"
          @input="$emit('update:bookmark_file', $event)" />
        <OptionPassphrase
          :value="password"
          @input="$emit('update:password', $event)" />
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
import OptionDownloadLogs from './OptionDownloadLogs'
import OptionAllowNetwork from './native/OptionAllowNetwork'
import OptionPassphrase from './OptionPassphrase'
import OptionExportBookmarks from './OptionExportBookmarks.vue'
import OptionAutoSync from './OptionAutoSync.vue'
import OptionSyncIntervalEnabled from './OptionSyncIntervalEnabled.vue'

export default {
  name: 'OptionsDropbox',
  components: { OptionSyncIntervalEnabled, OptionAutoSync, OptionExportBookmarks, OptionPassphrase, OptionAllowNetwork, OptionDownloadLogs, OptionFailsafe, OptionSyncFolder, OptionDeleteAccount, OptionSyncStrategy, OptionResetCache, OptionSyncInterval, OptionNestedSync },
  props: ['username', 'password', 'refreshToken', 'localRoot', 'allowNetwork', 'syncInterval', 'strategy', 'bookmark_file', 'nestedSync', 'failsafe', 'enabled', 'label', 'syncIntervalEnabled'],
  data() {
    return {
      panels: [0, 1],
      authorized: false,
      showPassphrase: false,
    }
  },
  methods: {
    validateBookmarksFile(path) {
      return !path.includes('/')
    },
    async authenticate() {
      const DropboxAdapter = (await import('../../lib/adapters/Dropbox')).default
      const { refresh_token, username } = await DropboxAdapter.authorize()
      if (refresh_token) {
        this.authorized = true
        this.$emit('update:refreshToken', refresh_token)
        this.$emit('update:username', username)
      }
    }
  }
}
</script>

<style scoped>
</style>
