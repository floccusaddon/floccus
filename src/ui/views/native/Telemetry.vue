<template>
  <div class="native-scroll-container">
    <v-main>
      <v-container>
        <v-card
          class="options mt-3">
          <v-container class="pa-5">
            <v-card-title>
              {{ t("LabelTelemetry") }}
            </v-card-title>
            <v-card-text>
              <div class="body-1">
                {{ t("DescriptionTelemetry") }}
              </div>
              <v-radio-group
                v-model="telemetry"
                class="mt-4">
                <v-radio :value="true">
                  <template #label>
                    <div class="heading">
                      {{ t("LabelTelemetryenable") }}
                    </div>
                  </template>
                </v-radio>
                <v-radio :value="false">
                  <template #label>
                    <div class="heading">
                      {{ t("LabelTelemetrydisable") }}
                    </div>
                  </template>
                </v-radio>
              </v-radio-group>
            </v-card-text>
            <v-card-title>
              {{ t("LabelReportproblem") }}
            </v-card-title>
            <v-card-text>
              <div class="body-1">
                {{ t("DescriptionReportproblem") }}
              </div>
              <v-btn href="https://github.com/floccusaddon/floccus/issues">
                {{ t("LabelReportproblem") }}
              </v-btn>
            </v-card-text>
          </v-container>
        </v-card>
      </v-container>
    </v-main>
  </div>
</template>

<script>
import NativeAccountStorage from '../../../lib/native/NativeAccountStorage'

export default {
  name: 'Telemetry',
  components: {},
  data() {
    return {
      telemetry: false,
    }
  },
  watch: {
    telemetry(enabled) {
      NativeAccountStorage.changeEntry('telemetryEnabled', () => enabled, false)
    },
  },
  async created() {
    const telemetryEnabled = await NativeAccountStorage.getEntry('telemetryEnabled', false)
    this.telemetry = telemetryEnabled
  },
}
</script>

<style scoped>
    .options {
        max-width: 600px;
        margin: 0 auto;
    }
</style>
