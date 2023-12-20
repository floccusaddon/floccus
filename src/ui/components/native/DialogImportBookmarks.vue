<template>
  <v-dialog
    v-model="display"
    max-width="500px">
    <v-card>
      <v-card-title class="text-h5">
        {{ t('LabelImportbookmarks') }}
      </v-card-title>
      <v-card-text>
        <p>{{ t("DescriptionImportbookmarks") }}</p>
        <input
          ref="filePicker"
          type="file"
          class="d-none"
          accept="text/html"
          @change="onFileSelect">
        <v-btn
          block
          @click="onTriggerFilePicker">
          <v-icon>mdi-import</v-icon>{{ t('LabelImportbookmarks') }}
        </v-btn>
      </v-card-text>
      <v-card-actions>
        <v-btn
          color="blue darken-1"
          text
          @click="$emit('update:display', false)">
          {{ t('LabelCancel') }}
        </v-btn>
        <v-spacer />
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script>
export default {
  name: 'DialogImportBookmarks',
  props: {
    display: {
      type: Boolean,
    },
    accountId: {
      type: String,
      required: true,
    },
    parentFolder: {
      type: Number,
      default: -1
    }
  },
  methods: {
    onTriggerFilePicker() {
      this.$refs.filePicker.click()
    },
    async onFileSelect() {
      const file = this.$refs.filePicker.files[0]
      try {
        const html = await file.text()
        await this.$store.dispatch('IMPORT_BOOKMARKS', {accountId: this.accountId, parentFolder: this.parentFolder, html})
        this.$emit('update:display', false)
      } catch (e) {
        alert(e.message)
        throw e
      }
    }
  }
}
</script>

<style scoped>

</style>
