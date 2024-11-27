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
        :items="[privateTree]"
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
        <template #append="{item}">
          <v-btn
            small
            rounded
            @click="onCreate(item.id)">
            <v-icon>
              mdi-plus
            </v-icon>
          </v-btn>
        </template>
      </v-treeview>
    </v-card>
  </v-dialog>
</template>

<script>
import { actions, mutations } from '../../store/definitions'
import { Folder } from '../../../lib/Tree'

export default {
  name: 'DialogChooseFolder',
  components: {},
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
      privateTree: [],
    }
  },
  computed: {
    accountId() {
      return this.$route.params.accountId
    },
    sortBy() {
      return this.accountId && this.$store.state.accounts[this.accountId].data.sortBy
    }
  },
  watch: {
    async tree(newTree, oldTree) {
      if (await newTree.hash() === await oldTree.hash()) {
        return
      }
      this.privateTree = this.filterOutBookmarks(newTree)
    }
  },
  mounted() {
    this.privateTree = this.filterOutBookmarks(this.tree)
  },
  methods: {
    filterOutBookmarks(item) {
      let children = item.children
        .filter(child => !child.url)
        .map(child => this.filterOutBookmarks(child))
      if (this.sortBy === 'title') {
        children = children.toSorted((a, b) =>
          a.title < b.title ? -1 : a.title > b.title ? 1 : 0)
      }
      return {
        ...item,
        children,
      }
    },
    onUpdateSelection(active) {
      this.selectedFolder = active[0]
    },
    onCreate(parentId) {
      const title = prompt(this.t('LabelAddfolder'))
      if (!title) {
        return
      }
      this.$store.dispatch(actions.CREATE_FOLDER, {
        accountId: this.accountId,
        folder: new Folder({title, id: null, parentId})
      })
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