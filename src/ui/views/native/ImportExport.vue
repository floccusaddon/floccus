<template>
  <div>
    <Drawer :visible.sync="drawer" />
    <v-app-bar
      absolute
      app>
      <v-app-bar-nav-icon
        class="mr-2 ml-n2"
        @click="drawer = !drawer" />
      <v-app-bar-title>{{ t('LabelImportExport') }}</v-app-bar-title>
    </v-app-bar>
    <v-main>
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
