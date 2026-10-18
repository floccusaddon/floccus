<template>
  <div class="native-scroll-container">
    <v-app-bar
      fixed
      app>
      <v-app-bar-title
        role="heading"
        aria-level="1">
        {{ t('LabelAddbookmark') }}
      </v-app-bar-title>
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
            @change="$router.push({name: routes.ADD_BOOKMARK, params: {url, accountId: $event}, query: $route.query})">
            <template #prepend-inner>
              <v-icon aria-hidden="true">
                {{ account.data.type | accountIcon }}
              </v-icon>
            </template>
            <template #item="{item}">
              <v-icon aria-hidden="true">
                {{ item.data.type | accountIcon }}
              </v-icon> {{ item.label }}
            </template>
          </v-select>
          <template v-if="items.length">
            <v-text-field
              v-for="item in items"
              :key="item.url"
              v-model="item.title"
              :label="t('LabelTitle')"
              :loading="item.fetchingTitle"
              :hint="item.url"
              persistent-hint
              class="mb-2">
              <template #append>
                <v-icon
                  v-if="item.exists"
                  color="blue darken-1"
                  :title="t('DescriptionBookmarkexists')"
                  :aria-label="t('DescriptionBookmarkexists')">
                  mdi-bookmark-check
                </v-icon>
              </template>
              <template #append-outer>
                <v-icon
                  v-if="items.length > 1"
                  :title="t('LabelRemove')"
                  :aria-label="t('LabelRemove')"
                  @click="onRemoveItem(item)">
                  mdi-close
                </v-icon>
              </template>
            </v-text-field>
          </template>
          <template v-else>
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
              :loading="fetchingTitle"
              hide-details />
            <v-text-field
              v-model="url"
              :error="Boolean(urlError)"
              :error-messages="urlError"
              :label="t('LabelLink')" />
          </template>
          <v-combobox
            v-if="supportsTags"
            v-model="tags"
            :items="allTags"
            :label="t('LabelTags')"
            :hint="t('DescriptionTags')"
            persistent-hint
            multiple
            chips
            deletable-chips
            small-chips
            hide-selected
            prepend-inner-icon="mdi-tag-multiple" />
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
      v-if="folderTree"
      v-model="temporaryParent"
      :display.sync="displayFolderChooser"
      :folder-tree="folderTree" />
  </div>
</template>

<script>
import { routes } from '../../NativeRouter'
import { actions } from '../../store/definitions'
import { Bookmark } from '../../../lib/Tree'
import DialogChooseFolder from '../../components/native/DialogChooseFolder'
import { SendIntent } from '@mindlib-capacitor/send-intent'
import { CapacitorHttp as Http } from '@capacitor/core'
import Logger from '../../../lib/Logger'

