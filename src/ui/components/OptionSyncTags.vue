<template>
  <div>
    <div class="text-h6">
      {{ t('LabelSyncTags') }}
    </div>
    <div class="caption">
      {{ t('DescriptionSyncTags') }}
    </div>
    <v-switch
      :input-value="value"
      :label="t('LabelSyncTags')"
      :hint="t('DescriptionSyncTags')"
      dense
      class="mt-0 pt-0 mb-4"
      @change="$emit('input', $event)" />
  </div>
</template>

<script>
export default {
  name: 'OptionSyncTags',
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
