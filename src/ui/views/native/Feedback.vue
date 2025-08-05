<template>
  <div class="native-scroll-container">
    <Drawer :visible.sync="drawer" />
    <v-app-bar
      fixed
      app>
      <v-app-bar-nav-icon
        class="mr-2 ml-n2"
        @click="drawer = !drawer" />
      <v-app-bar-title>{{ t('LabelGivefeedback') }}</v-app-bar-title>
    </v-app-bar>
    <v-main>
      <v-container>
        <FeedbackContent />
      </v-container>
    </v-main>
  </div>
</template>

<script>
import Drawer from '../../components/native/Drawer'
import FeedbackContent from '../Feedback'

export default {
  name: 'Feedback',
  components: { Drawer, FeedbackContent},
  data() {
    return {
      drawer: false,
    }
  },
}
</script>

<style scoped>

</style>
