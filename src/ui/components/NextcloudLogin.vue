<template>
  <div>
    <v-text-field
      :value="username"
      :label="t('LabelUsername')"
      :loading="isRunning"
      :error-messages="error"
      @input="$emit('update:username', username)">
      <template slot="append-outer">
        <v-tooltip
          v-if="!isRunning"
          left>
          <template v-slot:activator="{ on }">
            <v-btn
              icon
              @click="onFlowStart"
              v-on="on">
              <v-icon>mdi-account-circle</v-icon>
            </v-btn>
          </template>
          <span>Login with Nextcloud Flow</span>
        </v-tooltip>
        <v-tooltip
          v-else
          left>
          <template v-slot:activator="{ on }">
            <v-btn
              icon
              @click="onFlowStop"
              v-on="on">
              <v-icon>mdi-cancel</v-icon>
            </v-btn>
          </template>
          <span>Cancel Nextcloud Login Flow</span>
        </v-tooltip>
      </template>
    </v-text-field>
    <v-text-field
      :value="password"
      type="password"
      :label="t('LabelPassword')"
      @input="$emit('update:password', password)" />
  </div>
</template>

<script>
import { actions } from '../store'

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
    return {error: null}
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
        this.username = credentials.username
        this.$emit('update:username', credentials.username)
        this.password = credentials.password
        this.$emit('update:password', credentials.password)
      } catch (e) {
        this.error = e.message
      }
    },
    async onFlowStop() {
      await this.$store.dispatch(actions.STOP_LOGIN_FLOW)
    }
  }
}
</script>

<style scoped>

</style>
