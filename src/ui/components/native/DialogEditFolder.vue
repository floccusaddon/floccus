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
        <v-text-field
          v-model="parentTitle"
          readonly
          :error="Boolean(parentError)"
          :error-messages="parentError"
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
      const folder = this.tree.findFolder(this.temporaryParent)
      return folder ? folder.title || this.t('LabelUntitledfolder') : ''
    }
  },
  watch: {
    temporaryParent() {
      if (!this.tree.findFolder(this.temporaryParent)) {
        this.parentError = this.t('ErrorNofolderselected')
      } else if (this.folder && this.tree.findFolder(this.folder.id).findFolder(this.temporaryParent)) {
        this.parentError = this.t('ErrorFolderloopselected')
      } else {
        this.parentError = null
      }
    }
  },
  mounted() {
    this.temporaryTitle = this.folder.title || ''
    const parentFolder = this.tree.findFolder(this.folder.parentId) ||
        this.tree.findFolder(this.parentFolder) ||
        this.tree.findFolder(this.$store.state.lastFolders[this.$route.params.accountId]) ||
        this.tree.findFolder(this.tree.id)
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
