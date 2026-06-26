<template>
  <div class="native-scroll-container">
    <v-app-bar
      fixed
      app>
      <v-app-bar-title
        role="heading"
        aria-level="1">{{ t('LabelAddbookmark') }}</v-app-bar-title>
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
      <v-progress-circular
        v-if="loading"
        indeterminate
        color="blue darken-1"
        class="loading" />
      <v-card
        v-else
        class="mt-2"
        style="min-height: 95vh">
        <v-card-text>
          <v-select
            dense
            :value="id"
            item-text="label"
            item-value="id"
            :items="accounts"
            @change="$router.push({name: routes.ADD_BOOKMARK, params: {url, accountId: $event}})">
            <template #prepend-inner>
              <v-icon aria-hidden="true">{{ account.data.type | accountIcon }}</v-icon>
            </template>
            <template #item="{item}">
              <v-icon aria-hidden="true">{{ item.data.type | accountIcon }}</v-icon> {{ item.label }}
            </template>
          </v-select>
          <v-alert
            v-if="exists"
            dense
            outlined
            text
            type="info"
            class="mb-2">
            {{ t('DescriptionBookmarkexists') }}
          </v-alert>
          <v-text-field
            v-model="title"
            :label="t('LabelTitle')"
            hide-details />
          <v-text-field
            v-model="url"
            :error="Boolean(urlError)"
            :error-messages="urlError"
            :label="t('LabelLink')" />
          <v-text-field
            v-model="parentTitle"
            readonly
            :label="t('LabelParentfolder')"
            @click="onTriggerFolderChooser">
            <template #append>
              <v-icon
                color="blue darken-1"
                aria-hidden="true"
                @click="onTriggerFolderChooser">
                mdi-folder
              </v-icon>
            </template>
          </v-text-field>
        </v-card-text>
      </v-card>
    </v-main>
    <DialogChooseFolder
      v-if="tree"
      v-model="temporaryParent"
      :display.sync="displayFolderChooser"
      :tree="tree" />
  </div>
</template>

<script>
import { routes } from '../../NativeRouter'
import { actions } from '../../store/definitions'
import { Bookmark, ItemType } from '../../../lib/Tree'
import DialogChooseFolder from '../../components/native/DialogChooseFolder'
import { SendIntent } from 'send-intent'

export default {
  name: 'AddBookmarkIntent',
  components: { DialogChooseFolder },
  filters: {
    accountIcon(type) {
      const icons = {
        'google-drive': 'mdi-google-drive',
        'dropbox': 'mdi-dropbox',
        'nextcloud-bookmarks': 'mdi-cloud',
        'webdav': 'mdi-folder-network',
        'git': 'mdi-source-repository',
      }
      return icons[type]
    },
  },
  data() {
    return {
      url: this.$route.params.url,
      urlError: this.checkUrl(this.$route.params.url),
      title: this.$route.params.title || '',
      temporaryParent: null,
      displayFolderChooser: false,
    }
  },
  computed: {
    id() {
      return this.$route.params.accountId
    },
    account() {
      return this.$store.state.accounts[this.id]
    },
    accounts() {
      return Object.values(this.$store.state.accounts)
    },
    originalUrl() {
      return this.$route.params.url
    },
    loading() {
      return (!this.$store.state.accounts[this.id] || !this.$store.state.accounts[this.id].data || !Object.keys(this.$store.state.accounts[this.id].data).length)
    },
    routes() {
      return routes
    },
    tree() {
      return this.$store.state.tree
    },
    parentTitle() {
      if (this.temporaryParent === null) {
        return ''
      }
      const folder = this.tree.findFolder(this.temporaryParent)
      return folder ? folder.title || this.t('LabelUntitledfolder') : ''
    },
    exists() {
      return !this.loading && this.tree && this.tree.findItemFilter(ItemType.BOOKMARK, (bm) => bm.url === this.url)
    }
  },
  watch: {
    loading() {
      if (this.loading) return
      this.data = this.$store.state.accounts[this.id].data
    },
    id() {
      this.$store.dispatch(actions.LOAD_TREE, this.id)
    },
    url() {
      this.urlError = this.checkUrl(this.url)
    },
    tree() {
      const parentFolder = this.tree.findFolder(this.$store.state.lastFolders[this.id]) || this.tree.findFolder(this.tree.id)
      this.temporaryParent = parentFolder.id
    },
  },
  created() {
    if (!this.loading) {
      this.data = this.$store.state.accounts[this.id].data
    }
    if (this.tree) {
      const parentFolder = this.tree.findFolder(this.$store.state.lastFolders[this.id]) || this.tree.findFolder(this.tree.id)
      this.temporaryParent = parentFolder.id
    } else {
      this.$store.dispatch(actions.LOAD_TREE, this.id)
    }
  },
  methods: {
    async onSave() {
      if (!this.tree.findFolder(this.temporaryParent) || this.urlError) {
        return
      }
      await this.$store.dispatch(actions.CREATE_BOOKMARK, {
        accountId: this.id,
        bookmark: new Bookmark({ id: null, parentId: this.temporaryParent, title: this.title, url: this.url })
      })
      SendIntent.finish()
      await this.$router.push({name: routes.TREE, params: {accountId: this.id}})
    },
    onTriggerFolderChooser() {
      this.displayFolderChooser = true
    },
    checkUrl(url) {
      try {
        // eslint-disable-next-line
        new URL(url)
        return null
      } catch (e) {
        return 'Invalid URL'
      }
    }
  }
}
</script>

<style scoped>
.loading {
  margin: 40vh 40vw;
}
</style>
