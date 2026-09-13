<template>
  <div class="native-scroll-container">
    <Drawer :visible.sync="drawer" />
    <v-app-bar
      fixed
      app>
      <v-app-bar-nav-icon
        v-if="!folderTree || currentFolderId === folderTree.id"
        class="mr-2 ml-n2"
        @click="drawer = !drawer" />
      <v-btn
        v-else
        icon
        class="mr-2 ml-n2"
        :aria-label="t('LabelBack')"
        @click="goBack">
        <v-icon aria-hidden="true">
          mdi-arrow-left
        </v-icon>
      </v-btn>
      <v-spacer />
      <template v-if="searchQuery">
        <v-progress-circular
          v-if="searching"
          color="white"
          :size="20"
          indeterminate />
        <v-icon
          v-else
          aria-hidden="true">
          mdi-magnify
        </v-icon>
      </template>
      <v-text-field
        :value="searchQuery"
        :label="
          !folderTree || currentFolderId === folderTree.id
            ? t('LabelSearch')
            : t('LabelSearchfolder', [currentFolder.title])
        "
        solo
        flat
        dense
        clearable
        hide-details
        @input="onSearch" />
      <v-btn
        v-if="!searchQuery"
        icon
        :aria-label="t('LabelSyncnow')"
        :disabled="Boolean(syncing) || Boolean(scheduled) || !currentAccount"
        @click="onTriggerSync">
        <v-icon
          aria-hidden="true"
          :class="{ 'sync--active': Boolean(syncing) }">
          {{ scheduled ? 'mdi-timer-sync-outline' : 'mdi-sync' }}
        </v-icon>
      </v-btn>
      <v-menu
        v-if="!searchQuery"
        bottom
        offset-y
        left>
        <template #activator="{ on, attrs }">
          <v-btn
            icon
            :aria-label="t('LabelSortby')"
            v-bind="attrs"
            v-on="on">
            <v-icon aria-hidden="true">
              {{ sortIcons[sortBy] }}
            </v-icon>
          </v-btn>
        </template>

        <v-list>
          <v-list-item @click="sortBy = 'title'">
            <v-list-item-avatar>
              <v-icon aria-hidden="true">
                {{ sortIcons['title'] }}
              </v-icon>
            </v-list-item-avatar>
            <v-list-item-title>
              {{ t('LabelSorttitle') }}
            </v-list-item-title>
          </v-list-item>
          <v-list-item @click="sortBy = 'url'">
            <v-list-item-avatar>
              <v-icon aria-hidden="true">
                {{ sortIcons['url'] }}
              </v-icon>
            </v-list-item-avatar>
            <v-list-item-title>
              {{ t('LabelSorturl') }}
            </v-list-item-title>
          </v-list-item>
          <v-list-item @click="sortBy = 'index'">
            <v-list-item-avatar>
              <v-icon aria-hidden="true">
                {{ sortIcons['index'] }}
              </v-icon>
            </v-list-item-avatar>
            <v-list-item-title>
              {{ t('LabelSortcustom') }}
            </v-list-item-title>
          </v-list-item>
        </v-list>
      </v-menu>
      <v-menu
        v-if="!searchQuery"
        bottom
        offset-y
        left>
        <template #activator="{ on, attrs }">
          <v-btn
            icon
            :aria-label="t('LabelMoreactions')"
            v-bind="attrs"
            v-on="on">
            <v-icon aria-hidden="true">
              mdi-dots-vertical
            </v-icon>
          </v-btn>
        </template>

        <v-list>
          <v-list-item
            @click="
              $router.push({
                name: routes.ACCOUNT_OPTIONS,
                params: { accountId: currentAccount ? currentAccount.id : 0 },
              })
            ">
            <v-list-item-avatar>
              <v-icon aria-hidden="true">
                mdi-cog
              </v-icon>
            </v-list-item-avatar>
            <v-list-item-title>{{ t('LabelOptions') }}</v-list-item-title>
          </v-list-item>
          <v-list-item
            :disabled="
              Boolean(syncing) || Boolean(scheduled) || !currentAccount
            "
            @click="onTriggerSync('up')">
            <v-list-item-avatar>
              <v-icon aria-hidden="true">
                mdi-arrow-up-bold
              </v-icon>
            </v-list-item-avatar>
            <v-list-item-title>{{ t('LabelSyncUpOnce') }}</v-list-item-title>
          </v-list-item>
          <v-list-item
            :disabled="
              Boolean(syncing) || Boolean(scheduled) || !currentAccount
            "
            @click="onTriggerSync('down')">
            <v-list-item-avatar>
              <v-icon aria-hidden="true">
                mdi-arrow-down-bold
              </v-icon>
            </v-list-item-avatar>
            <v-list-item-title>
              {{ t('LabelSyncDownOnce') }}
            </v-list-item-title>
          </v-list-item>
        </v-list>
      </v-menu>
    </v-app-bar>
    <v-main>
      <v-progress-linear
        v-if="syncProgress"
        fixed
        :value="syncProgress * 100 || 0"
        color="blue darken-1" />
      <v-card v-if="breadcrumbs.length > 1 || numAccounts > 1">
        <Breadcrumbs
          v-if="breadcrumbs.length > 1"
          :folder-tree="folderTree"
          :items="breadcrumbs"
          @click="currentFolderId = $event" />
        <v-card-text v-else>
          <v-icon aria-hidden="true">
            mdi-home
          </v-icon>
          {{ currentAccount ? currentAccount.label : '' }}
        </v-card-text>
      </v-card>
      <template v-if="folderTags.length">
        <v-sheet
          class="tag-bar px-2 py-2"
          role="group"
          :aria-label="t('LabelTags')">
          <v-chip
            v-for="tag in folderTags"
            :key="tag"
            class="tag-bar__chip mr-2"
            small
            label
            color="blue darken-1"
            :dark="isActiveTag(tag)"
            :outlined="!isActiveTag(tag)"
            :aria-label="t('LabelSearchbytag', [tag])"
            :aria-pressed="String(isActiveTag(tag))"
            @click="toggleTagSearch(tag)">
            {{ tag }}
          </v-chip>
        </v-sheet>
        <v-divider />
      </template>
      <v-alert
        v-if="Boolean(syncError)"
        dense
        outlined
        text
        type="warning"
        class="ma-1">
        {{ syncError }}
      </v-alert>
      <v-alert
        v-if="scheduled"
        dense
        outlined
        text
        type="info"
        class="ma-1">
        {{ t('DescriptionSyncscheduled') }}
        <v-btn
          color="info"
          class="float-right"
          x-small
          @click="onForceSync">
          {{ t('LabelScheduledforcesync') }}
        </v-btn>
      </v-alert>
      <v-progress-circular
        v-if="loading"
        indeterminate
        color="blue darken-1"
        class="loading" />
      <v-list
        v-else-if="currentFolder && items && items.length"
        two-line
        :class="{
          'pb-10': true,
          'list-full-height': !(
            searchQuery &&
            otherSearchItems &&
            otherSearchItems.length
          ),
        }">
        <template v-for="item in items">
          <Item
            :key="item.type + item.id"
            :show-folder-path="!!searchQuery"
            :item="item"
            @click="clickItem(item)"
            @share="shareBookmark(item)"
            @edit="editItem(item)"
            @tag="searchByTag($event)"
            @delete="deleteItem(item)" />
          <v-divider :key="String(item.id) + item.type + 'divider'" />
        </template>
      </v-list>
      <v-card
        v-else-if="!searching"
        flat
        tile
        :style="{
          height: '100%',
          width: '100vw',
          padding: '10vh auto',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
        }">
        <img
          src="icons/tree-swing.svg"
          alt=""
          :style="{ width: '95%', maxHeight: '40vh' }">
        <h3 class="text-center headline mt-5">
          {{ t('LabelNobookmarks') }}
        </h3>
      </v-card>
      <v-card class="pt-5">
        <v-list-item
          v-if="searchQuery && otherSearchItems && otherSearchItems.length">
          <v-list-item-avatar>
            <v-icon aria-hidden="true">
              mdi-select-search
            </v-icon>
          </v-list-item-avatar>
          {{ t('LabelSearchresultsotherfolders') }}
        </v-list-item>
      </v-card>
      <v-list
        v-if="searchQuery && otherSearchItems && otherSearchItems.length"
        two-line
        class="list-full-height">
        <template v-for="item in otherSearchItems">
          <Item
            :key="item.type + item.id"
            :show-folder-path="!!searchQuery"
            :item="item"
            @click="clickItem(item)"
            @share="shareBookmark(item)"
            @edit="editItem(item)"
            @tag="searchByTag($event)"
            @delete="deleteItem(item)" />
          <v-divider :key="String(item.id) + item.type + 'divider'" />
        </template>
      </v-list>
      <v-speed-dial
        v-model="fab"
        fixed
        bottom
        right>
        <template #activator>
          <v-btn
            v-model="fab"
            color="blue darken-1"
            dark
            fab
            :aria-label="t('LabelAdd')">
            <v-icon
              v-if="fab"
              aria-hidden="true">
              mdi-close
            </v-icon>
            <v-icon
              v-else
              aria-hidden="true">
              mdi-plus
            </v-icon>
          </v-btn>
        </template>
        <v-btn
          color="blue darken-1"
          dark
          small
          fab
          :aria-label="t('LabelAddfolder')"
          @click="addFolder">
          <v-icon aria-hidden="true">
            mdi-folder
          </v-icon>
        </v-btn>
        <v-btn
          color="blue darken-1"
          dark
          small
          fab
          :aria-label="t('LabelAddbookmark')"
          @click="addBookmark">
          <v-icon aria-hidden="true">
            mdi-star
          </v-icon>
        </v-btn>
        <v-btn
          color="blue darken-1"
          dark
          small
          fab
          :aria-label="t('LabelImportbookmarks')"
          @click="importBookmarks">
          <v-icon aria-hidden="true">
            mdi-import
          </v-icon>
        </v-btn>
      </v-speed-dial>
    </v-main>

    <DialogEditBookmark
      v-if="isAddingBookmark"
      :is-new="true"
      :display.sync="isAddingBookmark"
      :folder-tree="folderTree"
      :parent-folder="currentFolderId"
      :supports-tags="supportsTags"
      :tag-suggestions="allTags"
      @save="createBookmark($event)" />
    <DialogEditFolder
      v-if="isAddingFolder"
      :is-new="true"
      :display.sync="isAddingFolder"
      :folder-tree="folderTree"
      :parent-folder="currentFolderId"
      @save="createFolder($event)" />
    <DialogEditBookmark
      v-if="isEditingBookmark"
      :is-new="false"
      :bookmark="currentlyEditedBookmark"
      :folder-tree="folderTree"
      :display.sync="isEditingBookmark"
      :supports-tags="supportsTags"
      :tag-suggestions="allTags"
      @save="editBookmark($event)" />
    <DialogEditFolder
      v-if="isEditingFolder"
      :is-new="false"
      :folder="currentlyEditedFolder"
      :display.sync="isEditingFolder"
      :folder-tree="folderTree"
      @save="editFolder($event)" />
    <DialogImportBookmarks
      v-if="isImportingBookmarks"
      :parent-folder="currentFolderId"
      :display.sync="isImportingBookmarks"
      :account-id="id" />
  </div>
