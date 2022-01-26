<template>
  <div>
    <div class="text-h6">
      {{ t('LabelDownloadlogs') }}
    </div>
    <div class="caption">
      {{ t('DescriptionDownloadlogs') }}
    </div>
    <v-checkbox
      v-model="anonymous"
      :true-value="true"
      :false-value="false"
      :label="t('LabelAnonymizelogs')" />
    <v-btn
      small
      class="mb-5"
      @click="onGetLogs">
      {{ t('LabelDownloadlogs') }}
    </v-btn>
  </div>
</template>

<script>
export default {
  name: 'OptionDownloadLogs',
  data() {
    return {
      anonymous: true,
    }
  },
  methods: {
    onGetLogs() {
      this.$store.dispatch('DOWNLOAD_LOGS', this.anonymous)
    }
  }
}
</script>

<style scoped>

</style>
