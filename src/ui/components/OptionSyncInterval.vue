<template>
  <v-container>
    <v-slider
      v-model="syncIntervalStep"
      class="mt-5"
      :label="t('LabelSyncinterval')"
      :hint="t('DescriptionSyncinterval')"
      :min="0"
      :max="syncIntervalSteps.length-1"
      :step="1"
      :persistent-hint="true"
      :rules="[Boolean]"
      :thumb-label="'always'"
      :ticks="'always'">
      <template v-slot:thumb-label="{ value: step }">
        {{ humanizeDuration(syncIntervalSteps[step] * 1000 * 60) }}
      </template>
    </v-slider>
  </v-container>
</template>

<script>
import humanizeDuration from 'humanize-duration'

export default {
  name: 'OptionSyncInterval',
  props: {
    value: {
      type: Number,
      default: 0,
    }
  },
  data() {
    const steps = [
      0, 5, 10, 15, 20, 25, 30, 45, 60, 60 * 2, 60 * 3, 60 * 4, 60 * 6, 60 * 8, 60 * 12, 60 * 16, 60 * 24
    ]
    return {
      syncIntervalSteps: steps,
      syncIntervalStep: steps.reduce((closestIndex, value, index) => {
        const currentDelta = Math.abs(steps[closestIndex] - this.value)
        const newDelta = Math.abs(value - this.value)
        if (currentDelta > newDelta) return index
        else return closestIndex
      }, 0) || steps.indexOf(15)
    }
  },
  watch: {

    syncIntervalStep(step) {
      this.$emit('input', this.syncIntervalSteps[step])
    },
  },
  methods: {
    humanizeDuration(duration) {
      return humanizeDuration(duration, {
        language: 'shortEn',
        largest: 2,
        round: true,
        languages: {
          shortEn: {
            y: () => 'y',
            mo: () => 'mo',
            w: () => 'w',
            d: () => 'd',
            h: () => 'h',
            m: () => 'm',
            s: () => 's',
            ms: () => 'ms'
          }
        }})
    }
  }
}
</script>

<style scoped>

</style>
