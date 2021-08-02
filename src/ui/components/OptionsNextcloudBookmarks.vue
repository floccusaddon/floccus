<template>
  <v-container>
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
          :value="syncInterval"
          @input="$emit('update:syncInterval', $event)" />
        <OptionSyncStrategy
          :value="strategy"
          @input="$emit('update:strategy', $event)" />
        <OptionNestedSync
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
        <OptionClientCert
          :value="includeCredentials"
          @input="$emit('update:includeCredentials', $event)" />
        <OptionResetCache @click="$emit('reset')" />
        <OptionAllowRedirects
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

export default {
  name: 'OptionsNextcloudBookmarks',
  components: { OptionAllowRedirects, OptionClientCert, OptionFailsafe, OptionNestedSync, NextcloudLogin, OptionSyncFolder, OptionDeleteAccount, OptionSyncStrategy, OptionResetCache, OptionSyncInterval },
  props: ['url', 'username', 'password', 'includeCredentials', 'serverRoot', 'localRoot', 'syncInterval', 'strategy', 'nestedSync', 'failsafe', 'allowRedirects'],
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
    validateServerRoot(path) {
      return !path || path === '/' || (path[0] === '/' && path[path.length - 1] !== '/')
    },
  }
}
</script>

<style scoped>
</style>
