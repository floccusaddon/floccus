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
    </v-app-bar>
    <v-content>
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
              <v-icon
                v-else
                large>
                mdi-star
              </v-icon>
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
                    <v-list-item-title>Edit</v-list-item-title>
                  </v-list-item>
                  <v-list-item>
                    <v-list-item-title>Delete</v-list-item-title>
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
    </v-content>
  </div>
</template>

<script>
import Drawer from '../../components/native/Drawer'
import flatten from 'lodash/flatten'
export default {
  name: 'Tree',
  components: { Drawer },
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
            {type: 'bookmark', url: 'https://marcelklehr.de', title: 'Marcel Klehr', id: 7},
            {type: 'bookmark', url: 'https://duckduckgo.com', title: 'DuckDuckGo', id: 8},
            {type: 'bookmark', url: 'https://floccus.org', title: 'Floccus bookmarks sync', id: 9},
            {type: 'bookmark', url: 'https://google.com', title: 'Google Search', id: 10},
            {type: 'bookmark', url: 'https://nextcloud.com', title: 'Nextcloud', id: 11},
          ]},
        {type: 'bookmark', url: 'https://google.com', title: 'Google Search', id: 5},
        {type: 'bookmark', url: 'https://nextcloud.com', title: 'Nextcloud', id: 1},
        {type: 'bookmark', url: 'https://duckduckgo.com', title: 'DuckDuckGo', id: 2},
        {type: 'bookmark', url: 'https://floccus.org', title: 'Floccus bookmarks sync', id: 3},
        {type: 'bookmark', url: 'https://marcelklehr.de', title: 'Marcel Klehr', id: 4},
      ]}
    return {
      tree,
      currentFolderId: tree.id,
      drawer: false,
      searchQuery: '',
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
    }
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
    }
  }
}
</script>

<style scoped>

</style>
