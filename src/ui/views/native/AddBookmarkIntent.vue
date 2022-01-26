<template>
  <div>
    <v-app-bar
      app>
      <v-btn
        icon
        :to="{name: routes.TREE, params: {accountId: id}}">
        <v-icon>mdi-arrow-left</v-icon>
      </v-btn>
      <v-app-bar-title>Add Bookmark</v-app-bar-title>
      <v-spacer />
      <v-btn
        color="blue darken-1"
        text
        elevation="1"
        @click="onSave">
        Save
      </v-btn>
    </v-app-bar>
    <v-main>
      <v-progress-circular
        v-if="loading"
        indeterminate
        color="blue darken-1"
        class="loading" />
      <v-card v-else>
        <v-card-text>
          <v-select
            dense
            :value="id"
            item-text="label"
            item-value="id"
            :items="accounts"
            @change="$router.push({name: routes.ADD_BOOKMARK, params: {url, accountId: $event}})">
            <template #prepend-inner>
              <v-icon>{{ account.data.type | accountIcon }}</v-icon>
            </template>
            <template #item="{item}">
              <v-icon>{{ item.data.type | accountIcon }}</v-icon> {{ item.label }}
            </template>
          </v-select>
          <v-text-field
            v-model="title"
            label="Title"
            hide-details />
          <v-text-field
            v-model="url"
            :error="Boolean(urlError)"
            :error-messages="urlError"
            label="Link" />
        </v-card-text>
      </v-card>
    </v-main>
  </div>
</template>

<script>
import { routes } from '../../NativeRouter'
import { actions } from '../../store/native'
import { Bookmark } from '../../../lib/Tree'

export default {
  name: 'AddBookmarkIntent',
  components: { },
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
  data() {
    return {
      url: this.$route.params.url,
      urlError: null,
      title: this.$route.params.title || '',
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
    }
  },
  watch: {
    loading() {
      if (this.loading) return
      this.data = this.$store.state.accounts[this.id].data
    },
    url(url) {
      this.urlError = null
      try {
        // eslint-disable-next-line
        new URL(url)
      } catch (e) {
        this.urlError = 'Invalid URL'
      }
    },
  },
  created() {
    if (!this.loading) {
      this.data = this.$store.state.accounts[this.id].data
    }
  },
  methods: {
    async onSave() {
      await this.$store.dispatch(actions.LOAD_TREE, this.id)
      await this.$store.dispatch(actions.CREATE_BOOKMARK, {
        accountId: this.id,
        bookmark: new Bookmark({ id: null, parentId: 0, title: this.title, url: this.url })
      })
      await this.$router.push({name: routes.TREE, params: {accountId: this.id}})
    }
  }
}
</script>

<style scoped>
.loading {
  margin: 40vh 40vw;
}
</style>
