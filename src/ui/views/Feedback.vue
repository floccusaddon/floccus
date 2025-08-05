<template>
  <v-container>
    <v-card class="pa-5 options">
      <v-card-title class="ml-0 pl-0">
        <v-icon>mdi-bullhorn-variant-outline</v-icon>{{ t('LabelGivefeedback') }}
      </v-card-title>
      <p>{{ t('DescriptionFeedbackhowto') }}</p>
      <v-text-field
        v-model="name"
        :rules="[validateName]"
        :label="t('LabelYourname')" />
      <v-text-field
        v-model="email"
        :rules="[validateEmail]"
        :label="t('LabelYouremail')" />
      <v-textarea
        v-model="message"
        auto-grow
        solo
        :label="t('LabelYourmessage')">
        >
      </v-textarea>
      <p>{{ t('DescriptionFeedbacklegal') }}</p>
      <v-btn
        :disabled="!submitEnabled"
        color="primary"
        @click="onSubmit()">
        {{ t('LabelSubmitfeedback') }}
      </v-btn>
    </v-card>
  </v-container>
</template>

<script>
import * as Sentry from '@sentry/browser'
import { initEmpty } from '../../lib/sentry'

export default {
  name: 'Feedback',
  data() {
    return {
      drawer: false,
      name: '',
      email: '',
      message: '',
    }
  },
  computed: {
    submitEnabled() {
      return this.validateEmail(this.email) && this.validateName(this.name) && this.message.length > 0
    }
  },
  methods: {
    validateName(name) {
      return name.length > 0
    },
    validateEmail(email) {
      return !email.length || /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w+)+$/.test(email)
    },
    async onSubmit() {
      if (!this.submitEnabled) {
        return
      }
      if (!(await Sentry.isInitialized())) {
        initEmpty()
      }
      Sentry.captureFeedback({
        name: this.name,
        email: this.email,
        message: this.message,
      })
      this.message = ''
      alert(this.t('LabelFeedbacksent'))
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
