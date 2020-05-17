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
            v-model="data.url"
            :rules="[validateUrl]"
            :label="t('LabelNextcloudurl')"
            @input="$emit('input', data)" />
          <v-text-field
            v-model="data.username"
            :label="t('LabelUsername')"
            @input="$emit('input', data)" />
          <v-text-field
            v-model="data.password"
            type="password"
            :label="t('LabelPassword')"
            @input="$emit('input', data)" />
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
              v-model="data.serverRoot"
              :placeholder="'/'"
              :rules="[validateServerRoot]"
              :label="t('LabelServerfolder')"
              @input="$emit('input', data)" />
          </v-container>
          <OptionSyncFolder
            v-model="data.localRoot"
            @input="$emit('input', data)" />
        </v-expansion-panel-content>
      </v-expansion-panel>

      <v-expansion-panel>
        <v-expansion-panel-header>{{ t('LabelOptionsSyncBehavior') }}</v-expansion-panel-header>
        <v-expansion-panel-content>
          <OptionSyncInterval
            v-model="data.syncInterval"
            @input="$emit('input', data)" />
          <OptionSyncStrategy
            v-model="data.strategy"
            @input="$emit('input', data)" />
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
import { url } from 'vuelidate/lib/validators'
import OptionSyncInterval from './OptionSyncInterval'
import OptionResetCache from './OptionResetCache'
import OptionSyncStrategy from './OptionSyncStrategy'
import OptionDeleteAccount from './OptionDeleteAccount'
import OptionSyncFolder from './OptionSyncFolder'

export default {
  name: 'OptionsNextcloudFolders',
  components: { OptionSyncFolder, OptionDeleteAccount, OptionSyncStrategy, OptionResetCache, OptionSyncInterval },
  props: {
    value: {
      type: Object,
      required: true
    }
  },
  data() {
    return {
      data: this.value,
      panels: [0]
    }
  },
  methods: {
    validateUrl: url,
    validateServerRoot(path) {
      return !path || path === '/' || (path[0] === '/' && path[path.length - 1] !== '/')
    },
  }
}
</script>

<style scoped>
</style>
