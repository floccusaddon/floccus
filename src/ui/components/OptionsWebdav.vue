<template>
  <div>
    <v-expansion-panels
      v-model="panels"
      hover
      multiple>
      <v-expansion-panel>
        <v-expansion-panel-header>{{ t('LabelOptionsServerDetails') }}</v-expansion-panel-header>
        <v-expansion-panel-content>
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
            :value="bookmark_file"
            :rules="[validateBookmarksFile]"
            :label="t('LabelBookmarksfile')"
            :hint="t('DescriptionBookmarksfile')"
            :persistent-hint="true"
            @input="$emit('update:bookmark_file', $event)" />
        </v-expansion-panel-content>
      </v-expansion-panel>

      <v-expansion-panel>
        <v-expansion-panel-header>{{ t('LabelOptionsFolderMapping') }}</v-expansion-panel-header>
        <v-expansion-panel-content>
          <OptionSyncFolder
            :value="localRoot"
            @input="$emit('update:localRoot', $event)" />
        </v-expansion-panel-content>
      </v-expansion-panel>

      <v-expansion-panel>
        <v-expansion-panel-header>{{ t('LabelOptionsSyncBehavior') }}</v-expansion-panel-header>
        <v-expansion-panel-content>
          <OptionSyncInterval
            :value="syncInterval"
            @input="$emit('update:syncInterval', $event)" />
          <OptionSyncStrategy
            :value="strategy"
            @input="$emit('update:strategy', $event)" />
          <OptionNestedSync
            :value="nestedSync"
            @input="$emit('update:nestedSync', $event)" />
        </v-expansion-panel-content>
      </v-expansion-panel>

      <v-expansion-panel>
        <v-expansion-panel-header>{{ t('LabelOptionsDangerous') }}</v-expansion-panel-header>
        <v-expansion-panel-content>
          <OptionClientCert
            :value="includeCredentials"
            @input="$emit('update:includeCredentials', $event)" />
          <OptionResetCache @click="$emit('reset')" />
          <OptionFailsafe
            :value="failsafe"
            @input="$emit('update:failsafe', $event)" />
          <OptionDeleteAccount @click="$emit('delete')" />
        </v-expansion-panel-content>
      </v-expansion-panel>
    </v-expansion-panels>
  </div>
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
  props: ['url', 'username', 'password', 'includeCredentials', 'serverRoot', 'localRoot', 'syncInterval', 'strategy', 'bookmark_file', 'nestedSync', 'failsafe'],
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
