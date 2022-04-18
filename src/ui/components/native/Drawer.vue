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
          {{ t('LabelSlugline') }}
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
          :to="{name: routes.TREE, params: {accountId: account.id}}">
          <v-list-item-icon>
            <v-icon>{{ account.data.type | accountIcon }}</v-icon>
          </v-list-item-icon>

          <v-list-item-content>
            <v-list-item-title>{{ account.label }}</v-list-item-title>
          </v-list-item-content>
        </v-list-item>
      </template>
      <v-list-item
        key="addaccount"
        link
        :to="{ name: routes.NEW_ACCOUNT }">
        <v-list-item-icon>
          <v-icon>mdi-plus</v-icon>
        </v-list-item-icon>

        <v-list-item-content>
          <v-list-item-title>{{ t('LabelNewAccount') }}</v-list-item-title>
        </v-list-item-content>
      </v-list-item>
      <v-divider />
      <v-list-item
        key="export"
        link
        :to="{name: routes.IMPORTEXPORT}">
        <v-list-item-icon>
          <v-icon>mdi-export</v-icon>
        </v-list-item-icon>
        <v-list-item-content>
          <v-list-item-title>{{ t('LabelImportExport') }}</v-list-item-title>
        </v-list-item-content>
      </v-list-item>
      <v-list-item
        key="about"
        link
        :to="{name: routes.ABOUT}">
        <v-list-item-icon>
          <v-icon>mdi-information-outline</v-icon>
        </v-list-item-icon>
        <v-list-item-content>
          <v-list-item-title>{{ t('LabelAbout') }}</v-list-item-title>
        </v-list-item-content>
      </v-list-item>
      <v-list-item
        key="donate"
        link
        href="https://floccus.org/download#support">
        <v-list-item-icon>
          <v-icon>mdi-heart-outline</v-icon>
        </v-list-item-icon>
        <v-list-item-content>
          <v-list-item-title>{{ t('LabelFunddevelopment') }}</v-list-item-title>
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
        'google-drive': 'mdi-google-drive',
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
