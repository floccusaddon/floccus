<template>
  <div>
    <v-navigation-drawer
      v-if="$vuetify.breakpoint.mobile"
      class="pa-5"
      app
      fixed>
      <div class="overline">
        {{ data.type }}
      </div>
      <div class="headline">
        {{ folderName || t('LabelUntitledfolder') }}
      </div>
      <v-list
        dense
        nav>
        <v-list-item
          link
          @click="$vuetify.goTo('#server', {duration: 0.5})">
          <v-list-item-icon>
            <v-icon>mdi-account-box</v-icon>
          </v-list-item-icon>
          <v-list-item-content>
            <v-list-item-title>{{ t('LabelOptionsServerDetails') }}</v-list-item-title>
          </v-list-item-content>
        </v-list-item>
        <v-list-item
          link
          @click="$vuetify.goTo('#folder', {duration: 0.5})">
          <v-list-item-icon>
            <v-icon>mdi-folder-outline</v-icon>
          </v-list-item-icon>
          <v-list-item-content>
            <v-list-item-title>{{ t('LabelOptionsFolderMapping') }}</v-list-item-title>
          </v-list-item-content>
        </v-list-item>
        <v-list-item
          link
          @click="$vuetify.goTo('#sync', {duration: 0.5})">
          <v-list-item-icon>
            <v-icon>mdi-sync-circle</v-icon>
          </v-list-item-icon>
          <v-list-item-content>
            <v-list-item-title>{{ t('LabelOptionsSyncBehavior') }}</v-list-item-title>
          </v-list-item-content>
        </v-list-item>
        <v-list-item
          link
          @click="$vuetify.goTo('#danger', {duration: 0.5})">
          <v-list-item-icon>
            <v-icon>mdi-alert-circle</v-icon>
          </v-list-item-icon>
          <v-list-item-content>
            <v-list-item-title>{{ t('LabelOptionsDangerous') }}</v-list-item-title>
          </v-list-item-content>
        </v-list-item>
      </v-list>
    </v-navigation-drawer>
    <v-card
      v-if="!deleted"
      class="width mt-3"
      :loading="loading">
      <v-container :class="[!$vuetify.breakpoint.mobile && 'pa-5']">
        <v-row>
          <v-col :style="$vuetify.breakpoint.mobile? {display: 'none'} : {width: '250px', 'flex-grow': 0}">
            <div
              :style="{position: 'sticky', top: '20px'}">
              <div class="overline">
                {{ data.type }}
              </div>
              <div class="headline">
                {{ folderName || t('LabelUntitledfolder') }}
              </div>
              <v-list
                dense
                nav>
                <v-list-item
                  link
                  @click="$vuetify.goTo('#server', {duration: 0.5})">
                  <v-list-item-icon>
                    <v-icon>mdi-account-box</v-icon>
                  </v-list-item-icon>
                  <v-list-item-content>
                    <v-list-item-title>{{ t('LabelOptionsServerDetails') }}</v-list-item-title>
                  </v-list-item-content>
                </v-list-item>
                <v-list-item
                  link
                  @click="$vuetify.goTo('#folder', {duration: 0.5})">
                  <v-list-item-icon>
                    <v-icon>mdi-folder-outline</v-icon>
                  </v-list-item-icon>
                  <v-list-item-content>
                    <v-list-item-title>{{ t('LabelOptionsFolderMapping') }}</v-list-item-title>
                  </v-list-item-content>
                </v-list-item>
                <v-list-item
                  link
                  @click="$vuetify.goTo('#sync', {duration: 0.5})">
                  <v-list-item-icon>
                    <v-icon>mdi-sync-circle</v-icon>
                  </v-list-item-icon>
                  <v-list-item-content>
                    <v-list-item-title>{{ t('LabelOptionsSyncBehavior') }}</v-list-item-title>
                  </v-list-item-content>
                </v-list-item>
                <v-list-item
                  link
                  @click="$vuetify.goTo('#danger', {duration: 0.5})">
                  <v-list-item-icon>
                    <v-icon>mdi-alert-circle</v-icon>
                  </v-list-item-icon>
                  <v-list-item-content>
                    <v-list-item-title>{{ t('LabelOptionsDangerous') }}</v-list-item-title>
                  </v-list-item-content>
                </v-list-item>
              </v-list>
            </div>
          </v-col>
          <v-col>
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
            <v-form
              v-if="!loading"
              class="mt-3 mb-3">
              <OptionsNextcloudFolders
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
              <OptionsGit
                v-if="data.type === 'git'"
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
          </v-col>
        </v-row>
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
    <v-navigation-drawer :style="{display: 'none'}" />
  </div>
</template>

<script>
import PathHelper from '../../lib/PathHelper'
import BrowserTree from '../../lib/browser/BrowserTree'
import { actions } from '../store/definitions'
import OptionsNextcloudFolders from '../components/OptionsNextcloudBookmarks'
import OptionsLinkwarden from '../components/OptionsLinkwarden'
import OptionsWebdav from '../components/OptionsWebdav'
import OptionsFake from '../components/OptionsFake'
import OptionsGoogleDrive from '../components/OptionsGoogleDrive'
import OptionsGit from '../components/OptionsGit.vue'

export default {
  name: 'AccountOptions',
  components: { OptionsGit, OptionsGoogleDrive, OptionsFake, OptionsWebdav, OptionsNextcloudFolders, OptionsLinkwarden },
  data() {
    return {
      folderName: '',
      data: {},
      savedData: false,
      deleted: false,
    }
  },
  computed: {
    id() {
      return this.$route.params.accountId
    },
    loading() {
      return !this.$store.state.accounts[this.id] || !this.$store.state.accounts[this.id].data || !Object.keys(this.$store.state.accounts[this.id].data).length
    },
    localRoot() {
      return this.data ? this.data.localRoot : null
    },
    saved() {
      return this.savedData === JSON.stringify(this.data)
    },
    menuComponent() {
      return this.$vuetify.breakpoint.mobile ? 'v-navigation-drawer' : 'div'
    }
  },
  watch: {
    localRoot() {
      this.updateFolderName()
    },
    loading() {
      if (this.loading) return
      this.data = this.$store.state.accounts[this.id].data
    }
  },
  created() {
    this.updateFolderName()
    if (!this.loading) {
      this.data = this.$store.state.accounts[this.id].data
    }
  },
  methods: {
    async onSave() {
      await this.$store.dispatch(actions.STORE_ACCOUNT, {id: this.id, data: this.data})
      this.savedData = JSON.stringify(this.data)
    },
    async updateFolderName() {
      const pathArray = PathHelper.pathToArray(decodeURIComponent(
        await BrowserTree.getPathFromLocalId(this.localRoot)
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

<style>
    .width {
        max-width: 850px;
        margin: 0 auto;
    }
    .v-form .v-icon {
      margin-right: 10px;
    }

    .text-h6 {
      margin-top: 20px;
    }
</style>
