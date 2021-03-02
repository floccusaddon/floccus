<template>
  <v-container>
    <div class="heading">
      {{ t('LabelClientcert') }}
    </div>
    <div class="caption">
      {{ t('DescriptionClientcert') }}
    </div>
    <v-checkbox
      :input-value="value"
      :true-value="true"
      :false-value="false"
      :label="t('LabelClientcert')"
      @change="$emit('input', $event)" />
  </v-container>
</template>

<script>
export default {
  name: 'OptionClientCert',
  props: {
    value: {
      type: Boolean,
      default: false,
    }
  },
}
</script>

<style scoped>

</style>
