<template>
  <v-container>
    <div class="heading">
      {{ t('LabelStrategy') }}
    </div>
    <div class="caption">
      {{ t('DescriptionStrategy') }}
    </div>
    <v-radio-group
      :value="value"
      @change="$emit('input', $event)">
      <v-radio
        :label="t('LabelStrategydefault')"
        value="default" />
      <v-radio
        :label="t('LabelStrategyslave')"
        value="slave" />
      <v-radio
        :label="t('LabelStrategyoverwrite')"
        value="overwrite" />
    </v-radio-group>
  </v-container>
</template>

<script>
export default {
  name: 'OptionSyncStrategy',
  props: {
    value: {
      type: String,
      default: 'default',
    }
  },
}
</script>

<style scoped>

</style>
