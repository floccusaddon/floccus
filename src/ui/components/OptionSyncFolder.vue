<template>
  <div>
    <v-container>
      <div class="heading">
        {{ t('LabelLocalfolder') }}
      </div>
      <div class="caption">
        {{ t('DescriptionLocalfolder') }}
      </div>
      <v-text-field
        v-model="path"
        readonly
        @click="onTriggerFinder">
        <template v-slot:append>
          <v-icon
            color="blue"
            @click="onTriggerFinder">
            mdi-folder
          </v-icon>
        </template>
      </v-text-field>
    </v-container>
    <v-dialog
      v-model="finder"
      max-width="600"
      :style="{height: '500px'}">
      <v-card>
        <v-row no-gutters>
          <v-col class="flex-grow-1">
            <v-card-title class="headline">
              {{ t('LabelLocalfolder') }}
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
          :filter="(item)=>!item.url"
          :active="[localRoot]"
          :open="folders.length? [folders[0].id] : []"
          :items="folders"
          dense
          @update:active="onUpdateSelection">
          <template v-slot:label="{item}">
            {{ item.title || t('LabelUntitledfolder') }}
          </template>
        </v-treeview>
      </v-card>
    </v-dialog>
  </div>
</template>

<script>
import LocalTree from '../../lib/LocalTree'
import browser from '../../lib/browser-api'

export default {
  name: 'OptionSyncFolder',
  props: { value: { type: String, default: undefined } },
  data() {
    return {
      localRoot: this.value,
      selectedLocalRoot: this.value,
      path: '',
      finder: false,
      folders: [],
    }
  },
  watch: {
    localRoot(localRoot) {
      this.updatePath()
    }
  },
  created() {
    this.updatePath()
  },
  methods: {
    async updatePath() {
      this.path = decodeURIComponent(
        await LocalTree.getPathFromLocalId(this.localRoot)
      ) + '/'
    },
    async onTriggerFinder() {
      this.selectedLocalRoot = this.localRoot
      this.finder = true
      this.folders = await browser.bookmarks.getTree()
    },
    onUpdateSelection(active) {
      this.selectedLocalRoot = active[0]
    },
    onSave() {
      this.finder = false
      this.localRoot = this.selectedLocalRoot
      this.$emit('input', this.localRoot)
    }
  }
}
</script>

<style scoped>

</style>
