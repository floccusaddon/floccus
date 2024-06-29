<template>
  <v-container
    class="mt-2"
    :style="{maxWidth: '500px'}">
    <template v-if="loading && !Object.keys(accountData).length">
      <div
        class="ma-16 mx-auto"
        :style="{maxWidth: '50px'}">
        <v-progress-circular
          indeterminate />
      </div>
    </template>
    <template v-else>
      <template v-for="account in accountData">
        <AccountCard
          v-if="account.data.enabled"
          :key="account.id"
          :account="account"
          class="mb-3" />
      </template>
      <template v-for="account in accountData">
        <!-- Sort disabled accounts last -->
        <AccountCard
          v-if="!account.data.enabled"
          :key="account.id"
          :account="account"
          class="mb-3" />
      </template>
      <v-container
        v-if="!Object.keys(accountData).length"
        class="mt-12 pt-12"
        :style="{maxWidth: '300px', margin: '0 auto'}">
        <div class="headline">
          {{ t('LabelNoAccount') }}
        </div>
        <div class="body-1">
          {{ t('DescriptionNoAccount') }}
        </div>
      </v-container>
      <v-container class="d-flex flex-row pa-0">
        <v-btn
          class="flex-grow-1 me-1"
          color="primary"
          :to="{ name: routes.NEW_ACCOUNT }"
          target="_blank">
          <v-icon>
            mdi-plus
          </v-icon>
          {{ t('LabelNewAccount') }}
        </v-btn>
        <v-btn
          class="me-1"
          :title="t('LabelImportExport')"
          :to="{ name: routes.IMPORTEXPORT }"
          target="_blank">
          <v-icon>mdi-export</v-icon>
        </v-btn>
        <v-btn
          :title="t('LabelSyncall')"
          @click="clickSyncAll">
          <v-icon>mdi-sync-circle</v-icon>
        </v-btn>
      </v-container>
    </template>
  </v-container>
</template>

<script>
import AccountCard from '../components/AccountCard'
import { routes } from '../router'
import { actions } from '../store/definitions'

export default {
  name: 'Overview',
  components: { AccountCard },
  computed: {
    accountData() {
      return this.$store.state.accounts
    },
    routes() {
      return routes
    },
    loading() {
      return this.$store.state.loading.accounts
    },
  },
  methods: {
    clickSyncAll() {
      this.$store.dispatch(actions.TRIGGER_SYNC_ALL)
    }
  }
}
</script>

<style scoped>
.fab {
  position: absolute;
  bottom: 0;
  right: 20px;
}
</style>
