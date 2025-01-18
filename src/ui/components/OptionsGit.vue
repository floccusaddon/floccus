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
        class="text-h5">
        <v-icon>mdi-account-box</v-icon>
        {{ t('LabelOptionsServerDetails') }}
      </v-card-text>
      <v-card-text>
        <v-text-field
          :value="url"
          :rules="[validateUrl]"
          :label="t('LabelGiturl')"
          @input="$emit('update:url', $event)" />
        <v-text-field
          :value="username"
          :label="t('LabelUsername')"
          @input="$emit('update:username', $event)" />
        <v-text-field
          :label="t('LabelPassword')"
          :append-icon="showPassword ? 'mdi-eye' : 'mdi-eye-off'"
          :type="showPassword ? 'text' : 'password'"
          @click:append="showPassword = !showPassword"
          @input="$emit('update:password', $event)" />
        <v-text-field
          append-icon="mdi-file-document"
          :value="bookmark_file"
          :rules="[validateBookmarksFile]"
          :label="t('LabelBookmarksfile')"
          :hint="t('DescriptionBookmarksfilegit')"
          :persistent-hint="true"
          @input="$emit('update:bookmark_file', $event)" />
        <OptionFileType
          :value="bookmark_file_type"
          @input="$emit('update:bookmark_file_type', $event)" />
        <v-text-field
          :value="branch"
          class="mb-2"
          :label="t('LabelGitbranch')"
          @input="$emit('update:branch', $event)" />
      </v-card-text>
    </v-card>

    <v-card
      v-if="isBrowser"
      class="mb-4">
      <v-card-title
        id="folder"
        class="text-h5">
        <v-icon>mdi-folder-outline</v-icon>
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
        <OptionAllowRedirects
          v-if="isBrowser"
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
import OptionFileType from './OptionFileType'
import OptionExportBookmarks from './OptionExportBookmarks.vue'
import OptionAutoSync from './OptionAutoSync.vue'

export default {
  name: 'OptionsGit',
  components: { OptionAutoSync, OptionExportBookmarks, OptionAllowNetwork, OptionDownloadLogs, OptionAllowRedirects, OptionClientCert, OptionFailsafe, OptionSyncFolder, OptionDeleteAccount, OptionSyncStrategy, OptionResetCache, OptionSyncInterval, OptionNestedSync, OptionFileType },
  props: ['url', 'username', 'password', 'branch', 'includeCredentials', 'serverRoot', 'localRoot', 'allowNetwork', 'syncInterval', 'strategy', 'bookmark_file', 'nestedSync', 'failsafe', 'allowRedirects', 'bookmark_file_type', 'enabled', 'label'],
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
    validateBookmarksFile(path) {
      return path[0] !== '/' && path[path.length - 1] !== '/'
    },
  }
}
</script>

<style scoped>
</style>
