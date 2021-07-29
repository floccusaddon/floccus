<template>
  <div>
    <div class="text-h6">
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
  </div>
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
