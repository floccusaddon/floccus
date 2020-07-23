<template>
  <v-container>
    <div class="heading">
      {{ t('LabelNestedSync') }}
    </div>
    <div class="caption">
      {{ t('DescriptionNestedSync') }}
    </div>
    <v-radio-group
      :value="value"
      @change="$emit('input', $event)">
      <v-radio
        :label="t('LabelNestedSyncNo')"
        :value="false" />
      <v-radio
        :label="t('LabelNestedSyncYes')"
        :value="true" />
    </v-radio-group>
  </v-container>
</template>

<script>
export default {
  name: 'OptionNestedSync',
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
