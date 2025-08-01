<template>
  <div style="padding-top: env(safe-area-inset-top); position: absolute; inset: 0; overflow: hidden;">
    <Drawer :visible.sync="drawer" />
    <v-app-bar
      fixed
      style="top: env(safe-area-inset-top);"
      app>
      <v-app-bar-nav-icon
        class="mr-2 ml-n2"
        @click="drawer = !drawer" />
      <v-app-bar-title>{{ t('LabelImportExport') }}</v-app-bar-title>
    </v-app-bar>
    <v-main
      :class="{'pt-7': true }"
      style="height: 100%; overflow-y: auto;">
      <ImportExportContent />
    </v-main>
  </div>
</template>

<script>
import Drawer from '../../components/native/Drawer'
import ImportExportContent from '../ImportExport'

export default {
  name: 'ImportExport',
  components: { Drawer, ImportExportContent },
  data() {
    return {
      drawer: false,
    }
  }
}
</script>

<style scoped>

</style>
