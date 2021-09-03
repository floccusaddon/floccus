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
      <v-list-item
        v-for="item in items"
        :key="item.title"
        link>
        <v-list-item-icon>
          <v-icon>{{ item.icon }}</v-icon>
        </v-list-item-icon>

        <v-list-item-content>
          <v-list-item-title>{{ item.title }}</v-list-item-title>
        </v-list-item-content>
      </v-list-item>
    </v-list>
  </v-navigation-drawer>
</template>

<script>
export default {
  name: 'Drawer',
  props: {
    visible: {
      type: Boolean
    },
  },
  data() {
    return {
      items: [
        { title: 'Dashboard', icon: 'mdi-view-dashboard' },
        { title: 'Photos', icon: 'mdi-image' },
        { title: 'About', icon: 'mdi-help-box' },
      ],
      right: null,
    }
  },
}
</script>

<style scoped>

</style>
