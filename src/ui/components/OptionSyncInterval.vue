<template>
  <div>
    <div class="text-h6">
      {{ t('LabelSyncinterval') }}
    </div>
    <v-slider
      v-model="syncIntervalStep"
      class="mt-8 mb-5"
      :aria-label="t('LabelSyncinterval')"
      :hint="t('DescriptionSyncinterval')"
      :min="0"
      :max="syncIntervalSteps.length-1"
      :step="1"
      :persistent-hint="true"
      :thumb-label="'always'"
      :ticks="'always'">
      <template #thumb-label="{ value: step }">
        {{ humanizeDuration(syncIntervalSteps[step] * 1000 * 60) }}
      </template>
    </v-slider>
  </div>
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
      5, 10, 15, 20, 25, 30, 45, 60, 60 * 2, 60 * 3, 60 * 4, 60 * 6, 60 * 8, 60 * 12, 60 * 16, 60 * 24
    ]
    return {
      syncIntervalSteps: steps,
      syncIntervalStep: steps.reduce((closestIndex, value, index) => {
        const currentDelta = Math.abs(steps[closestIndex] - this.value)
        const newDelta = Math.abs(value - this.value)
        if (currentDelta > newDelta) return index
        else return closestIndex
      }, 0)
    }
  },
  watch: {
    value() {
      this.syncIntervalStep = this.syncIntervalSteps.reduce((closestIndex, value, index) => {
        const currentDelta = Math.abs(this.syncIntervalSteps[closestIndex] - this.value)
        const newDelta = Math.abs(value - this.value)
        if (currentDelta > newDelta) return index
        else return closestIndex
      }, 0)
    },
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
