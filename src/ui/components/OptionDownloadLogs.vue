<template>
  <div>
    <div class="text-h6">
      {{ t('LabelDownloadlogs') }}
    </div>
    <div class="caption">
      {{ t('DescriptionDownloadlogs') }}
    </div>
    <v-row>
      <v-col>
        <v-btn
          small
          class="mb-5"
          @click="onGetLogs(true)">
          {{ t('LabelDownloadanonymizedlogs') }}
        </v-btn>
      </v-col>
      <v-col>
        <v-btn
          small
          class="mb-5"
          @click="onGetLogs(false)">
          {{ t('LabelDownloadfulllogs') }}
        </v-btn>
      </v-col>
    </v-row>
  </div>
</template>

<script>
export default {
  name: 'OptionDownloadLogs',
  methods: {
    onGetLogs(anonymous) {
      this.$store.dispatch('DOWNLOAD_LOGS', anonymous)
    }
  }
}
</script>

<style scoped>

</style>
