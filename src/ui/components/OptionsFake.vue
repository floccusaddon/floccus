<template>
  <div>
    <OptionResetCache @click="$emit('reset')" />
    <OptionDeleteAccount @click="$emit('delete')" />
  </div>
</template>

<script>
import { url } from 'vuelidate/lib/validators'
import OptionResetCache from './OptionResetCache'
import OptionDeleteAccount from './OptionDeleteAccount'

export default {
  name: 'OptionsFake',
  components: { OptionDeleteAccount, OptionResetCache },
  props: {
    value: {
      type: Object,
      required: true
    }
  },
  data() {
    return {
      data: this.value,
      panels: [0]
    }
  },
  methods: {
    validateUrl: url,
    validateBookmarksFile(path) {
      return path[0] !== '/' && path[path.length - 1] !== '/'
    },
  }
}
</script>

<style scoped>
</style>
