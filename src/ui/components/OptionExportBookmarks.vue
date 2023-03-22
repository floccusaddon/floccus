<template>
  <div>
    <div class="text-h6">
      {{ t('LabelExportBookmarks') }}
    </div>
    <div class="caption">
      {{ t('DescriptionExportBookmarks') }}
    </div>
    <v-btn
      class="mb-5"
      @click="onExport()">
      {{ t('LabelExportBookmarks') }}
    </v-btn>
  </div>
</template>

<script>
export default {
  name: 'OptionExportBookmarks',
  methods: {
    onExport() {
      this.$store.dispatch('EXPORT_BOOKMARKS', this.$route.params.accountId)
    }
  }
}
</script>

<style scoped>

</style>
