<template>
  <div>
    <div class="text-h6">
      {{ t('LabelAutosync') }}
    </div>
    <div class="caption">
      {{ t('DescriptionAutosync') }}
    </div>
    <v-switch
      :input-value="value"
      :aria-label="t('LabelAutosync')"
      :label="t('LabelAutosync')"
      dense
      class="mt-0 pt-0"
      @change="$emit('input', $event)" />
  </div>
</template>

<script>
export default {
  name: 'OptionAutoSync',
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
