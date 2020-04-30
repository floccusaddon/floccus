<template>
  <v-container>
    <v-card
      v-if="!deleted"
      class="width mt-3"
      :loading="loading">
      <v-container class="pa-5">
        <div class="overline">
          {{ data.type }}
        </div>
        <div class="headline">
          {{ folderName || t('LabelUntitledfolder') }}
        </div>
        <v-form
          v-if="!loading"
          class="mt-3 mb-3">
          <OptionsNextcloudFolders
            v-if="data.type === 'nextcloud-folders'"
            :account="data"
            @reset="onReset"
            @delete="onDelete" />
          <OptionsWebdav
            v-if="data.type === 'webdav'"
            :account="data"
            @reset="onReset"
            @delete="onDelete" />
          <OptionsNextcloudLegacy
            v-if="data.type === 'nextcloud' || data.type === 'nextcloud-legacy'"
            :account="data"
            @reset="onReset"
            @delete="onDelete" />
          <OptionsFake
            v-if="data.type === 'fake'"
            :account="data"
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
      return !Object.keys(this.$store.state.accounts).length
    },
    data() {
      if (!this.$store.state.accounts[this.id]) return {}
      return this.$store.state.accounts[this.id].data
    },
    localRoot() {
      return this.data.localRoot
    },
    saved() {
      return this.savedData === JSON.stringify(this.data)
    }
  },
  watch: {
    localRoot() {
      this.updateFolderName()
    }
  },
  created() {
    this.updateFolderName()
  },
  methods: {
    async onSave() {
      await this.$store.dispatch(actions.STORE_ACCOUNT, {id: this.id, data: this.data})
      this.savedData = JSON.stringify(this.data)
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
