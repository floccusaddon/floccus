<template>
  <div>
    <div class="text-h6">
      {{ t('LabelSyncintervalenabled') }}
    </div>
    <div class="caption">
      {{ t('DescriptionSyncintervalenabled') }}
    </div>
    <v-switch
      :input-value="value"
      :aria-label="t('LabelSyncintervalenabled')"
      :label="t('LabelSyncintervalenabled')"
      dense
      class="mt-0 pt-0"
      @change="$emit('input', $event)" />
  </div>
</template>

<script>
export default {
  name: 'OptionSyncIntervalEnabled',
  props: {
    value: {
      type: Boolean,
      default: true,
    }
  },
}
</script>

<style scoped>

</style>
