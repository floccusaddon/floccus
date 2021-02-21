<template>
  <div>
    <v-expansion-panels
      v-model="panels"
      hover
      multiple>
      <v-expansion-panel>
        <v-expansion-panel-header>{{ t('LabelOptionsServerDetails') }}</v-expansion-panel-header>
        <v-expansion-panel-content>
          <div v-if="password">
            <v-btn
              disabled
              color="primary"
              @click="authenticate">
              {{ t('LabelLoggedingoogle') }}
            </v-btn>
          </div>
          <div v-else>
            <v-btn
              color="primary"
              @click="authenticate">
              {{ t('LabelLogingoogle') }}
            </v-btn>
            <p class="mt-1">
              {{ t('DescriptionLogingoogle') }}
            </p>
          </div>
          <v-text-field
            class="mt-2"
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
import GoogleDriveAdapter from '../../lib/adapters/GoogleDrive'

export default {
  name: 'OptionsGoogleDrive',
  components: { OptionFailsafe, OptionSyncFolder, OptionDeleteAccount, OptionSyncStrategy, OptionResetCache, OptionSyncInterval, OptionNestedSync },
  props: ['password', 'localRoot', 'syncInterval', 'strategy', 'bookmark_file', 'nestedSync', 'failsafe'],
  data() {
    return {
      panels: [0, 1]
    }
  },
  methods: {
    validateBookmarksFile(path) {
      return path[0] !== '/' && path[path.length - 1] !== '/'
    },
    async authenticate() {
      const token = await GoogleDriveAdapter.authorizeMozilla()
      this.$emit('update:password', token)
    }
  }
}
</script>

<style scoped>
</style>
