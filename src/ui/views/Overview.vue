<template>
  <v-container
    class="mt-2"
    :style="{maxWidth: '500px'}">
    <AccountCard
      v-for="account in accountData"
      :key="account.id"
      :account="account"
      class="mb-3" />
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
    <v-btn
      fab
      class="primary fab"
      :to="{name: routes.NEW_ACCOUNT}"
      target="_blank">
      <v-icon color="white">
        mdi-plus
      </v-icon>
    </v-btn>
  </v-container>
</template>

<script>
import AccountCard from '../components/AccountCard'
import { routes } from '../router'
export default {
  name: 'Overview',
  components: { AccountCard },
  computed: {
    accountData() {
      return this.$store.state.accounts
    },
    routes() {
      return routes
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
