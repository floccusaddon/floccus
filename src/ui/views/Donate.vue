<template>
  <v-container>
    <v-card
      class="options mt-3">
      <v-container class="pa-5">
        <v-card-title
          role="heading"
          aria-level="1">
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
              class="me-2 mb-2"
              :target="processor.href ? '_blank' : undefined"
              width="48%"
              :href="processor.href"
              @click="processor.dialog && (dialog = processor.dialog)">
              <v-card-title
                class="white--text"
                role="heading"
                aria-level="2">
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
    <v-dialog
      :value="dialog === 'wero'"
      width="500"
      @input="dialog = null">
      <v-card>
        <v-card-title>{{ t('LabelWero') }}</v-card-title>
        <v-card-text>{{ t('DescriptionWeroQrcode') }}</v-card-text>
        <v-card-text>
          <v-img
            src="/dist/icons/wero-qr-code.svg"
            max-width="300"
            class="mx-auto" />
        </v-card-text>
        <v-card-text>{{ t('DescriptionWeroSearch', ['me@marcelklehr.de']) }}</v-card-text>
        <v-divider />
        <v-card-actions>
          <v-spacer />
          <v-btn
            color="primary"
            text
            @click="dialog = null">
            {{ t('LabelDone') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
    <v-dialog
      :value="dialog === 'sepa'"
      width="500"
      @input="dialog = null">
      <v-card>
        <v-card-title>{{ t('LabelBankwire') }}</v-card-title>
        <v-card-text>
          <code>{{ t('LabelAccountholder') }}: Marcel Klehr</code><br>
          <code>IBAN: DE98 1203 0000 1313 9691 96</code><br>
          <code>BIC: BYLADEM1001</code>
        </v-card-text>
        <v-divider />
        <v-card-actions>
          <v-spacer />
          <v-btn
            color="primary"
            text
            @click="dialog = null">
            {{ t('LabelDone') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-container>
</template>

<script>
import browser from '../../lib/browser-api'

export default {
  name: 'Donate',
  components: {},
  data() {
    return {
      dialog: null,
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
          href: 'https://github.com/sponsors/marcelklehr',
          label: browser.i18n.getMessage('LabelGithubsponsors'),
          description: browser.i18n.getMessage('DescriptionGithubsponsors')
        },
        {
          href: 'https://www.patreon.com/marcelklehr',
          label: browser.i18n.getMessage('LabelPatreon'),
          description: browser.i18n.getMessage('DescriptionPatreon')
        },
        {
          href: 'https://ko-fi.com/marcelklehr',
          label: browser.i18n.getMessage('LabelKofi'),
          description: browser.i18n.getMessage('DescriptionKofi')
        },
        {
          dialog: 'wero',
          label: browser.i18n.getMessage('LabelWero'),
          description: browser.i18n.getMessage('DescriptionWero')
        },
        {
          dialog: 'sepa',
          label: browser.i18n.getMessage('LabelBankwire'),
          description: browser.i18n.getMessage('DescriptionBankwire')
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
