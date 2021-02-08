<template>
  <v-container>
    <div class="heading">
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
  </v-container>
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
