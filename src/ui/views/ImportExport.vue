<template>
  <v-container>
    <v-card
      class="options">
      <v-container class="pa-5">
        <v-card-title
          role="heading"
          aria-level="1">
          {{ t("LabelExport") }}
        </v-card-title>
        <v-card-text>
          <p>{{ t("DescriptionExport") }}</p>
          <div
            v-for="(account, i) in accounts"
            :key="i">
            <v-row>
              <v-col class="flex-grow-0">
                <v-checkbox
                  v-model="selected[i]"
                  :aria-label="getFolderName(account.fullPath)" />
              </v-col>
              <v-col>
                <div class="text-h6">
                  <v-icon
                    color="primary"
                    aria-hidden="true">
                    {{ account.data.localRoot === 'tabs'? 'mdi-tab' : 'mdi-folder' }}
                  </v-icon> {{ getFolderName(account.fullPath) }}
                </div>
                <div class="caption">
                  <span class="text-uppercase">{{ account.data.type }}</span>: {{ account.label }}
                </div>
              </v-col>
            </v-row>
          </div>
          <v-btn
            block
            :disabled="!Object.values(selected).some(Boolean)"
            @click="onTriggerExport">
            <v-icon aria-hidden="true">
              mdi-export
            </v-icon>{{ t('LabelExport') }}
          </v-btn>
        </v-card-text>
      </v-container>
    </v-card>
    <v-card
      class="options mt-3 mb-9">
      <v-container class="pa-5">
        <v-card-title
          role="heading"
          aria-level="2">
          {{ t("LabelImport") }}
        </v-card-title>
        <v-card-text>
          <p>{{ t("DescriptionImport") }}</p>
          <input
            ref="filePicker"
            type="file"
            class="d-none"
            accept="application/json"
            @change="onFileSelect">
          <v-btn
            block
            @click="onTriggerFilePicker">
            <v-icon aria-hidden="true">
              mdi-import
            </v-icon>{{ t('LabelImport') }}
          </v-btn>
        </v-card-text>
      </v-container>
    </v-card>
  </v-container>
</template>

<script>
import PathHelper from '../../lib/PathHelper'
import Vue from 'vue'
import { needsAuthorization } from '../../lib/AccountAuthorization'

export default {
  name: 'ImportExport',
  components: {},
  data() {
    return {
      selected: {}
    }
  },
  computed: {
    accounts() {
      return this.$store.state.accounts
    },
  },
  watch: {
    accounts(newValue, old) {
      if (!old || !Object.keys(old).length) {
        // first time this is set
        for (const id of Object.keys(this.accounts)) {
          Vue.set(this.selected, id, true)
        }
      }
    }
  },
  methods: {
    getFolderName(rootPath) {
      const pathArray = PathHelper.pathToArray(
        rootPath || this.t('LabelRootfolder')
      )
      return pathArray[pathArray.length - 1] || this.t('LabelUntitledfolder')
    },
    async onTriggerExport() {
      try {
        const ids = Object.keys(this.selected).filter(id => Boolean(this.selected[id]))
        if (!ids.length) {
          return
        }
        await this.$store.dispatch('EXPORT_ACCOUNTS', ids)
      } catch (e) {
        alert(e.message)
      }
    },
    async onTriggerFilePicker() {
      this.$refs.filePicker.click()
      if (this.isBrowser) {
        await this.$store.dispatch('REQUEST_NETWORK_PERMISSIONS')
      }
    },
    async onFileSelect() {
      const file = this.$refs.filePicker.files[0]
      try {
        const accounts = JSON.parse(await file.text())
        const ids = await this.$store.dispatch('IMPORT_ACCOUNTS', accounts)
        const incomplete = await this.findIncompleteProfile(ids || [])
        if (incomplete) {
          alert(this.t(incomplete.description))
          this.$router.push({
            name: 'ACCOUNT_OPTIONS',
            params: { accountId: incomplete.accountId },
          })
          return
        }
        alert(this.t('LabelImportsuccessful'))
      } catch (e) {
        alert(e.message)
      }
    },

    /**
     * Imported profiles can arrive missing something only the user can supply:
     * a login, which cannot travel in the file, or a local folder, because
     * bookmark ids from another device mean nothing here. Point the user at the
     * first such profile instead of letting them find out through a failed sync.
     */
    async findIncompleteProfile(ids) {
      for (const accountId of ids) {
        const account = this.$store.state.accounts[accountId]
        if (!account) {
          continue
        }
        if (needsAuthorization(account.data)) {
          return { accountId, description: 'DescriptionImportauthorizationneeded' }
        }
        if (this.isBrowser && !(await this.hasLocalFolder(account.data))) {
          return { accountId, description: 'DescriptionImportsyncfolderneeded' }
        }
      }
      return null
    },

    async hasLocalFolder(data) {
      if (data.localRoot === 'tabs') {
        return true
      }
      const BrowserTree = (await import('../../lib/browser/BrowserTree')).default
      return BrowserTree.folderExists(data.localRoot)
    }
  }
}
</script>

<style scoped>
    .options {
        max-width: 600px;
        margin: 0 auto;
    }
</style>
