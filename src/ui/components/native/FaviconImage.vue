<template>
  <img
    v-if="src"
    ref="img"
    :src="src"
    @error="onError">
  <v-icon
    v-else
    large>
    mdi-star
  </v-icon>
</template>

<script>
import { getIcons } from '../../../lib/getFavicon'
import { CapacitorHttp as Http } from '@capacitor/core'
import {Preferences as Storage} from '@capacitor/preferences'

export default {
  name: 'FaviconImage',
  props: {
    url: {
      type: String,
      required: true,
    },
    useNetwork: {
      type: Boolean,
      required: true,
    }
  },
  data() {
    return {
      src: null,
    }
  },
  watch: {
    loadError() {
      if (this.loadError) {
        this.src = null
      }
    }
  },
  async mounted() {
    if (!this.useNetwork) {
      return
    }
    await new Promise(resolve => setTimeout(resolve, Math.random() * 400))
    const key = `favicons[${this.url}]`
    const {value: cachedFavicon} = await Storage.get({key})
    if (cachedFavicon) {
      this.src = cachedFavicon
      return
    }
    try {
      const res = await Http.get({url: this.url})
      const icons = getIcons(res.data, res.url)
      this.src = icons[0]
      await Storage.set({key, value: this.src})
    } catch (e) {
      console.log(e)
    }
  },
  methods: {
    onError() {
      this.src = null
    }
  }
}
</script>

<style scoped>

</style>
