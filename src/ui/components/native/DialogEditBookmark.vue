<template>
  <v-dialog
    v-model="display"
    max-width="500px">
    <v-card>
      <v-card-title class="text-h5">
        {{ isNew? t('LabelAddbookmark') : t('LabelEditbookmark') }}
      </v-card-title>
      <v-card-text>
        <v-text-field
          v-model="temporaryTitle"
          label="Title"
          hide-details />
        <v-text-field
          v-model="temporaryUrl"
          :error="Boolean(urlError)"
          :error-messages="urlError"
          label="Link" />
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
          @click="onSave">
          {{ t('LabelSave') }}
        </v-btn>
        <v-spacer />
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script>
export default {
  name: 'DialogEditBookmark',
  props: {
    bookmark: {
      type: Object,
      default: () => ({})
    },
    url: {
      type: String,
      default: ''
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
      temporaryTitle: this.bookmark.title || '',
      temporaryUrl: this.bookmark.url || this.url || '',
      urlError: null
    }
  },
  watch: {
    temporaryUrl(url) {
      this.urlError = null
      try {
        // eslint-disable-next-line
        new URL(url)
      } catch (e) {
        this.urlError = 'Invalid URL'
      }
    },
    title() {
      this.temporaryTitle = this.bookmark.title
    },
    url() {
      this.temporaryUrl = this.bookmark.url
    }
  },
  methods: {
    onSave() {
      if (this.urlError) {
        return
      }
      this.$emit('save', {title: this.temporaryTitle, url: this.temporaryUrl})
      this.$emit('update:display', false)
    }
  }
}
</script>

<style scoped>

</style>
