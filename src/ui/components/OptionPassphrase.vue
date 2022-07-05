<template>
  <div>
    <div class="text-h6">
      {{ t('LabelPassphrase') }}
    </div>
    <div class="caption">
      {{ t('DescriptionPassphrase') }}
    </div>
    <template v-if="!editing">
      <template v-if="value">
        <v-btn @click="editing = true">
          <v-icon>mdi-pencil-lock</v-icon>{{ t('LabelChange') }}
        </v-btn>
        <v-btn @click="$emit('input', '')">
          <v-icon>mdi-lock-remove</v-icon>{{ t('LabelRemove') }}
        </v-btn>
      </template>
      <template v-else>
        <v-btn @click="editing = true">
          <v-icon>mdi-lock-plus</v-icon>{{ t('LabelAdd') }}
        </v-btn>
      </template>
    </template>
    <template v-else>
      <v-text-field
        class="mt-2"
        :label="t('LabelPassphrase')"
        :append-icon="showPassphrase ? 'mdi-eye' : 'mdi-eye-off'"
        :type="showPassphrase ? 'text' : 'password'"
        @input="passphrase = $event"
        @click:append="showPassphrase = !showPassphrase" />
      <v-btn
        color="primary"
        @click="$emit('input', passphrase); editing = false">
        <v-icon>mdi-check</v-icon>
        {{ t('LabelSave') }}
      </v-btn>
      <v-btn @click="editing = false">
        <v-icon>mdi-close</v-icon>
        {{ t('LabelCancel') }}
      </v-btn>
    </template>
  </div>
</template>

<script>
export default {
  name: 'OptionPassphrase',
  props: {
    value: {
      type: String,
      required: true
    }
  },
  data() {
    return {
      showPassphrase: false,
      editing: false,
      passphrase: '',
    }
  }
}
</script>

<style scoped>

</style>
