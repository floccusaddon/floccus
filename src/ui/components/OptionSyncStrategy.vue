<template>
  <v-container>
    <div class="heading">
      {{ t('LabelStrategy') }}
    </div>
    <div class="caption">
      {{ t('DescriptionStrategy') }}
    </div>
    <v-radio-group v-model="strategy">
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
  data() {
    return {
      strategy: this.value
    }
  },
  watch: {
    strategy(value) {
      this.$emit('input', value)
    }
  }
}
</script>

<style scoped>

</style>
