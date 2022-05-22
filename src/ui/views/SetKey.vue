<template>
  <v-container>
    <v-card
      class="options mt-3">
      <v-container class="pa-5">
        <v-card-title>
          {{ t("LabelSetkey") }}
        </v-card-title>
        <v-card-text>
          <div class="body-1">
            {{ t("DescriptionSetkey") }}
          </div>
          <v-form>
            <v-text-field
              v-model="key1"
              type="password"
              :label="t('LabelKey')" />
            <v-text-field
              v-model="key2"
              type="password"
              :label="t('LabelKey2')"
              :rules="[validateKeys]" />
          </v-form>
          <div class="d-flex flex-row-reverse">
            <v-btn
              class="primary"
              :disabled="!key1 || !key2 || !validateKeys()"
              @click="onSubmit">
              <v-icon>mdi-lock-outline</v-icon>
              {{ t("LabelSetkeybutton") }}
            </v-btn>
            <v-btn
              v-if="secured"
              class="mr-2"
              @click="onRemove">
              {{ t("LabelRemovekey") }}
            </v-btn>
          </div>
        </v-card-text>
      </v-container>
    </v-card>
    <v-dialog
      v-model="doneSet"
      :max-width="600"
      persistent>
      <v-card>
        <v-card-title><v-icon>mdi-lock-outline</v-icon>{{ t("LabelSecuredcredentials") }}</v-card-title>
      </v-card>
    </v-dialog>
    <v-dialog
      v-model="doneRemove"
      :max-width="600">
      <v-card>
        <v-card-title><v-icon>mdi-lock-open-outline</v-icon>{{ t("LabelRemovedkey") }}</v-card-title>
      </v-card>
    </v-dialog>
  </v-container>
</template>

<script>

import { actions } from '../store'

export default {
  name: 'SetKey',
  components: {},
  data() {
    return {
      key1: '',
      key2: '',
      doneSet: false,
      doneRemove: false,
    }
  },
  computed: {
    secured() {
      return this.$store.state.secured
    }
  },
  methods: {
    validateKeys() {
      return this.key1 === this.key2
    },
    async onSubmit() {
      if (!this.validateKeys()) return
      await this.$store.dispatch(actions.SET_KEY, this.key1)
      this.doneSet = true
    },
    async onRemove() {
      await this.$store.dispatch(actions.UNSET_KEY)
      this.doneRemove = true
    }
  }
}
</script>

<style scoped>
    .options {
        max-width: 600px;
        margin: 0 auto;
    }
</style>
