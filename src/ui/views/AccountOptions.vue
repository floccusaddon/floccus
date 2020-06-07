<template>
  <v-container>
    <v-card
      v-if="!deleted"
      class="width mt-3"
      :loading="loading">
      <v-container class="pa-5">
        <div class="overline">
          {{ accountState.data.type }}
        </div>
        <div class="headline">
          {{ folderName || t('LabelUntitledfolder') }}
        </div>
        <v-form
          v-if="!loading"
          class="mt-3 mb-3">
          <OptionsNextcloudFolders
            v-if="accountState.data.type === 'nextcloud-folders'"
            v-model="accountState.data"
            @reset="onReset"
            @delete="onDelete" />
          <OptionsWebdav
            v-if="accountState.data.type === 'webdav'"
            v-model="accountState.data"
            @reset="onReset"
            @delete="onDelete" />
          <OptionsNextcloudLegacy
            v-if="accountState.data.type === 'nextcloud' || accountState.data.type === 'nextcloud-legacy'"
            v-model="accountState.data"
            @reset="onReset"
            @delete="onDelete" />
          <OptionsFake
            v-if="accountState.data.type === 'fake'"
            v-model="accountState.data"
            @reset="onReset"
            @delete="onDelete" />
        </v-form>
        <div class="d-flex flex-row-reverse">
          <v-btn
            class="primary"
            @click="onSave">
            {{ t('LabelSave') }}
          </v-btn>
          <v-icon
            v-if="saved"
            color="green">
            mdi-check
          </v-icon>
        </div>
      </v-container>
    </v-card>
    <v-dialog
      v-model="deleted"
      :max-width="600"
      persistent>
      <v-card>
        <v-card-title>{{ t('LabelAccountDeleted') }}</v-card-title>
        <v-card-text>{{ t('DescriptionAccountDeleted') }}</v-card-text>
      </v-card>
    </v-dialog>
  </v-container>
</template>

<script>
import PathHelper from '../../lib/PathHelper'
import LocalTree from '../../lib/LocalTree'
import { actions } from '../store'
import OptionsNextcloudFolders from '../components/OptionsNextcloudFolders'
import OptionsWebdav from '../components/OptionsWebdav'
import OptionsNextcloudLegacy from '../components/OptionsNextcloudLegacy'
import OptionsFake from '../components/OptionsFake'

export default {
  name: 'AccountOptions',
  components: { OptionsFake, OptionsNextcloudLegacy, OptionsWebdav, OptionsNextcloudFolders },
  data() {
    return {
      folderName: '',
      savedData: false,
      deleted: false,
    }
  },
  computed: {
    id() {
      return this.$route.params.accountId
    },
    loading() {
      return !Object.keys(this.$store.state.accounts).length || !this.accountState.data || !Object.keys(this.accountState.data).length
    },
    accountState() {
      return this.$store.state.accounts[this.id] || {}
    },
    localRoot() {
      return this.accountState.data.localRoot
    },
    saved() {
      return this.savedData === JSON.stringify(this.accountState.data)
    }
  },
  watch: {
    localRoot() {
      this.updateFolderName()
    },
  },
  created() {
    this.updateFolderName()
  },
  methods: {
    async onSave() {
      await this.$store.dispatch(actions.STORE_ACCOUNT, {id: this.id, data: this.accountState.data})
      this.savedData = JSON.stringify(this.accountState.data)
    },
    async updateFolderName() {
      const pathArray = PathHelper.pathToArray(decodeURIComponent(
        await LocalTree.getPathFromLocalId(this.localRoot)
      ))
      this.folderName = pathArray[pathArray.length - 1]
    },
    async onDelete() {
      await this.$store.dispatch(actions.DELETE_ACCOUNT, this.id)
      this.deleted = true
    },
    async onReset() {
      await this.$store.dispatch(actions.RESET_ACCOUNT, this.id)
    }
  }
}
</script>

<style scoped>
    .width {
        max-width: 600px;
        margin: 0 auto;
    }
</style>
