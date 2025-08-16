<template>
  <v-breadcrumbs
    v-if="items.length > 1"
    :items="items"
    :style="{...(inItem && { marginLeft: '-1.5em', marginTop: 0, marginBottom: 0, paddingTop: 0, paddingBottom: 0 })}">
    <template #item="{ item }">
      <v-breadcrumbs-item @click="$emit('click', item.id)">
        <template v-if="item.id === tree.id">
          <v-icon>mdi-home</v-icon>
        </template>
        <template v-else>
          {{ item.title }}
        </template>
      </v-breadcrumbs-item>
    </template>
  </v-breadcrumbs>
</template>

<script>
export default {
  name: 'Breadcrumbs',
  components: {},
  props: {
    items: {
      type: Array,
      default: undefined
    },
    tree: {
      type: Object,
      required: true,
    },
    inItem: {
      type: Boolean,
      default: false,
    }
  }
}
</script>

<style scoped>

</style>