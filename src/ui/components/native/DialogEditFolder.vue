<template>
  <v-dialog
    v-model="display"
    max-width="500px">
    <v-card>
      <v-card-title class="text-h5">
        Edit folder
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
          Cancel
        </v-btn>
        <v-btn
          color="blue darken-1"
          text
          @click="$emit('update:title', temporaryTitle); $emit('update:display', false)">
          OK
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
    title: {
      type: String,
    },
    display: {
      type: Boolean,
    },
  },
  data() {
    return {
      temporaryTitle: this.title,
    }
  }
}
</script>

<style scoped>

</style>
