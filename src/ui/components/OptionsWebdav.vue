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
            :label="t('LabelWebdavurl')" />
          <v-text-field
            v-model="data.username"
            :label="t('LabelUsername')" />
          <v-text-field
            v-model="data.password"
            type="password"
            :label="t('LabelPassword')" />
          <v-text-field
            v-model="data.bookmark_file"
            :rules="[validateBookmarksFile]"
            :label="t('LabelBookmarksfile')"
            :hint="t('DescriptionBookmarksfile')"
            :persistent-hint="true" />
        </v-expansion-panel-content>
      </v-expansion-panel>

      <v-expansion-panel>
        <v-expansion-panel-header>{{ t('LabelOptionsFolderMapping') }}</v-expansion-panel-header>
        <v-expansion-panel-content>
          <OptionSyncFolder v-model="data.localRoot" />
        </v-expansion-panel-content>
      </v-expansion-panel>

      <v-expansion-panel>
        <v-expansion-panel-header>{{ t('LabelOptionsSyncBehavior') }}</v-expansion-panel-header>
        <v-expansion-panel-content>
          <OptionSyncInterval v-model="data.syncInterval" />
          <OptionSyncStrategy v-model="data.strategy" />
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
  name: 'OptionsWebdav',
  components: { OptionSyncFolder, OptionDeleteAccount, OptionSyncStrategy, OptionResetCache, OptionSyncInterval },
  props: {
    account: {
      type: Object,
      required: true
    }
  },
  data() {
    return {
      data: this.account,
      panels: [0]
    }
  },
  methods: {
    validateUrl: url,
    validateBookmarksFile(path) {
      return path[0] !== '/' && path[path.length - 1] !== '/'
    },
  }
}
</script>

<style scoped>
</style>
