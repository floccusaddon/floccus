<template>
  <img
    v-if="src"
    :src="src">
  <v-icon
    v-else
    large>
    mdi-star
  </v-icon>
</template>

<script>
import { getIcons } from '../../../lib/getFavicon'

export default {
  name: 'FaviconImage',
  props: {
    url: {
      type: String,
      required: true,
    }
  },
  data() {
    return {
      src: null,
    }
  },
  async created() {
    try {
      const res = await fetch(this.url)
      const icons = getIcons(await res.text(), res.url)
      this.src = icons[0]
    } catch (e) {
      console.log(e)
    }
  }
}
</script>

<style scoped>

</style>
