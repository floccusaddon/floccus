<template>
  <div>
    <div class="text-h6">
      {{ t('LabelRemoveaccount') }}
    </div>
    <div class="caption">
      {{ t('DescriptionRemoveaccount') }}
    </div>
    <v-btn
      small
      color="red accent-1"
      class="mt-3"
      @click="onClick">
      {{ t('LabelRemoveaccount') }}
    </v-btn>
  </div>
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
