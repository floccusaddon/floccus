<template>
  <div>
    <div class="text-h6">
      {{ t('LabelSyncfromscratch') }}
    </div>
    <div class="caption">
      {{ t('DescriptionResetcache') }}
    </div>
    <v-btn
      small
      class="mt-3 mb-5"
      @click="$emit('click')">
      {{ t('LabelResetCache') }}
    </v-btn>
  </div>
</template>

<script>
export default {
  name: 'OptionResetCache',
}
</script>

<style scoped>

</style>
