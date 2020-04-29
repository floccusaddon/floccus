<template>
  <v-container>
    <div class="heading">
      {{ t('LabelResetCache') }}
    </div>
    <div class="caption">
      {{ t('DescriptionResetCache') }}
    </div>
    <v-btn
      small
      class="mt-3"
      @click="$emit('click')">
      {{ t('LabelResetCache') }}
    </v-btn>
  </v-container>
</template>

<script>
export default {
  name: 'OptionResetCache',
}
</script>

<style scoped>

</style>
