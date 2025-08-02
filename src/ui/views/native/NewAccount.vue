<template>
  <div class="native-scroll-container">
    <v-main>
      <NewAccountContent />
    </v-main>
  </div>
</template>

<script>
import NewAccountContent from '../NewAccount'

export default {
  name: 'NewAccount',
  components: { NewAccountContent },
  data() {
    return {
      drawer: false,
    }
  },
}
</script>

<style scoped></style>
