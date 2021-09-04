<template>
  <v-dialog
    v-model="display"
    max-width="500px">
    <v-card>
      <v-card-title class="text-h5">
        Add bookmark
      </v-card-title>
      <v-card-text>
        <v-text-field
          v-model="temporaryTitle"
          label="Title"
          hide-details />
        <v-text-field
          v-model="temporaryUrl"
          label="Link"
          hide-details />
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn
          color="blue darken-1"
          text
          @click="$emit('update:display', false)">
          Cancel
        </v-btn>
        <v-btn
          color="blue darken-1"
          text
          @click="$emit('save', {title: temporaryTitle, url: temporaryUrl});$emit('update:display', false)">
          OK
        </v-btn>
        <v-spacer />
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script>
export default {
  name: 'DialogAddBookmark',
  props: {
    title: {
      type: String,
      default: ''
    },
    url: {
      type: String,
      default: ''
    },
    display: {
      type: Boolean,
    },
  },
  data() {
    return {
      temporaryTitle: this.title, temporaryUrl: this.url,
    }
  }
}
</script>

<style scoped>

</style>
