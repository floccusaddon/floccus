<template>
  <v-dialog
    v-model="display"
    max-width="500px">
    <v-card>
      <v-card-title
        class="text-h5"
        role="heading"
        aria-level="2">
        {{ isNew? t('LabelAddfolder') : t('LabelEditfolder') }}
      </v-card-title>
      <v-card-text>
        <v-text-field
          v-model="temporaryTitle"
          :label="t('LabelTitle')"
          hide-details />
        <v-text-field
          v-model="parentTitle"
          readonly
          :error="Boolean(parentError)"
          :error-messages="parentError"
          :label="t('LabelParentfolder')"
          @click="onTriggerFolderChooser">
          <template #append>
            <v-icon
              color="blue darken-1"
              aria-hidden="true"
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
      :folder-tree="folderTree" />
  </v-dialog>
</template>

<script>
import DialogChooseFolder from './DialogChooseFolder'
export default {
  name: 'DialogEditFolder',
  components: { DialogChooseFolder },
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
    },
    folderTree: {
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
      temporaryParent: null,
      displayFolderChooser: false,
      parentError: null,
    }
  },
  computed: {
    parentTitle() {
      if (this.temporaryParent === null) {
        return ''
      }
      const folder = this.folderTree.findFolder(this.temporaryParent)
      return folder ? folder.title || this.t('LabelUntitledfolder') : ''
    }
  },
  watch: {
    temporaryParent() {
      if (!this.folderTree.findFolder(this.temporaryParent)) {
        this.parentError = this.t('ErrorNofolderselected')
      } else if (this.folder && this.folderTree.findFolder(this.folder.id).findFolder(this.temporaryParent)) {
        this.parentError = this.t('ErrorFolderloopselected')
      } else {
        this.parentError = null
      }
    }
  },
  mounted() {
    this.temporaryTitle = this.folder.title || ''
    const parentFolder = this.folderTree.findFolder(this.folder.parentId) ||
        this.folderTree.findFolder(this.parentFolder) ||
        this.folderTree.findFolder(this.$store.state.lastFolders[this.$route.params.accountId]) ||
        this.folderTree.findFolder(this.folderTree.id)
    this.temporaryParent = parentFolder.id
  },
  methods: {
    onTriggerFolderChooser() {
      this.displayFolderChooser = true
    },
    onSave() {
      if (this.parentError) {
        return
      }
      this.$emit('save', {title: this.temporaryTitle, parentId: this.temporaryParent})
      this.$emit('update:display', false)
    }
  }
}
</script>

<style scoped>

</style>
