<template>
  <v-container>
    <h2
      id="server"
      class="text-h5">
      <v-icon>mdi-account-box</v-icon>
      {{ t('LabelOptionsServerDetails') }}
    </h2>
    <v-container>
      <div>
        <v-icon
          v-if="authorized || refreshToken"
          color="success">
          mdi-check
        </v-icon>
        <v-btn
          color="primary"
          @click="authenticate">
          {{ t('LabelLogingoogle') }}
        </v-btn>
        <p class="mt-1">
          {{ authorized || refreshToken? t('DescriptionLoggedingoogle') : t('DescriptionLogingoogle') }}
        </p>
      </div>
      <v-text-field
        append-icon="mdi-file-document"
        class="mt-2"
        :value="bookmark_file"
        :rules="[validateBookmarksFile]"
        :label="t('LabelBookmarksfile')"
        :hint="t('DescriptionBookmarksfilegoogle')"
        :persistent-hint="true"
        @input="$emit('update:bookmark_file', $event)" />
      <v-text-field
        append-icon="mdi-lock"
        class="mt-2"
        type="password"
        :value="password"
        :label="t('LabelPassphrase')"
        :hint="t('DescriptionPassphrase')"
        :persistent-hint="true"
        @input="$emit('update:password', $event)" />
    </v-container>

    <h2
      id="folder"
      class="text-h5">
      <v-icon>mdi-folder-outline</v-icon>
      <v-icon>mdi-sync-circle</v-icon>
      {{ t('LabelOptionsFolderMapping') }}
    </h2>
    <OptionSyncFolder
      :value="localRoot"
      @input="$emit('update:localRoot', $event)" />

    <h2
      id="sync"
      class="text-h5">
      <v-icon>mdi-alert-circle</v-icon>
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
      {{ t('LabelOptionsDangerous') }}
    </h2>
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
import GoogleDriveAdapter from '../../lib/adapters/GoogleDrive'

export default {
  name: 'OptionsGoogleDrive',
  components: { OptionFailsafe, OptionSyncFolder, OptionDeleteAccount, OptionSyncStrategy, OptionResetCache, OptionSyncInterval, OptionNestedSync },
  props: ['password', 'refreshToken', 'localRoot', 'syncInterval', 'strategy', 'bookmark_file', 'nestedSync', 'failsafe'],
  data() {
    return {
      panels: [0, 1],
      authorized: false,
    }
  },
  methods: {
    validateBookmarksFile(path) {
      return !path.includes('/')
    },
    async authenticate() {
      const refresh_token = await GoogleDriveAdapter.authorize()
      if (refresh_token) {
        this.authorized = true
        this.$emit('update:refreshToken', refresh_token)
      }
    }
  }
}
</script>

<style scoped>
</style>
