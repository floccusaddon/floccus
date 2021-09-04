<template>
  <div>
    <Drawer :visible.sync="drawer" />
    <v-app-bar
      hide-on-scroll
      app>
      <v-app-bar-nav-icon
        v-if="currentFolderId === tree.id"
        class="mr-2"
        @click="drawer = !drawer" />
      <v-btn
        v-else
        icon
        @click="goBack">
        <v-icon>mdi-arrow-left</v-icon>
      </v-btn>
      <v-text-field
        v-model="searchQuery"
        :label="currentFolderId === tree.id? 'Search Bookmarks' : 'Search '+currentFolder.title"
        solo
        flat
        dense
        clearable
        hide-details />
      <v-spacer />
      <v-btn icon>
        <v-icon>mdi-sync</v-icon>
      </v-btn>
      <v-btn
        icon
        :to="{name: routes.ACCOUNT_OPTIONS, params:{accountId: Math.random()}}">
        <v-icon>mdi-settings</v-icon>
      </v-btn>
    </v-app-bar>
    <v-main>
      <v-list
        v-if="items && items.length"
        two-line>
        <template v-for="item in items">
          <v-list-item
            :key="item.type+item.id"
            class="pl-3"
            dense
            @click="clickItem(item)">
            <v-list-item-avatar>
              <v-icon
                v-if="item.type === 'folder'"
                large>
                mdi-folder
              </v-icon>
              <FaviconImage
                v-else
                :url="item.url" />
            </v-list-item-avatar>

            <v-list-item-content>
              <v-list-item-title v-text="item.title" />
              <v-list-item-subtitle v-if="item.type === 'bookmark'">
                {{ item.url | hostname }}
              </v-list-item-subtitle>
            </v-list-item-content>

            <v-list-item-action>
              <v-menu
                bottom
                left>
                <template v-slot:activator="{ on, attrs }">
                  <v-btn
                    icon
                    v-bind="attrs"
                    v-on="on">
                    <v-icon>mdi-dots-vertical</v-icon>
                  </v-btn>
                </template>

                <v-list>
                  <v-list-item>
                    <v-list-item-title @click="editItem(item)">
                      Edit
                    </v-list-item-title>
                  </v-list-item>
                  <v-list-item>
                    <v-list-item-title @click="deleteItem(item)">
                      Delete
                    </v-list-item-title>
                  </v-list-item>
                </v-list>
              </v-menu>
            </v-list-item-action>
          </v-list-item>
          <v-divider
            :key="String(item.id)+item.type+'divider'" />
        </template>
      </v-list>
      <v-card
        v-else
        flat
        tile
        class="ma-2 mt-10">
        <v-card-title>No bookmarks here :(</v-card-title>
      </v-card>
      <v-speed-dial
        v-model="fab"
        fixed
        bottom
        right>
        <template #activator>
          <v-btn
            v-model="fab"
            color="blue"
            dark
            fab>
            <v-icon v-if="fab">
              mdi-close
            </v-icon>
            <v-icon v-else>
              mdi-plus
            </v-icon>
          </v-btn>
        </template>
        <v-btn
          color="blue"
          dark
          small
          fab
          @click="addFolder">
          <v-icon>mdi-folder</v-icon>
        </v-btn>
        <v-btn
          color="blue"
          dark
          small
          fab
          @click="addBookmark">
          <v-icon>mdi-star</v-icon>
        </v-btn>
      </v-speed-dial>
    </v-main>

    <DialogEditFolder
      v-if="isEditingFolder"
      :display.sync="isEditingFolder"
      :title.sync="currentlyEditedFolder.title" />
    <DialogEditBookmark
      v-if="isEditingBookmark"
      :display.sync="isEditingBookmark"
      :title.sync="currentlyEditedBookmark.title"
      :url.sync="currentlyEditedBookmark.url" />
    <DialogAddBookmark
      v-if="isAddingBookmark"
      :display.sync="isAddingBookmark"
      @save="createBookmark($event)" />
    <DialogAddFolder
      v-if="isAddingFolder"
      :display.sync="isAddingFolder"
      @save="createFolder($event)" />
  </div>
</template>

<script>
import Drawer from '../../components/native/Drawer'
import flatten from 'lodash/flatten'
import DialogEditFolder from '../../components/native/DialogEditFolder'
import DialogEditBookmark from '../../components/native/DialogEditBookmark'
import FaviconImage from '../../components/native/FaviconImage'
import { routes } from '../../NativeRouter'
import DialogAddBookmark from '../../components/native/DialogAddBookmark'
import { Bookmark, Folder } from '../../../lib/Tree'
import DialogAddFolder from '../../components/native/DialogAddFolder'
export default {
  name: 'Tree',
  components: { DialogAddFolder, DialogAddBookmark, FaviconImage, DialogEditBookmark, DialogEditFolder, Drawer },
  filters: {
    hostname(url) {
      return new URL(url).hostname
    }
  },
  data() {
    const tree = {id: 0,
      children: [
        {type: 'folder',
          title: 'Escuchar música',
          id: 6,
          parentId: 0,
          children: [
            {type: 'bookmark', url: 'https://marcelklehr.de', title: 'Marcel Klehr', id: 7, parentId: 6},
            {type: 'bookmark', url: 'https://duckduckgo.com', title: 'DuckDuckGo', id: 8, parentId: 6},
            {type: 'bookmark', url: 'https://floccus.org', title: 'Floccus bookmarks sync', id: 9, parentId: 6},
            {type: 'bookmark', url: 'https://google.com', title: 'Google Search', id: 10, parentId: 6},
            {type: 'bookmark', url: 'https://nextcloud.com', title: 'Nextcloud', id: 11, parentId: 6},
          ]},
        {type: 'bookmark', url: 'https://google.com', title: 'Google Search', id: 5, parentId: 0},
        {type: 'bookmark', url: 'https://nextcloud.com', title: 'Nextcloud', id: 1, parentId: 0},
        {type: 'bookmark', url: 'https://duckduckgo.com', title: 'DuckDuckGo', id: 2, parentId: 0},
        {type: 'bookmark', url: 'https://floccus.org', title: 'Floccus bookmarks sync', id: 3, parentId: 0},
        {type: 'bookmark', url: 'https://marcelklehr.de', title: 'Marcel Klehr', id: 4, parentId: 0},
      ]}
    return {
      tree,
      currentFolderId: tree.id,
      drawer: false,
      searchQuery: '',
      isEditingFolder: false,
      currentlyEditedFolder: null,
      isEditingBookmark: false,
      currentlyEditedBookmark: null,
      isAddingBookmark: false,
      isAddingFolder: false,
      fab: false
    }
  },
  computed: {
    items() {
      if (this.searchQuery && this.searchQuery.length >= 2) {
        return this.search(this.searchQuery.toLowerCase().trim(), this.currentFolder)
      }
      return this.currentFolder.children
    },
    currentFolder() {
      return this.findItem(this.currentFolderId, this.tree)
    },
    routes() {
      return routes
    },
  },
  methods: {
    clickItem(item) {
      if (item.url) {
        window.location = item.url
      } else {
        this.searchQuery = ''
        this.currentFolderId = item.id
      }
    },
    findItem(id, tree) {
      if (tree.id === id) {
        return tree
      }
      if (tree.url) {
        return false
      }
      return tree.children.find(item => this.findItem(id, item))
    },
    search(query, tree) {
      const matchTitle = tree.title ? query.split(' ').some(term => tree.title.toLowerCase().includes(term)) : false
      if (!tree.url && tree.children) {
        return flatten(tree.children.map(item => this.search(query, item))).concat(matchTitle ? [tree] : [])
      }
      const matchUrl = query.split(' ').some(term => tree.url.toLowerCase().includes(term))
      return matchUrl || matchTitle ? [tree] : []
    },
    goBack() {
      this.searchQuery = ''
      if (typeof this.currentFolder.parentId !== 'undefined') {
        this.currentFolderId = this.currentFolder.parentId
      }
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
      const parent = this.findItem(item.parentId, this.tree)
      parent.children.splice(parent.children.indexOf(item), 1)
    },
    addBookmark() {
      this.isAddingBookmark = true
    },
    createBookmark(props) {
      this.items.push(new Bookmark({id: Math.random(), ...props}))
    },
    addFolder() {
      this.isAddingFolder = true
    },
    createFolder(props) {
      this.items.push(new Folder({...props,id: Math.random(), parentId: this.currentFolderId}))
    },
  }
}
</script>

<style scoped>

</style>
