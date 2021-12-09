<template>
  <v-container>
    <v-card class="mb-4">
      <v-card-title
        id="server"
        class="text-h5">
        <v-icon>mdi-account-box</v-icon>
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
          :append-icon="showPassphrase ? 'mdi-eye' : 'mdi-eye-off'"
          :type="showPassphrase ? 'text' : 'password'"
          class="mt-2"
          :value="password"
          :label="t('LabelPassphrase')"
          :hint="t('DescriptionPassphrase')"
          :persistent-hint="true"
          @click:append="showPassphrase = !showPassphrase"
          @input="$emit('update:password', $event)" />
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

    <v-card class="mb-4">
      <v-card-title
        id="sync"
        class="text-h5">
        <v-icon>mdi-sync-circle</v-icon>
        {{ t('LabelOptionsSyncBehavior') }}
      </v-card-title>
      <v-card-text>
        <OptionSyncInterval
          v-if="isBrowser"
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

export default {
  name: 'OptionsGoogleDrive',
  components: { OptionFailsafe, OptionSyncFolder, OptionDeleteAccount, OptionSyncStrategy, OptionResetCache, OptionSyncInterval, OptionNestedSync },
  props: ['username', 'password', 'refreshToken', 'localRoot', 'syncInterval', 'strategy', 'bookmark_file', 'nestedSync', 'failsafe'],
  data() {
    return {
      panels: [0, 1],
      authorized: false,
      showPassphrase: true,
    }
  },
  methods: {
    validateBookmarksFile(path) {
      return !path.includes('/')
    },
    async authenticate() {
      const GoogleDriveAdapter = (await import('../../lib/adapters/GoogleDrive')).default
      const { refresh_token, username } = await GoogleDriveAdapter.authorize()
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
