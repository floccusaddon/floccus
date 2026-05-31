<template>
  <div class="native-scroll-container native-test-runner">
    <div id="mocha" />
  </div>
</template>

<script>
import { runNativeTests } from '../../native-tests/run'

export default {
  name: 'TestRunner',
  async mounted() {
    try {
      await runNativeTests(this.$route.query)
    } catch (error) {
      console.log(error ? (error.stack || error.message || error) : error)
      throw error
    }
  },
}
</script>

<style scoped>
.native-test-runner {
  overflow-y: auto;
}

#mocha {
  min-height: 100%;
  padding: 16px;
}
</style>
