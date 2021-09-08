<template>
  <v-navigation-drawer
    :value="visible"
    app
    temporary
    absolute
    @input="$emit('update:visible')">
    <v-list-item two-line>
      <v-list-item-avatar>
        <img src="icons/logo.svg">
      </v-list-item-avatar>
      <v-list-item-content>
        <v-list-item-title class="text-h6">
          Floccus
        </v-list-item-title>
        <v-list-item-subtitle>
          Private Bookmark Sync
        </v-list-item-subtitle>
      </v-list-item-content>
    </v-list-item>

    <v-divider />

    <v-list
      dense
      nav>
      <template v-for="account in accounts">
        <v-list-item
          :key="account.id"
          link
          :to="{name: routes.TREE, params:{accountId: account.id}}">
          <v-list-item-icon>
            <v-icon>{{ account.data.type | accountIcon }}</v-icon>
          </v-list-item-icon>

          <v-list-item-content>
            <v-list-item-title>{{ account.label }}</v-list-item-title>
          </v-list-item-content>
        </v-list-item>
      </template>
      <v-list-item
        key="info"
        link>
        <v-list-item-icon>
          <v-icon>mdi-information-outline</v-icon>
        </v-list-item-icon>

        <v-list-item-content>
          <v-list-item-title>About</v-list-item-title>
        </v-list-item-content>
      </v-list-item>
    </v-list>
  </v-navigation-drawer>
</template>

<script>
import { routes } from '../../NativeRouter'
export default {
  name: 'Drawer',
  filters: {
    accountIcon(type) {
      const icons = {
        'googledrive': 'mdi-google-drive',
        'nextcloud-bookmarks': 'mdi-cloud',
        'webdav': 'mdi-folder-network'
      }
      return icons[type]
    },
  },
  props: {
    visible: {
      type: Boolean
    },
  },
  data() {
    return { }
  },
  computed: {
    accounts() {
      return Object.values(this.$store.state.accounts)
    },
    routes() {
      return routes
    }
  }
}
</script>

<style scoped>

</style>
