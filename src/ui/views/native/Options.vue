<template>
  <div>
    <v-app-bar
      app>
      <v-btn
        icon
        @click="$router.back()">
        <v-icon>mdi-arrow-left</v-icon>
      </v-btn>
      <v-app-bar-title>Account Options</v-app-bar-title>
      <v-spacer />
      <v-btn
        color="blue darken-1"
        text
        elevation="1"
        @click="onSave">
        Save
      </v-btn>
    </v-app-bar>
    <v-content>
      <v-form
        v-if="!loading"
        class="mt-3 mb-3">
        <OptionsNextcloudBookmarks
          v-if="data.type === 'nextcloud-folders' || data.type === 'nextcloud-bookmarks'"
          v-bind.sync="data"
          @reset="onReset"
          @delete="onDelete" />
        <OptionsWebdav
          v-if="data.type === 'webdav'"
          v-bind.sync="data"
          @reset="onReset"
          @delete="onDelete" />
        <OptionsFake
          v-if="data.type === 'fake'"
          v-bind.sync="data"
          @reset="onReset"
          @delete="onDelete" />
      </v-form>
    </v-content>
  </div>
</template>

<script>
import OptionsFake from '../../components/OptionsFake'
import OptionsWebdav from '../../components/OptionsWebdav'
import OptionsNextcloudBookmarks from '../../components/OptionsNextcloudBookmarks'
import PathHelper from '../../../lib/PathHelper'

const actions = {}
export default {
  name: 'Options',
  components: { OptionsNextcloudBookmarks, OptionsWebdav, OptionsFake },
  data() {
    return {
      drawer: false,
      folderName: '',
      data: {id: Math.random(), syncing: false, url: 'http://cloud.nextcloud.com', username: 'frank', error: false, type: 'nextcloud-bookmarks'},
      savedData: false,
      deleted: false,
    }
  },
  computed: {
    id() {
      return this.$route.params.accountId
    },
    loading() {
      return false && (!this.$store.state.accounts[this.id] || !this.$store.state.accounts[this.id].data || !Object.keys(this.$store.state.accounts[this.id].data).length)
    },
    localRoot() {
      return this.data ? this.data.localRoot : null
    },
    saved() {
      return this.savedData === JSON.stringify(this.data)
    },
  },
  watch: {
    localRoot() {
      this.updateFolderName()
    },
    loading() {
      // if (this.loading) return
      // this.data = this.$store.state.accounts[this.id].data
    }
  },
  created() {
    this.updateFolderName()
    if (!this.loading) {
      // this.data = this.$store.state.accounts[this.id].data
    }
  },
  methods: {
    async onSave() {
      await this.$store.dispatch(actions.STORE_ACCOUNT, {id: this.id, data: this.data})
      this.savedData = JSON.stringify(this.data)
    },
    async updateFolderName() {
      // const pathArray = PathHelper.pathToArray(decodeURIComponent(
      //  await BrowserTree.getPathFromLocalId(this.localRoot)
      // ))
      // this.folderName = pathArray[pathArray.length - 1]
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

</style>
