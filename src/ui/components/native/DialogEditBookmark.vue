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
        <v-text-field
          v-model="parentTitle"
          readonly
          label="Parent folder"
          @click="onTriggerFolderChooser">
          <template #append>
            <v-icon
              color="blue darken-1"
              @click="onTriggerFolderChooser">
              mdi-folder
            </v-icon>
          </template>
        </v-text-field>
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
    <DialogChooseFolder
      v-model="temporaryParent"
      :display.sync="displayFolderChooser"
      :tree="tree" />
  </v-dialog>
</template>

<script>
import DialogChooseFolder from './DialogChooseFolder'
export default {
  name: 'DialogEditBookmark',
  components: { DialogChooseFolder },
  props: {
    bookmark: {
      type: Object,
      default: () => ({})
    },
    display: {
      type: Boolean,
    },
    isNew: {
      type: Boolean,
    },
    tree: {
      type: Object,
      required: true,
    },
    parentFolder: {
      type: Number,
      default: -1
    }
  },
  data() {
    return {
      temporaryTitle: '',
      temporaryUrl: '',
      urlError: null,
      temporaryParent: null,
      displayFolderChooser: false,
    }
  },
  computed: {
    parentTitle() {
      if (this.temporaryParent === null) {
        return ''
      }
      const folder = this.tree.findFolder(this.temporaryParent)
      return folder ? folder.title || this.t('LabelUntitledfolder') : ''
    }
  },
  watch: {
    temporaryUrl() {
      this.urlError = null
      try {
        // eslint-disable-next-line
        new URL(this.temporaryUrl)
      } catch (e) {
        this.urlError = 'Invalid URL'
      }
    },
    display() {
      if (!this.display) {
        this.displayFolderChooser = false
      }
    }
  },
  mounted() {
    this.temporaryTitle = this.bookmark.title || ''
    this.temporaryUrl = this.bookmark.url || ''
    const parentFolder = this.tree.findFolder(this.bookmark.parentId) ||
        this.tree.findFolder(this.parentFolder) ||
        this.tree.findFolder(this.$store.state.lastFolders[this.$route.params.accountId]) ||
        this.tree.findFolder(this.tree.id)
    this.temporaryParent = parentFolder.id
  },
  methods: {
    onSave() {
      if (!this.temporaryUrl || this.urlError) {
        return
      }
      if (!this.tree.findFolder(this.temporaryParent)) {
        return
      }
      this.$emit('save', {title: this.temporaryTitle, url: this.temporaryUrl, parentId: this.temporaryParent})
      this.$emit('update:display', false)
    },
    onTriggerFolderChooser() {
      this.displayFolderChooser = true
    }
  }
}
</script>

<style scoped>

</style>
