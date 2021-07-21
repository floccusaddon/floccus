<template>
  <v-container>
    <h2
      id="server"
      class="text-h5">
      <v-icon>mdi-account-box</v-icon>
      {{ t('LabelOptionsServerDetails') }}
    </h2>
    <v-container>
      <v-text-field
        :value="url"
        :rules="[validateUrl]"
        :label="t('LabelWebdavurl')"
        @input="$emit('update:url', $event)" />
      <v-text-field
        :value="username"
        :label="t('LabelUsername')"
        @input="$emit('update:username', $event)" />
      <v-text-field
        :value="password"
        type="password"
        :label="t('LabelPassword')"
        @input="$emit('update:password', $event)" />
      <v-text-field
        append-icon="mdi-file-document"
        :value="bookmark_file"
        :rules="[validateBookmarksFile]"
        :label="t('LabelBookmarksfile')"
        :hint="t('DescriptionBookmarksfile')"
        :persistent-hint="true"
        @input="$emit('update:bookmark_file', $event)" />
      <v-text-field
        append-icon="mdi-lock"
        class="mt-2"
        type="password"
        :value="passphrase"
        :label="t('LabelPassphrase')"
        :hint="t('DescriptionPassphrase')"
        :persistent-hint="true"
        @input="$emit('update:passphrase', $event)" />
    </v-container>

    <h2
      id="folder"
      class="text-h5">
      <v-icon>mdi-folder-outline</v-icon>
      {{ t('LabelOptionsFolderMapping') }}
    </h2>
    <OptionSyncFolder
      :value="localRoot"
      @input="$emit('update:localRoot', $event)" />

    <h2
      id="sync"
      class="text-h5">
      <v-icon>mdi-sync-circle</v-icon>
      {{ t('LabelOptionsSyncBehavior') }}
    </h2>

    <OptionSyncInterval
      :value="syncInterval"
      @input="$emit('update:syncInterval', $event)" />
    <OptionSyncStrategy
      :value="strategy"
      @input="$emit('update:strategy', $event)" />
    <OptionNestedSync
      :value="nestedSync"
      @input="$emit('update:nestedSync', $event)" />

    <h2
      id="danger"
      class="text-h5">
      <v-icon>mdi-alert-circle</v-icon>
      {{ t('LabelOptionsDangerous') }}
    </h2>
    <OptionClientCert
      :value="includeCredentials"
      @input="$emit('update:includeCredentials', $event)" />
    <OptionResetCache @click="$emit('reset')" />
    <OptionFailsafe
      :value="failsafe"
      @input="$emit('update:failsafe', $event)" />
    <OptionDeleteAccount @click="$emit('delete')" />
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

export default {
  name: 'OptionsWebdav',
  components: { OptionClientCert, OptionFailsafe, OptionSyncFolder, OptionDeleteAccount, OptionSyncStrategy, OptionResetCache, OptionSyncInterval, OptionNestedSync },
  props: ['url', 'username', 'password','passphrase', 'includeCredentials', 'serverRoot', 'localRoot', 'syncInterval', 'strategy', 'bookmark_file', 'nestedSync', 'failsafe'],
  data() {
    return {
      panels: [0, 1]
    }
  },
  methods: {
    validateUrl(str) {
      try {
        const u = new URL(str)
        return Boolean(u)
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
