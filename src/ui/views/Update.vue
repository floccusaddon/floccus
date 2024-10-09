<template>
  <v-container>
    <v-card
      class="options mt-3">
      <v-container class="pa-5">
        <v-card-title>
          <a
            href="https://floccus.org"
            class="d-flex align-center"><img src="/dist/icons/logo_128.png"> Cross-browser bookmark syncing</a>
        </v-card-title>
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
        <template v-if="donateOrReview">
          <v-card-title>
            {{ t("LabelWritereview") }}
          </v-card-title>
          <v-card-text>
            <div class="body-1">
              {{ t("DescriptionWritereview") }}
            </div>
            <div class="d-flex flex-wrap mt-4">
              <v-card
                v-for="platform in reviewOptions"
                :key="platform.label"
                tile
                flat
                :color="'light-blue'"
                class="mr-2 mb-2"
                target="_blank"
                :href="platform.href">
                <v-card-title class="white--text">
                  {{ platform.label }}
                </v-card-title>
                <v-card-text class="white--text">
                  {{ platform.description }}
                </v-card-text>
              </v-card>
            </div>
          </v-card-text>
        </template>
        <template v-else>
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
        </template>
        <v-card-title>
          {{ t("LabelTelemetry") }}
        </v-card-title>
        <v-card-text>
          <div class="body-1">
            {{ t("DescriptionTelemetry") }}
          </div>
          <v-radio-group
            v-model="telemetry"
            class="mt-4">
            <v-radio :value="true">
              <template #label>
                <div class="heading">
                  {{ t("LabelTelemetryenable") }}
                </div>
              </template>
            </v-radio>
            <v-radio :value="false">
              <template #label>
                <div class="heading">
                  {{ t("LabelTelemetrydisable") }}
                </div>
              </template>
            </v-radio>
          </v-radio-group>
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
      donateOrReview: Boolean(Math.round(Math.random())),
      telemetry: false,
      paymentOptions: [
        {
          href: 'https://www.paypal.com/donate/?hosted_button_id=R3SDCC7AFSYZU',
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
      ],
      reviewOptions: [],
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
  watch: {
    telemetry(enabled) {
      browser.storage.local.set({'telemetryEnabled': enabled})
    }
  },
  async created() {
    const {telemetryEnabled} = await browser.storage.local.get({'telemetryEnabled': false})
    this.telemetry = telemetryEnabled
    this.reviewOptions = (!this.isBrowser ? [
      {
        href: 'https://play.google.com/store/apps/details?id=org.handmadeideas.floccus',
        label: 'Google Play',
        description: this.t('DescriptionGoogleplayreview')
      },
      {
        href: 'https://apps.apple.com/us/app/floccus/id1626998357',
        label: 'Apple App Store',
        description: this.t('DescriptionAppstorereview')
      }] : []).concat([
      {
        href: 'https://addons.mozilla.org/de/firefox/addon/floccus/reviews/',
        label: 'Mozilla Addons',
        description: this.t('DescriptionMozillareview')
      },
      {
        href: 'https://chromewebstore.google.com/detail/floccus-bookmarks-sync/fnaicdffflnofjppbagibeoednhnbjhg',
        label: 'Chrome WebStore',
        description: this.t('DescriptionChromereview')
      },
      {
        href: 'https://microsoftedge.microsoft.com/addons/detail/gjkddcofhiifldbllobcamllmanombji',
        label: 'Edge Addons',
        description: this.t('DescriptionEdgereview')
      },
      {
        href: 'https://alternativeto.net/software/floccus/about/',
        label: 'AlternativeTo.net',
        description: this.t('DescriptionAlternativereview')
      },
    ])
  },
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
    a:link {
      color: inherit;
      text-decoration: none;
    }
</style>