</template>

<script>
import Drawer from '../../components/native/Drawer'
import DialogEditFolder from '../../components/native/DialogEditFolder'
import DialogEditBookmark from '../../components/native/DialogEditBookmark'
import { routes } from '../../NativeRouter'
import { Bookmark, Folder } from '../../../lib/Tree'
import { actions } from '../../store/definitions'
import { App } from '@capacitor/app'
import sortBy from 'lodash/sortBy'
import DialogImportBookmarks from '../../components/native/DialogImportBookmarks'
import Breadcrumbs from '../../components/native/Breadcrumbs.vue'
import Item from '../../components/native/Item.vue'
import { formatSearchToken, parseSearchQuery } from '../../../lib/native/NativeTreeQuery'

export default {
  name: 'Tree',
  components: {
    Item,
    Breadcrumbs,
    DialogImportBookmarks,
    DialogEditBookmark,
    DialogEditFolder,
    Drawer,
  },
  data() {
    return {
      currentFolderId: 0,
      drawer: false,
      searchQuery: '',
      isEditingFolder: false,
      currentlyEditedFolder: null,
      isEditingBookmark: false,
      currentlyEditedBookmark: null,
      isAddingBookmark: false,
      isAddingFolder: false,
      isImportingBookmarks: false,
      fab: false,
      searchDebounceTimer: null,
      sortIcons: {
        title: 'mdi-sort-alphabetical-ascending',
        url: 'mdi-sort-bool-ascending',
        index: 'mdi-sort-ascending',
      },
      sortBy: 'index',
      syncProgress: 0,
      // The current folder's children, queried from the database rather than
      // held in memory as part of a tree (see LOAD_CHILDREN)
      children: [],
      childrenRun: 0,
      otherSearchItems: [],
      searchItems: [],
      searching: false,
      searchRun: 0,
      folderTags: [],
      allTags: [],
    }
  },
  computed: {
    id() {
      return this.$route.params.accountId
    },
    loading() {
      return (
        !this.$store.state.accounts[this.id] ||
        !this.$store.state.accounts[this.id].data ||
        !Object.keys(this.$store.state.accounts[this.id].data).length ||
        !this.folderTree
      )
    },
    numAccounts() {
      return Object.keys(this.$store.state.accounts).length
    },
    /**
     * The account's folders, without any bookmarks in them. Everything else is
     * queried per folder (#loadChildren) or per search (#runSearch).
     */
    folderTree() {
      return this.$store.state.folderTree
    },
    syncing() {
      if (this.loading) {
        return false
      }
      return this.$store.state.accounts[this.id].data.syncing
    },
    scheduled() {
      if (this.loading) {
        return false
      }
      return this.$store.state.accounts[this.id].data.scheduled
    },
    syncError() {
      if (this.loading) {
        return false
      }
      return this.$store.state.accounts[this.id].data.error
    },
    items() {
      if (!this.currentFolder) {
        return []
      }
      if (this.searchQuery) {
        return this.searchItems
      }
      const items = this.children
      if (this.sortBy !== 'index') {
        return sortBy(items, [
          (item) => {
            if (this.sortBy === 'url') {
              if (item.url) {
                try {
                  return new URL(item.url).hostname
                } catch (e) {
                  return item.url.toLowerCase()
                }
              } else {
                return '0000000' + item.title.toLowerCase() // folders to the top
              }
            }
            return item.type === 'folder'
              ? '0000000' + item.title.toLowerCase()
              : item[this.sortBy].toLowerCase()
          },
        ])
      } else {
        return items
      }
    },
    routes() {
      return routes
    },
    currentAccount() {
      return this.$store.state.accounts[this.id]
    },
    currentFolder() {
      return this.findItem(this.currentFolderId, this.folderTree)
    },
    breadcrumbs() {
      return this.getFolderPath(this.currentFolder)
    },
    supportsTags() {
      return Boolean(this.$store.state.tagSupport[this.id])
    },
    /**
     * The tags the current query filters by, lowercased -- a query can name
     * several, and every one of them narrows the results down further.
     */
    activeTags() {
      return parseSearchQuery(this.searchQuery).tags
    },
  },
  watch: {
    async $route() {
      await this.$store.dispatch(
        actions.LOAD_FOLDERS,
        this.$route.params.accountId
      )
      this.sortBy = this.$store.state.accounts[this.id].data.sortBy || 'index'
    },
    async syncing(current, previous) {
      if (!current && previous) {
        this.syncProgress = 1
        setTimeout(() => {
          this.syncProgress = 0
        }, 1000)
      } else {
        this.syncProgress = current
      }
      if (!current) {
        await this.$store.dispatch(
          actions.LOAD_FOLDERS,
          this.$route.params.accountId
        )
      }
    },
    async sortBy(current) {
      await this.$store.dispatch(actions.SET_SORTBY, {
        accountId: this.$route.params.accountId,
        sortBy: current,
      })
    },
    async searchQuery() {
      await this.runSearch()
    },
    async currentFolderId() {
      await Promise.all([this.loadChildren(), this.loadFolderTags()])
    },
    /**
     * A new folder tree means the database changed under us -- after an edit or
     * a sync. Everything we queried from it is stale then: the children we
     * render, the tag bar, and any search results, which hold items of the tree
     * they were collected from.
     */
    async folderTree() {
      await Promise.all([
        this.loadChildren(),
        this.loadFolderTags(),
        this.loadAllTags(),
        this.searchQuery ? this.runSearch() : Promise.resolve(),
      ])
    },
    showSearch(showSearch, previous) {
      if (previous && !showSearch) {
        this.searchItems = []
        this.otherSearchItems = []
      }
    },
  },
  mounted() {
    this.$store.dispatch(actions.LOAD_FOLDERS, this.$route.params.accountId)
    this.sortBy = this.$store.state.accounts[this.id].data.sortBy || 'index'
    App.addListener('resume', () =>
      this.$store.dispatch(
        actions.LOAD_FOLDERS_FROM_DISK,
        this.$route.params.accountId
      )
    )
  },
  backButton() {
    this.goBack()
  },
  methods: {
    async loadChildren() {
      // Navigating on while a query is still running would otherwise show the
      // folder we just left
      const run = ++this.childrenRun
      const children = await this.$store.dispatch(actions.LOAD_CHILDREN, {
        accountId: this.id,
        folderId: this.currentFolderId,
      })
      if (run === this.childrenRun) {
        this.children = children
      }
    },
    /**
     * Tags of everything below the current folder, most used first. That is
     * also what a '#tag' search from here looks through, so every chip shown is
     * guaranteed to find something.
     */
    async loadFolderTags() {
      const run = this.childrenRun
      const tags = await this.$store.dispatch(actions.LOAD_TAGS, {
        accountId: this.id,
        folderId: this.currentFolderId,
      })
      if (run === this.childrenRun) {
        this.folderTags = tags
      }
    },
    async loadAllTags() {
      this.allTags = await this.$store.dispatch(actions.LOAD_TAGS, {
        accountId: this.id,
        folderId: null,
      })
    },
    getFolderPath(item) {
      const folders = [item]
      while (
        this.folderTree &&
        folders[folders.length - 1] &&
        String(folders[folders.length - 1].id) !== String(this.folderTree.id)
      ) {
        folders.push(
          this.findItem(folders[folders.length - 1].parentId, this.folderTree)
        )
      }
      return folders.reverse()
    },
    clickItem(item) {
      if (item.url) {
        this.$store.dispatch(actions.COUNT_BOOKMARK_CLICK, {
          accountId: this.$route.params.accountId,
          bookmark: item,
        })
        window.location = item.url
      } else {
        this.searchQuery = ''
        this.currentFolderId = item.id
      }
    },
    findItem(id, tree) {
      if (!tree) {
        return null
      }
      if (tree.id === id) {
        return tree
      }
      if (tree.url) {
        return false
      }
      return tree.findFolder(id)
    },
    onSearch(query) {
      clearTimeout(this.searchDebounceTimer)
      this.searchDebounceTimer = setTimeout(() => {
        this.searchQuery = query
      }, 500)
    },
    isActiveTag(tag) {
      return this.activeTags.includes(tag.toLowerCase())
    },
    searchByTag(tag) {
      this.setTagSearch(tag, true)
    },
    toggleTagSearch(tag) {
      this.setTagSearch(tag, !this.isActiveTag(tag))
    },
    /**
     * Add a tag to the query or take it out again, leaving the other tags and
     * the free text of the query alone -- tapping one chip after the other
     * narrows the results down step by step.
     */
    setTagSearch(tag, on) {
      clearTimeout(this.searchDebounceTimer)
      const lower = tag.toLowerCase()
      const { tags, terms } = parseSearchQuery(this.searchQuery)
      const nextTags = on
        ? (tags.includes(lower) ? tags : [...tags, lower])
        : tags.filter((candidate) => candidate !== lower)
      this.searchQuery = [
        ...nextTags.map((candidate) => formatSearchToken(candidate, true)),
        ...terms.map((term) => formatSearchToken(term, false)),
      ].join(' ')
    },
    async runSearch() {
      const query = (this.searchQuery || '').trim()
      // '#tag' searches only need a tag to go on, not three characters
      if (!parseSearchQuery(query).tags.length && query.length < 3) {
        this.searchRun++
        this.searchItems = []
        this.otherSearchItems = []
        this.searching = false
        return
      }
      // The database can be written to while the query is still running (a
      // sync finishing, say), and then a later run supersedes this one.
      const run = ++this.searchRun
      this.searching = true
      const { folders, bookmarks } = await this.$store.dispatch(
        actions.SEARCH_ITEMS,
        { accountId: this.id, query }
      )
      if (run !== this.searchRun) {
        return
      }
      // Results below the folder we're in come first, the rest is offered
      // separately below them. A folder's own index covers its whole subtree.
      const subtree =
        (this.currentFolder && this.currentFolder.index &&
          this.currentFolder.index.folder) || {}
      const isBelowCurrentFolder = (item) =>
        item.type === 'folder' ? item.id in subtree : item.parentId in subtree
      this.searchItems = [
        ...folders.filter(isBelowCurrentFolder),
        ...bookmarks.filter(isBelowCurrentFolder),
      ]
      this.otherSearchItems = [
        ...folders.filter((item) => !isBelowCurrentFolder(item)),
        ...bookmarks.filter((item) => !isBelowCurrentFolder(item)),
      ]
      this.searching = false
    },
    goBack() {
      if (this.isAddingBookmark) {
        this.isAddingBookmark = false
        return
      }
      if (this.isEditingBookmark) {
        this.isEditingBookmark = false
        return
      }
      if (this.isAddingFolder) {
        this.isAddingFolder = false
        return
      }
      if (this.isEditingFolder) {
        this.isEditingFolder = false
        return
      }
      if (this.searchQuery) {
        this.searchQuery = ''
        return
      }
      if (typeof this.currentFolder.parentId !== 'undefined') {
        this.currentFolderId = this.currentFolder.parentId
        return
      }
      App.exitApp()
    },
    editItem(item) {
      if (item.url) {
        this.currentlyEditedBookmark = item
        this.isEditingBookmark = true
      } else {
        this.currentlyEditedFolder = item
        this.isEditingFolder = true
      }
    },
    deleteItem(item) {
      if (!confirm(this.t('DescriptionReallydeleteitem'))) {
        return
      }
      if (item.type === 'bookmark') {
        this.$store.dispatch(actions.DELETE_BOOKMARK, {
          accountId: this.id,
          bookmark: item,
        })
      } else {
        this.$store.dispatch(actions.DELETE_FOLDER, {
          accountId: this.id,
          folder: item,
        })
      }
    },
    addBookmark() {
      this.isAddingBookmark = true
    },
    importBookmarks() {
      this.isImportingBookmarks = true
    },
    createBookmark(props) {
      this.$store.dispatch(actions.CREATE_BOOKMARK, {
        accountId: this.id,
        bookmark: new Bookmark({
          id: null,
          parentId: this.currentFolderId,
          ...props,
        }),
      })
    },
    addFolder() {
      this.isAddingFolder = true
    },
    createFolder(props) {
      this.$store.dispatch(actions.CREATE_FOLDER, {
        accountId: this.id,
        folder: new Folder({
          ...props,
          id: null,
          parentId: this.currentFolderId,
        }),
      })
    },
    editFolder(props) {
      this.$store.dispatch(actions.EDIT_FOLDER, {
        accountId: this.id,
        folder: new Folder({ ...this.currentlyEditedFolder, ...props }),
      })
    },
    editBookmark(props) {
      this.$store.dispatch(actions.EDIT_BOOKMARK, {
        accountId: this.id,
        bookmark: new Bookmark({ ...this.currentlyEditedBookmark, ...props }),
      })
    },
    shareBookmark(item) {
      this.$store.dispatch(actions.SHARE_BOOKMARK, new Bookmark(item))
    },
    onTriggerSync(direction) {
      if (this.syncing || this.scheduled) {
        return
      }
      this.currentAccount.data.syncing = 0.0001 // faaast
      switch (direction) {
        case 'down':
          this.$store.dispatch(actions.TRIGGER_SYNC_DOWN, this.id)
          break
        case 'up':
          this.$store.dispatch(actions.TRIGGER_SYNC_UP, this.id)
          break
        default:
          this.$store.dispatch(actions.TRIGGER_SYNC, this.id)
      }
    },
    onForceSync() {
      if (confirm(this.t('DescriptionScheduledforcesync'))) {
        this.$store.dispatch(actions.FORCE_SYNC, this.id)
      }
    },
  },
}
</script>

<style scoped>
.loading {
  margin: 45vh 45vw;
}

.sync--active {
  animation: spin 2s infinite linear;
}

.search--active {
  animation: spin 2s infinite linear;
}

@keyframes spin {
  0% {
    transform: rotate(360deg);
  }
  99.9% {
    transform: rotate(0deg);
  }
}

.sync-dropdown-hint::after {
  content: '⛛';
  position: absolute;
  font-size: 0.45em;
  top: 30px;
  left: 30px;
}

.list-full-height {
  min-height: 95vh;
  margin-bottom: 60px;
}

.tag-bar {
  display: flex;
  flex-wrap: nowrap;
  overflow-x: auto;
  /* momentum scrolling on iOS */
  -webkit-overflow-scrolling: touch;
  /* the bar is dragged, not scrollbar-clicked */
  scrollbar-width: none;
}

.tag-bar::-webkit-scrollbar {
  display: none;
}

.tag-bar__chip {
  flex: 0 0 auto;
}
</style>
