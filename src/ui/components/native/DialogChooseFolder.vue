<template>
  <v-dialog
    :value="display"
    max-width="500"
    :style="{height: '500px !important'}"
    @input="$emit('update:display', $event)">
    <v-card>
      <v-row no-gutters>
        <v-col class="flex-grow-1">
          <v-card-title class="headline">
            {{ t('LabelChoosefolder') }}
          </v-card-title>
        </v-col>
        <v-col class="flex-grow-0">
          <v-btn
            class="primary ma-2"
            @click="onSave">
            save
          </v-btn>
        </v-col>
      </v-row>
      <v-treeview
        class="pa-4"
        activatable
        :item-text="'title'"
        :item-key="'id'"
        :active="[value]"
        :open="[tree.id]"
        :items="[filterOutBookmarks(tree)]"
        dense
        @update:active="onUpdateSelection">
        <template #prepend="{ open }">
          <v-icon>
            {{ open ? 'mdi-folder-open' : 'mdi-folder' }}
          </v-icon>
        </template>
        <template #label="{item}">
          {{ item.title || t('LabelUntitledfolder') }}
        </template>
      </v-treeview>
    </v-card>
  </v-dialog>
</template>

<script>
import { mutations } from '../../store/native'

export default {
  name: 'DialogChooseFolder',
  props: {
    value: {
      type: Number,
      default: undefined
    },
    display: {
      type: Boolean,
      default: false,
    },
    tree: {
      type: Object,
      required: true,
    },
  },
  data() {
    return {
      selectedFolder: this.value,
    }
  },
  methods: {
    filterOutBookmarks(item) {
      return {
        ...item,
        children: item.children
          .filter(child => !child.url)
          .map(child => this.filterOutBookmarks(child))
      }
    },
    onUpdateSelection(active) {
      this.selectedFolder = active[0]
    },
    onSave() {
      this.$store.commit(mutations.SET_LAST_FOLDER, {folderId: this.selectedFolder, accountId: this.$route.params.accountId})
      this.$emit('update:display', false)
      this.$emit('input', this.selectedFolder)
    }
  }
}
</script>

<style scoped>

</style>
