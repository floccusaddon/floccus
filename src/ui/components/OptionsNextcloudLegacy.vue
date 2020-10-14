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
            :label="t('LabelNextcloudurl')"
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
        </v-expansion-panel-content>
      </v-expansion-panel>

      <v-expansion-panel>
        <v-expansion-panel-header>{{ t('LabelOptionsFolderMapping') }}</v-expansion-panel-header>
        <v-expansion-panel-content>
          <v-container>
            <div class="heading">
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
          </v-container>
          <OptionSyncFolder
            :value="localRoot"
            @input="$emit('update:localRoot', $event)" />
          <OptionNestedSync
            :value="nestedSync"
            @input="$emit('update:nestedSync', $event)" />
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
        </v-expansion-panel-content>
      </v-expansion-panel>

      <v-expansion-panel>
        <v-expansion-panel-header>{{ t('LabelOptionsDangerous') }}</v-expansion-panel-header>
        <v-expansion-panel-content>
          <OptionResetCache @click="$emit('reset')" />
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

export default {
  name: 'OptionsNextcloudLegacy',
  components: { OptionSyncFolder, OptionDeleteAccount, OptionSyncStrategy, OptionResetCache, OptionSyncInterval, OptionNestedSync },
  props: ['url', 'username', 'password', 'serverRoot', 'localRoot', 'syncInterval', 'strategy', 'nestedSync'],
  data() {
    return {
      panels: [0]
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
      return !path || path !== '/' || (path[0] === '/' && path[path.length - 1] !== '/')
    },
  }
}
</script>

<style scoped>
</style>
