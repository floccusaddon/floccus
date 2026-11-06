<template>
  <div>
    <div
      class="text-h6"
      role="heading"
      aria-level="3">
      {{ t('LabelNotifyonly') }}
    </div>
    <div class="caption">
      {{ t('DescriptionNotifyonly') }}
    </div>
    <v-switch
      :input-value="notifyOnly"
      :aria-label="t('LabelNotifyonly')"
      :label="t('LabelNotifyonly')"
      dense
      class="mt-0 pt-0"
      @change="$emit('update:notifyOnly', $event)" />
    <template v-if="notifyOnly">
      <div class="caption">
        {{ t('DescriptionNotifyonlynotifications') }}
      </div>
      <v-switch
        :input-value="notificationsEnabled"
        :aria-label="t('LabelNotifyonlynotifications')"
        :label="t('LabelNotifyonlynotifications')"
        dense
        class="mt-0 pt-0"
        @change="onToggleNotifications" />
    </template>
  </div>
</template>

<script>
import { actions } from '../store/definitions'

export default {
  name: 'OptionNotifyOnly',
  props: {
    notifyOnly: {
      type: Boolean,
      default: false,
    },
    notificationsEnabled: {
      type: Boolean,
      default: false,
    },
  },
  methods: {
    async onToggleNotifications(enabled) {
      if (!enabled) {
        this.$emit('update:notificationsEnabled', false)
        return
      }
      // Has to be requested right from the user's click
      const granted = await this.$store.dispatch(actions.REQUEST_NOTIFICATION_PERMISSIONS)
      this.$emit('update:notificationsEnabled', granted)
    },
  },
}
</script>

<style scoped></style>
