<template>
  <div>
    <v-app-bar
      app
      absolute>
      <v-btn
        icon
        :to="{name: routes.TREE, params: {accountId: id}}">
        <v-icon>mdi-arrow-left</v-icon>
      </v-btn>
      <v-app-bar-title>{{ t('LabelOptions') }}</v-app-bar-title>
      <v-spacer />
      <v-btn
        color="blue darken-1"
        text
        elevation="1"
        @click="onSave">
        {{ t('LabelSave') }}
      </v-btn>
    </v-app-bar>
    <v-main>
      <v-form
        v-if="!loading"
        class="mt-3 mb-3">
        <OptionsNextcloudBookmarks
          v-if="data.type === 'nextcloud-folders' || data.type === 'nextcloud-bookmarks'"
          v-bind.sync="data"
          @reset="onReset"
          @delete="onDelete" />
        <OptionsLinkwarden
          v-if="data.type === 'linkwarden'"
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
        <OptionsGoogleDrive
          v-if="data.type === 'google-drive'"
          v-bind.sync="data"
          @reset="onReset"
          @delete="onDelete" />
        <OptionsGit
          v-if="data.type === 'git'"
          v-bind.sync="data"
          @reset="onReset"
          @delete="onDelete" />
      </v-form>
    </v-main>
  </div>
</template>

<script>
import OptionsFake from '../../components/OptionsFake'
import OptionsWebdav from '../../components/OptionsWebdav'
import OptionsNextcloudBookmarks from '../../components/OptionsNextcloudBookmarks'
import { actions } from '../../store/definitions'
import { routes } from '../../NativeRouter'
import OptionsGoogleDrive from '../../components/OptionsGoogleDrive'
import OptionsGit from '../../components/OptionsGit.vue'
import OptionsLinkwarden from '../../components/OptionsLinkwarden.vue'

export default {
  name: 'Options',
  components: { OptionsLinkwarden, OptionsGit, OptionsGoogleDrive, OptionsNextcloudBookmarks, OptionsWebdav, OptionsFake },
  data() {
    return {
      drawer: false,
      folderName: '',
      data: null,
      savedData: false,
      deleted: false,
    }
  },
  computed: {
    id() {
      return this.$route.params.accountId
    },
    loading() {
      return (!this.$store.state.accounts[this.id] || !this.$store.state.accounts[this.id].data || !Object.keys(this.$store.state.accounts[this.id].data).length)
    },
    localRoot() {
      return this.data ? this.data.localRoot : null
    },
    saved() {
      return this.savedData === JSON.stringify(this.data)
    },
    routes() {
      return routes
    }
  },
  watch: {
    loading() {
      if (this.loading) return
      this.data = this.$store.state.accounts[this.id].data
    }
  },
  created() {
    if (!this.loading) {
      this.data = this.$store.state.accounts[this.id].data
    }
  },
  backButton() {
    this.$router.push({name: this.routes.TREE, params: {accountId: this.id}})
  },
  methods: {
    async onSave() {
      await this.$store.dispatch(actions.STORE_ACCOUNT, {id: this.id, data: this.data})
      this.savedData = JSON.stringify(this.data)
      await this.$router.push({name: routes.TREE, params: {accountId: this.id}})
    },
    async onDelete() {
      await this.$store.dispatch(actions.DELETE_ACCOUNT, this.id)
      this.deleted = true
      this.$router.push({name: routes.HOME})
    },
    async onReset() {
      await this.$store.dispatch(actions.RESET_ACCOUNT, this.id)
    }
  }
}
</script>

<style>
.text-h6 {
  margin-top: 20px;
}
</style>
