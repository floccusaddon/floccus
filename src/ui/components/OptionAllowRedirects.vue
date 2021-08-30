<template>
  <div>
    <div class="text-h6">
      {{ t('LabelAllowredirects') }}
    </div>
    <div class="caption">
      {{ t('DescriptionAllowredirects') }}
    </div>
    <v-checkbox
      :input-value="value"
      :true-value="true"
      :false-value="false"
      :label="t('LabelAllowredirects')"
      @change="$emit('input', $event)" />
  </div>
</template>

<script>
export default {
  name: 'OptionAllowRedirects',
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
