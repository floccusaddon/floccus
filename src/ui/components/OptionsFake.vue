<template>
  <div>
    <OptionResetCache @click="$emit('reset')" />
    <OptionDeleteAccount @click="$emit('delete')" />
  </div>
</template>

<script>
import OptionResetCache from './OptionResetCache'
import OptionDeleteAccount from './OptionDeleteAccount'

export default {
  name: 'OptionsFake',
  components: { OptionDeleteAccount, OptionResetCache },
  props: { },
  data() {
    return {
      panels: [0]
    }
  },
}
</script>

<style scoped>
</style>
