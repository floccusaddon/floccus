<template>
  <div>
    <div class="text-h6">
      {{ t('LabelFiletype') }}
    </div>
    <div class="caption">
      {{ t('DescriptionFiletype') }}
    </div>
    <v-radio-group
      :value="value"
      @change="$emit('input', $event)">
      <v-radio
        :label="t('LabelFiletypexbel')"
        value="xbel" />
      <v-radio
        :label="t('LabelFiletypehtml')"
        value="html" />
    </v-radio-group>
  </div>
</template>

<script>
export default {
  name: 'OptionFileType',
  props: {
    value: {
      type: String,
      default: 'xbel',
    }
  },
}
</script>

<style scoped>

</style>
