<template>
  <div>
    <div class="text-h6">
      {{ t('LabelAllownetwork') }}
    </div>
    <div class="caption">
      {{ t('DescriptionAllownetwork') }}
    </div>
    <v-checkbox
      :input-value="value"
      :true-value="true"
      :false-value="false"
      :label="t('LabelAllownetwork')"
      @change="$emit('input', $event)" />
  </div>
</template>

<script>
export default {
  name: 'OptionAllowNetwork',
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
