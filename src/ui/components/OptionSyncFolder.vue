<template>
  <div>
    <v-container>
      <div class="heading">
        {{ t('LabelLocalfolder') }}
      </div>
      <div class="caption">
        {{ t('DescriptionLocalfolder') }}
      </div>
      <v-radio-group
        v-model="mode"
        column>
        <v-radio value="folder">
          <template #label>
            {{ t('LabelLocalfolder') }}
            &nbsp;
            <v-text-field
              v-model="path"
              readonly
              @click="onTriggerFinder">
              <template #append>
                <v-icon
                  color="blue"
                  @click="onTriggerFinder">
                  mdi-folder
                </v-icon>
              </template>
            </v-text-field>
          </template>
        </v-radio>
        <v-radio
          :label="t('LabelSyncTabs')"
          value="tabs" />
      </v-radio-group>
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
          :active="[value]"
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
      if (this.value) {
        this.path = decodeURIComponent(
          await LocalTree.getPathFromLocalId(this.value)
        ) + '/'
      } else {
        this.path = this.t('LabelNewfolder')
      }
    },
    async onTriggerFinder() {
      this.selectedLocalRoot = this.value
      this.finder = true
      this.folders = await browser.bookmarks.getTree()
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
