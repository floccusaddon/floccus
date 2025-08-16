<template>
  <v-list-item
    :key="item.type+item.id"
    class="pl-3"
    dense
    @click="$emit('click')">
    <v-list-item-avatar>
      <v-icon
        v-if="item.type === 'folder'"
        color="blue darken-1"
        large>
        mdi-folder
      </v-icon>
      <FaviconImage
        v-else
        :url="item.url"
        :use-network="useNetwork" />
    </v-list-item-avatar>

    <v-list-item-content>
      <v-list-item-title>{{ item.title }}</v-list-item-title>
      <v-list-item-subtitle v-if="item.type === 'bookmark'">
        {{ item.url | hostname }}
      </v-list-item-subtitle>
      <v-list-item-subtitle v-if="item.type === 'bookmark' && showFolderPath">
        <Breadcrumbs
          in-item
          :items="getBookmarkPath(item)"
          :tree="tree" />
      </v-list-item-subtitle>
    </v-list-item-content>

    <v-list-item-action>
      <v-menu
        bottom
        left>
        <template #activator="{ on, attrs }">
          <v-btn
            icon
            v-bind="attrs"
            v-on="on">
            <v-icon>mdi-dots-vertical</v-icon>
          </v-btn>
        </template>

        <v-list>
          <v-list-item @click="$emit('edit')">
            <v-list-item-avatar>
              <v-icon>mdi-pencil</v-icon>
            </v-list-item-avatar>
            <v-list-item-title>
              {{ t('LabelEdititem') }}
            </v-list-item-title>
          </v-list-item>
          <v-list-item
            v-if="item.type === 'bookmark'"
            @click="$emit('share')">
            <v-list-item-avatar>
              <v-icon>mdi-share</v-icon>
            </v-list-item-avatar>
            <v-list-item-title>
              {{ t('LabelShareitem') }}
            </v-list-item-title>
          </v-list-item>
          <v-list-item @click="$emit('delete')">
            <v-list-item-avatar>
              <v-icon>mdi-delete</v-icon>
            </v-list-item-avatar>
            <v-list-item-title>
              {{ t('LabelDeleteitem') }}
            </v-list-item-title>
          </v-list-item>
        </v-list>
      </v-menu>
    </v-list-item-action>
  </v-list-item>
</template>

<script>
import FaviconImage from './FaviconImage.vue'
import Breadcrumbs from './Breadcrumbs.vue'

export default {
  name: 'Item',
  components: { Breadcrumbs, FaviconImage },
  filters: {
    hostname(url) {
      try {
        return new URL(url).hostname
      } catch (e) {
        console.error(`${e}: ${url}`)
        return '(bad url)'
      }
    },
  },
  props: {
    item: {
      type: Object,
      default: undefined
    },
    showFolderPath: {
      type: Boolean,
      default: false
    }
  },
  computed: {
    accountId() {
      return this.$route.params.accountId
    },
    loading() {
      return (!this.$store.state.accounts[this.accountId] || !this.$store.state.accounts[this.accountId].data || !Object.keys(this.$store.state.accounts[this.accountId].data).length || !this.tree)
    },
    tree() {
      return this.$store.state.tree
    },
    useNetwork() {
      if (this.loading) {
        return false
      }
      return this.$store.state.accounts[this.accountId].data.allowNetwork
    },
  },
  methods: {
    getBookmarkPath(item) {
      const folders = [item]
      while (this.tree && folders[folders.length - 1 ] && String(folders[folders.length - 1 ].id) !== String(this.tree.id)) {
        folders.push(this.findItem(folders[folders.length - 1 ].parentId, this.tree))
      }
      folders.reverse()
      folders.pop() // remove bookmark
      return folders
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
  }
}
</script>

<style scoped>

</style>