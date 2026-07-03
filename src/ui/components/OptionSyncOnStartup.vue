<template>
  <div>
    <div
      class="text-h6"
      role="heading"
      aria-level="3">
      {{ t('LabelSynconstartup') }}
    </div>
    <div class="caption">
      {{ t('DescriptionSynconstartup') }}
    </div>
    <v-switch
      :input-value="value"
      :aria-label="t('LabelSynconstartup')"
      :label="t('LabelSynconstartup')"
      dense
      class="mt-0 pt-0"
      @change="$emit('input', $event)" />
  </div>
</template>

<script>
export default {
  name: 'OptionSyncOnStartup',
  props: {
    value: {
      type: Boolean,
      default: false,
    },
  },
}
</script>

<style scoped></style>
