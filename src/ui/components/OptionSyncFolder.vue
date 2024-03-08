<template>
  <div>
    <div>
      <div class="text-h6">
        {{ t('LabelLocaltarget') }}
      </div>
      <div class="caption">
        {{ t('DescriptionLocaltarget') }}
      </div>
      <v-radio-group
        v-model="mode"
        column>
        <v-radio value="folder">
          <template #label>
            {{ t('LabelLocalfolder') }}
            <v-text-field
              v-model="path"
              class="ml-2"
              readonly
              @click="onTriggerFinder">
              <template #append>
                <v-icon
                  color="blue darken-1"
                  @click="onTriggerFinder">
                  mdi-folder
                </v-icon>
              </template>
            </v-text-field>
          </template>
        </v-radio>
        <div class="caption ml-8 mb-6">
          {{ t('DescriptionLocalfolder') }}
        </div>
        <v-radio
          :label="t('LabelSyncTabs')"
          value="tabs" />
        <div class="caption ml-8 mb-2">
          {{ t('DescriptionSyncTabs') }}
        </div>
      </v-radio-group>
    </div>
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
          v-if="folders.length"
          class="pa-4"
          activatable
          :item-text="'title'"
          :item-key="'id'"
          :active="[value]"
          :open="folders.length? [folders[0].id] : []"
          :items="folders"
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
        <v-progress-circular
          v-else
          color="primary"
          indeterminate
          class="ma-8" />
      </v-card>
    </v-dialog>
  </div>
</template>

<script>
import { isVivaldi } from '../../lib/browser/BrowserDetection'

export default {
  name: 'OptionSyncFolder',
  props: { value: { type: String, default: undefined } },
  data() {
    return {
      selectedLocalRoot: this.value,
      path: '',
      mode: 'folder',
      finder: false,
      folders: [],
    }
  },
  watch: {
    value(localRoot) {
      this.selectedLocalRoot = this.value
      this.updatePath()
    },
    mode() {
      if (this.mode === 'tabs') {
        this.$emit('input', 'tabs')
      }
      if (this.mode === 'folder' && this.value === 'tabs') {
        this.$emit('input', '')
      }
    }
  },
  created() {
    this.updatePath()
  },
  methods: {
    async updatePath() {
      if (this.mode === 'tabs' || this.value === 'tabs') {
        this.mode = 'tabs'
        return
      }
      const BrowserTree = (await import('../../lib/browser/BrowserTree')).default
      if (this.value) {
        this.path = decodeURIComponent(
          await BrowserTree.getPathFromLocalId(this.value)
        ) + '/'
      } else {
        this.path = this.t('LabelNewfolder')
      }
    },
    async onTriggerFinder() {
      const browser = (await import('../../lib/browser-api')).default
      this.selectedLocalRoot = this.value
      this.finder = true
      this.folders = this.filterOutBookmarks(await isVivaldi() ? await browser.bookmarks.getSubTree('1') : await browser.bookmarks.getTree())
    },
    filterOutBookmarks(children) {
      return children.filter(item => {
        if (item.children) {
          item.children = this.filterOutBookmarks(item.children)
        }
        return !item.url
      })
    },
    onUpdateSelection(active) {
      this.selectedLocalRoot = active[0]
    },
    onSave() {
      this.finder = false
      this.$emit('input', this.selectedLocalRoot)
    }
  }
}
</script>

<style scoped>

</style>
