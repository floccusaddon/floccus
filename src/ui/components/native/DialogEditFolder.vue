<template>
  <v-dialog
    v-model="display"
    max-width="500px">
    <v-card>
      <v-card-title class="text-h5">
        {{ isNew? t('LabelAddfolder') : t('LabelEditfolder') }}
      </v-card-title>
      <v-card-text>
        <v-text-field
          v-model="temporaryTitle"
          label="Title"
          hide-details />
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn
          color="blue darken-1"
          text
          @click="$emit('update:display', false)">
          {{ t('LabelCancel') }}
        </v-btn>
        <v-btn
          color="blue darken-1"
          text
          @click="$emit('save', {title: temporaryTitle}); $emit('update:display', false)">
          {{ t('LabelSave') }}
        </v-btn>
        <v-spacer />
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script>
export default {
  name: 'DialogEditFolder',
  props: {
    folder: {
      type: Object,
      default: () => ({})
    },
    display: {
      type: Boolean,
    },
    isNew: {
      type: Boolean,
    }
  },
  data() {
    return {
      temporaryTitle: this.folder.title || '',
    }
  },
  watch: {
    title() {
      this.temporaryTitle = this.folder.title
    }
  }
}
</script>

<style scoped>

</style>
