<template>
  <v-container>
    <v-card
      class="options mt-3">
      <v-container class="pa-5">
        <v-card-title>
          {{ t("LabelFunddevelopment") }}
        </v-card-title>
        <v-card-text>
          <div class="body-1">
            {{ t("DescriptionFunddevelopment") }}
          </div>
          <div class="d-flex flex-wrap mt-4">
            <v-card
              v-for="processor in paymentOptions"
              :key="processor.label"
              tile
              flat
              :color="'light-blue'"
              class="mr-2 mb-2"
              target="_blank"
              width="48%"
              :href="processor.href">
              <v-card-title class="white--text">
                {{ processor.label }}
              </v-card-title>
              <v-card-text class="white--text">
                {{ processor.description }}
              </v-card-text>
            </v-card>
          </div>
        </v-card-text>
      </v-container>
    </v-card>
  </v-container>
</template>

<script>
import browser from '../../lib/browser-api'

export default {
  name: 'Donate',
  components: {},
  data() {
    return {
      paymentOptions: [
        {
          href: 'https://www.paypal.com/donate/?hosted_button_id=R3SDCC7AFSYZU',
          label: browser.i18n.getMessage('LabelPaypal'),
          description: browser.i18n.getMessage('DescriptionPaypal')
        },
        {
          href: 'https://opencollective.com/floccus',
          label: browser.i18n.getMessage('LabelOpencollective'),
          description: browser.i18n.getMessage('DescriptionOpencollective')
        },
        {
          href: 'https://liberapay.com/marcelklehr/donate',
          label: browser.i18n.getMessage('LabelLiberapay'),
          description: browser.i18n.getMessage('DescriptionLiberapay')
        },
        {
          href: 'https://github.com/users/marcelklehr/sponsorship',
          label: browser.i18n.getMessage('LabelGithubsponsors'),
          description: browser.i18n.getMessage('DescriptionGithubsponsors')
        },
        {
          href: 'https://www.patreon.com/marcelklehr',
          label: browser.i18n.getMessage('LabelPatreon'),
          description: browser.i18n.getMessage('DescriptionPatreon')
        },
        {
          href: 'https://www.ko-fi.com/marcelklehr',
          label: browser.i18n.getMessage('LabelKofi'),
          description: browser.i18n.getMessage('DescriptionKofi')
        },
      ]
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
