<template>
  <div>
    <v-text-field
      :value="username"
      :label="t('LabelUsername')"
      :loading="isRunning"
      :error-messages="error"
      @input="$emit('update:username', $event)">
      <template
        slot="append-outer">
        <v-tooltip
          v-if="!isRunning"
          left>
          <template #activator="{ on }">
            <v-btn
              icon
              @click="onFlowStart"
              v-on="on">
              <v-icon>mdi-account-circle</v-icon>
            </v-btn>
          </template>
          <span>{{ t('LabelLoginFlowStart') }}</span>
        </v-tooltip>
        <v-tooltip
          v-else
          left>
          <template #activator="{ on }">
            <v-btn
              icon
              @click="onFlowStop"
              v-on="on">
              <v-icon>mdi-cancel</v-icon>
            </v-btn>
          </template>
          <span>{{ t('LabelLoginFlowStop') }}</span>
        </v-tooltip>
      </template>
    </v-text-field>
    <v-text-field
      :append-icon="showPassword ? 'mdi-eye' : 'mdi-eye-off'"
      :type="showPassword ? 'text' : 'password'"
      :label="t('LabelPassword')"
      @click:append="showPassword = !showPassword"
      @input="$emit('update:password', $event)" />
  </div>
</template>

<script>
import { actions } from '../store/definitions'

export default {
  name: 'NextcloudLogin',
  props: {
    password: {
      type: String,
      required: true
    },
    username: {
      type: String,
      required: true
    },
    server: {
      type: String,
      required: true
    }
  },
  data() {
    return {error: null, showPassword: false}
  },
  computed: {
    isRunning() {
      return this.$store.state.loginFlow.isRunning
    }
  },
  methods: {
    async onFlowStart() {
      this.error = null
      try {
        const credentials = await this.$store.dispatch(actions.START_LOGIN_FLOW, this.server)
        this.$emit('update:username', credentials.username)
        this.$emit('update:password', credentials.password)
      } catch (e) {
        this.error = e.message
      }
    },
    async onFlowStop() {
      await this.$store.dispatch('STOP_LOGIN_FLOW')
    }
  }
}
</script>

<style scoped>

</style>
