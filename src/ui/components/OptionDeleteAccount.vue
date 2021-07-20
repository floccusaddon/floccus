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
      @click="onClick">
      {{ t('LabelRemoveaccount') }}
    </v-btn>
  </v-container>
</template>

<script>
export default {
  name: 'OptionDeleteAccount',
  methods: {
    onClick() {
      if (window.confirm('Do you really want to remove this account?')) {
        this.$emit('click')
      }
    }
  }
}
</script>

<style scoped>

</style>
