<template>
  <v-container>
    <v-card
      class="options mt-3">
      <v-container class="pa-5">
        <v-card-title>
          {{ t("LabelUpdated") }}
        </v-card-title>
        <v-card-text>
          <div class="body-1">
            {{ t('DescriptionUpdated') }}
          </div>
          <v-btn
            class="primary mt-2"
            target="_blank"
            :href="`https://github.com/marcelklehr/floccus/releases/tag/v${VERSION}`">
            {{ t('LabelReleaseNotes') }}
          </v-btn>
        </v-card-text>
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
        <v-card-text v-if="!isBrowser">
          <v-btn
            class="primary mt-2"
            target="_blank"
            :to="{name: nativeRoutes.HOME }">
            {{ t('LabelContinuefloccus') }}
          </v-btn>
        </v-card-text>
      </v-container>
    </v-card>
  </v-container>
</template>

<script>
import {version as VERSION} from '../../../package.json'
import { routes } from '../NativeRouter'
import browser from '../../lib/browser-api'

export default {
  name: 'Update',
  components: {},
  data() {
    return {
      paymentOptions: [
        {
          href: 'https://www.paypal.me/marcelklehr1',
          label: this.t('LabelPaypal'),
          description: this.t('DescriptionPaypal')
        },
        {
          href: 'https://opencollective.com/floccus',
          label: this.t('LabelOpencollective'),
          description: this.t('DescriptionOpencollective')
        },
        {
          href: 'https://liberapay.com/marcelklehr/donate',
          label: this.t('LabelLiberapay'),
          description: this.t('DescriptionLiberapay')
        },
        {
          href: 'https://github.com/users/marcelklehr/sponsorship',
          label: this.t('LabelGithubsponsors'),
          description: this.t('DescriptionGithubsponsors')
        },
        {
          href: 'https://www.patreon.com/marcelklehr',
          label: this.t('LabelPatreon'),
          description: this.t('DescriptionPatreon')
        },
        {
          href: 'https://www.ko-fi.com/marcelklehr',
          label: this.t('LabelKofi'),
          description: this.t('DescriptionKofi')
        },
      ]
    }
  },
  computed: {
    VERSION() {
      return VERSION
    },
    nativeRoutes() {
      return routes
    }
  },
  methods: {
  }
}
</script>

<style scoped>
    .options {
        max-width: 600px;
        margin: 0 auto;
    }
    @media screen and (min-width: 600px) {
      .v-card--flat {
        width: 48%
      }
    }
</style>
