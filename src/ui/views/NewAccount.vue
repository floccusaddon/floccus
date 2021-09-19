<template>
  <v-container>
    <v-card
      class="options mt-3">
      <v-container class="pa-5">
        <div class="headline">
          {{ t('LabelChooseadapter') }}
        </div>
        <v-form>
          <v-radio-group v-model="adapter">
            <div
              v-for="a in adapters"
              :key="a.type">
              <v-radio
                :value="a.type"
                :disabled="!isBrowser && a.type !== 'nextcloud-bookmarks'">
                <template v-slot:label>
                  <div class="heading">
                    {{ a.label }}
                  </div>
                </template>
              </v-radio>
              <div class="caption pl-8 mb-5">
                {{ a.description }}
              </div>
            </div>
          </v-radio-group>
        </v-form>
        <div class="d-flex flex-row-reverse">
          <v-btn
            class="primary"
            @click="onCreate">
            {{ t('LabelAddaccount') }}
          </v-btn>
        </div>
      </v-container>
    </v-card>
  </v-container>
</template>

<script>
export default {
  name: 'NewAccount',
  components: {},
  data() {
    return {
      adapter: 'nextcloud-bookmarks',
      adapters: [
        {
          type: 'nextcloud-bookmarks',
          label: this.t('LabelAdapternextcloudfolders'),
          description: this.t('DescriptionAdapternextcloudfolders')
        },
        {
          type: 'webdav',
          label: this.t('LabelAdapterwebdav'),
          description: this.t('DescriptionAdapterwebdav')
        },
        {
          type: 'google-drive',
          label: this.t('LabelAdaptergoogledrive'),
          description: this.t('DescriptionAdaptergoogledrive')
        }
      ]
    }
  },
  methods: {
    async onCreate() {
      const accountId = await this.$store.dispatch('CREATE_ACCOUNT', this.adapter)
      await this.$router.push({name: 'ACCOUNT_OPTIONS', params: {accountId}})
    },
  }
}
</script>

<style scoped>
    .options {
        max-width: 600px;
        margin: 0 auto;
    }
</style>
