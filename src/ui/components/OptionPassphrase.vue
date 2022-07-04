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
        <v-btn @click="editing = true; passphrase = value">
          <v-icon>mdi-pencil-lock</v-icon>Change
        </v-btn>
        <v-btn @click="$emit('input', '')">
          <v-icon>mdi-lock-remove</v-icon>Remove
        </v-btn>
      </template>
      <template v-else>
        <v-btn @click="editing = true">
          <v-icon>mdi-lock-plus</v-icon>Add
        </v-btn>
      </template>
    </template>
    <template v-else>
      <v-text-field
        v-model="passphrase"
        class="mt-2"
        :label="t('LabelPassphrase')"
        :append-icon="showPassphrase ? 'mdi-eye' : 'mdi-eye-off'"
        :type="showPassphrase ? 'text' : 'password'"
        @click:append="showPassphrase = !showPassphrase" />
      <v-btn
        color="primary"
        @click="$emit('input', passphrase); editing = false">
        <v-icon>mdi-check</v-icon>
        Save passphrase
      </v-btn>
      <v-btn @click="editing = false">
        <v-icon>mdi-close</v-icon>
        Cancel
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
