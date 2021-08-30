<template>
  <div>
    <div class="text-h6">
      {{ t('LabelFailsafe') }}
    </div>
    <div class="caption">
      {{ t('DescriptionFailsafe') }}
    </div>
    <v-radio-group
      :value="value"
      @change="$emit('input', $event)">
      <v-radio
        :label="t('LabelFailsafeon')"
        :value="true" />
      <v-radio
        :label="t('LabelFailsafeoff')"
        :value="false" />
    </v-radio-group>
  </div>
</template>

<script>
export default {
  name: 'OptionFailsafe',
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