// Waiting longer than this for an unresponsive site isn't worth it: the user
// can type a title themselves in the meantime
const TITLE_FETCH_TIMEOUT = 3000

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
      tags: [],
      temporaryParent: null,
      displayFolderChooser: false,
      exists: false,
      allTags: [],
      fetchingTitle: false,
      // Several URLs shared at once, e.g. tabs from Firefox for Android
      items: this.sharedItems(),
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
    folderTree() {
      return this.$store.state.folderTree
    },
    parentTitle() {
      if (this.temporaryParent === null) {
        return ''
      }
      const folder = this.folderTree.findFolder(this.temporaryParent)
      return folder ? folder.title || this.t('LabelUntitledfolder') : ''
    },
    sharedUrlsKey() {
      return [].concat(this.$route.query.urls || []).join('\n')
    },
    supportsTags() {
      return Boolean(this.$store.state.tagSupport[this.id])
    },
  },
  watch: {
    loading() {
      if (this.loading) return
      this.data = this.$store.state.accounts[this.id].data
    },
    id() {
      this.$store.dispatch(actions.LOAD_FOLDERS, this.id)
    },
    async url() {
      this.urlError = this.checkUrl(this.url)
      await this.checkExists()
    },
    async folderTree() {
      const parentFolder = this.folderTree.findFolder(this.$store.state.lastFolders[this.id]) || this.folderTree.findFolder(this.folderTree.id)
      this.temporaryParent = parentFolder.id
      await Promise.all([this.loadAllTags(), this.checkExists()])
    },
    // A string, because switching accounts hands us a copy of the same list
    sharedUrlsKey() {
      this.items = this.sharedItems()
      this.items.forEach((item) => this.fetchItemTitle(item))
      this.checkExists()
    },
  },
  created() {
    if (this.items.length) {
      this.items.forEach((item) => this.fetchItemTitle(item))
    } else if (!this.title && !this.urlError) {
      this.fetchTitle(this.url)
    }
    if (!this.loading) {
      this.data = this.$store.state.accounts[this.id].data
    }
    if (this.folderTree) {
      const parentFolder = this.folderTree.findFolder(this.$store.state.lastFolders[this.id]) || this.folderTree.findFolder(this.folderTree.id)
      this.temporaryParent = parentFolder.id
      // The folders may still be the previous account's, so ask about this one
      this.$store.dispatch(actions.LOAD_TAG_SUPPORT, this.id)
      this.loadAllTags()
      this.checkExists()
    } else {
      this.$store.dispatch(actions.LOAD_FOLDERS, this.id)
    }
  },
  methods: {
    sharedItems() {
      const urls = [].concat(this.$route.query.urls || [])
      if (urls.length < 2) {
        return []
      }
      return urls.map((url) => ({ url, title: '', fetchingTitle: false, exists: false }))
    },
    onRemoveItem(item) {
      this.items = this.items.filter((i) => i !== item)
    },
    async onSave() {
      if (!this.folderTree.findFolder(this.temporaryParent)) {
        return
      }
      if (this.items.length) {
        await this.$store.dispatch(actions.CREATE_BOOKMARKS, {
          accountId: this.id,
          bookmarks: this.items.map((item) => this.newBookmark(item.title, item.url)),
        })
        SendIntent.finish()
        return
      }
      if (this.urlError) {
        return
      }
      await this.$store.dispatch(actions.CREATE_BOOKMARK, {
        accountId: this.id,
        bookmark: this.newBookmark(this.title, this.url),
      })
      SendIntent.finish()
    },
    newBookmark(title, url) {
      return new Bookmark({
        id: null,
        parentId: this.temporaryParent,
        title,
        url,
        ...(this.supportsTags && {
          tags: this.tags.map((tag) => String(tag).trim()).filter(Boolean),
        }),
      })
    },
    async fetchItemTitle(item) {
      item.fetchingTitle = true
      const title = await this.loadTitle(item.url)
      item.fetchingTitle = false
      // Don't overwrite what the user has entered while we were waiting
      if (title && !item.title) {
        item.title = title
      }
    },
    async fetchTitle(url) {
      this.fetchingTitle = true
      const title = await this.loadTitle(url)
      this.fetchingTitle = false
      // Don't overwrite what the user has entered while we were waiting
      if (title && !this.title && url === this.url) {
        this.title = title
      }
    },
    async loadTitle(url) {
      let title = ''
      try {
        const response = await Http.get({
          url,
          headers: {
            'user-agent': 'curl/8.6.0',
          },
          connectTimeout: TITLE_FETCH_TIMEOUT,
          readTimeout: TITLE_FETCH_TIMEOUT,
        })
        const parser = new DOMParser()
        const document = parser.parseFromString(response.data, 'text/html')
        const titleElement = document.getElementsByTagName('title')[0]
        if (titleElement) {
          title = titleElement.textContent.trim()
        }
      } catch (e) {
        Logger.log('Failed to fetch shared URL')
      }
      return title
    },
    onTriggerFolderChooser() {
      this.displayFolderChooser = true
    },
    async loadAllTags() {
      const tags = await this.$store.dispatch(actions.LOAD_TAGS, {
        accountId: this.id,
        folderId: null,
      })
      this.allTags = tags.sort((tag1, tag2) => tag1.localeCompare(tag2))
    },
    async checkExists() {
      if (this.items.length) {
        await Promise.all(this.items.map(async(item) => {
          item.exists = Boolean(await this.$store.dispatch(actions.FIND_BOOKMARK_BY_URL, {
            accountId: this.id,
            url: item.url,
          }))
        }))
        return
      }
      const url = this.url
      const found = await this.$store.dispatch(actions.FIND_BOOKMARK_BY_URL, {
        accountId: this.id,
        url,
      })
      // The field is editable while we're querying
      if (url === this.url) {
        this.exists = Boolean(found)
      }
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
