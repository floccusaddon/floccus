<template>
  <v-progress-circular
    indeterminate
    color="blue"
    class="ma-auto" />
</template>

<script>
import { actions } from '../../store/native'
import { routes } from '../../NativeRouter'

export default {
  name: 'Home',
  async created() {
    await this.$store.dispatch(actions.LOAD_ACCOUNTS)
    if (Object.keys(this.$store.state.accounts).length) {
      const accountId = Object.keys(this.$store.state.accounts)[0]
      this.$router.push({name: routes.TREE, params: {accountId}})
    } else {
      this.$router.push({name: routes.NEW_ACCOUNT})
    }
  }
}
</script>

<style scoped>

</style>
