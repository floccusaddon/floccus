<template>
  <v-container>
    <div class="heading">
      {{ t('LabelRemoveaccount') }}
    </div>
    <div class="caption">
      {{ t('DescriptionRemoveaccount') }}
    </div>
    <v-btn
      small
      class="mt-3"
      @click="$emit('click')">
      {{ t('LabelRemoveaccount') }}
    </v-btn>
  </v-container>
</template>

<script>
export default {
  name: 'OptionDeleteAccount',
}
</script>

<style scoped>

</style>
