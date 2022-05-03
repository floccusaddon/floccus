<template>
  <v-container>
    <v-card
      class="options mt-3">
      <v-stepper v-model="currentStep">
        <v-stepper-header>
          <v-stepper-step
            :complete="currentStep > 1"
            step="1">
            Sync method
          </v-stepper-step>
          <v-divider />
          <v-stepper-step
            :complete="currentStep > 2"
            step="2">
            Sync server
          </v-stepper-step>
          <v-divider />
          <v-stepper-step
            step="3"
            :complete="currentStep > 3">
            Sync folders
          </v-stepper-step>
          <v-divider />
          <v-stepper-step
            step="4"
            :complete="currentStep > 4">
            Sync behavior
          </v-stepper-step>
          <v-divider />
          <v-stepper-step
            step="5"
            :complete="currentStep > 4">
            Done
          </v-stepper-step>
        </v-stepper-header>

        <v-stepper-items>
          <v-stepper-content step="1">
            <div class="headline">
              {{ t('LabelChooseadapter') }}
            </div>
            <v-form>
              <v-radio-group v-model="adapter">
                <div
                  v-for="a in adapters"
                  :key="a.type">
                  <v-radio
                    :value="a.type">
                    <template #label>
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
                @click="currentStep = 2">
                {{ t('LabelAddaccount') }}
              </v-btn>
              <v-btn
                v-if="isBrowser"
                :to="{ name: 'IMPORTEXPORT' }"
                class="mr-2">
                <v-icon>mdi-export</v-icon>
                {{ t('LabelImportExport') }}
              </v-btn>
            </div>
          </v-stepper-content>

          <v-stepper-content step="2">
            <template v-if="adapter === 'nextcloud-bookmarks'">
              <div class="headline">
                Which server do you want to sync to?
              </div>
              <v-text-field
                v-model="server"
                :rules="[validateUrl]"
                :label="t('LabelNextcloudurl')"
                :loading="isServerTestRunning || isLoginFlowRunning"
                :error-messages="serverTestError || loginFlowError">
                <template
                  slot="append-outer">
                  <v-icon
                    v-if="serverTestSuccessful"
                    color="green"
                    title="Server connection successful">
                    mdi-check
                  </v-icon>
                </template>
              </v-text-field>
              <div class="d-flex flex-row-reverse">
                <v-btn
                  v-if="!serverTestSuccessful"
                  class="primary"
                  @click="testNextcloudServer">
                  Connect
                </v-btn>
                <template v-if="serverTestSuccessful">
                  <v-btn
                    v-if="!isLoginFlowRunning"
                    class="primary"
                    @click="onFlowStart">
                    {{ t('LabelLoginFlowStart') }}
                  </v-btn>
                  <v-btn
                    v-if="isLoginFlowRunning"
                    @click="onFlowStop">
                    {{ t('LabelLoginFlowStop') }}
                  </v-btn>
                </template>
              </div>
            </template>
            <template v-else-if="adapter === 'webdav'">
              <div class="headline">
                Which server do you want to sync to?
              </div>
              <v-text-field
                v-model="server"
                :rules="[validateUrl]"
                :label="t('LabelWebdavurl')"
                :loading="isServerTestRunning"
                :error-messages="serverTestError" />
              <v-text-field
                v-model="username"
                :label="t('LabelUsername')" />
              <v-text-field
                v-model="password"
                :label="t('LabelPassword')"
                :append-icon="showPassword ? 'mdi-eye' : 'mdi-eye-off'"
                :type="showPassword ? 'text' : 'password'"
                @click:append="showPassword = !showPassword" />
              <div class="d-flex flex-row-reverse">
                <v-btn
                  class="primary"
                  @click="testWebdavServer">
                  Continue
                </v-btn>
              </div>
            </template>
            <template v-else-if="adapter === 'google-drive'">
              <div class="headline">
                Login to Google Drive
              </div>
              <v-btn
                color="primary"
                @click="loginGoogleDrive">
                {{ t('LabelLogingoogle') }}
              </v-btn>
              <p class="mt-1">
                {{ t('DescriptionLogingoogle') }}
              </p>
            </template>
          </v-stepper-content>

          <v-stepper-content step="3">
            <div class="headline">
              Which Folders do you want to sync?
            </div>

            <template v-if="adapter === 'nextcloud-bookmarks'">
              <div class="text-h6">
                {{ t('LabelServerfolder') }}
              </div>
              <div class="caption">
                {{ t('DescriptionServerfolder') }}
              </div>
              <v-text-field
                v-model="serverRoot"
                :placeholder="'/'"
                :rules="[validateServerRoot]"
                :label="t('LabelServerfolder')" />
            </template>
            <div class="text-h6">
              {{ t('LabelBookmarksfile') }}
            </div>
            <v-text-field
              v-if="adapter === 'webdav'"
              v-model="bookmark_file"
              append-icon="mdi-file-document"
              :rules="[validateBookmarksFile]"
              :label="t('LabelBookmarksfile')"
              :hint="t('DescriptionBookmarksfile')"
              :persistent-hint="true" />
            <v-text-field
              v-if="adapter === 'google-drive'"
              v-model="bookmark_file"
              append-icon="mdi-file-document"
              :rules="[validateBookmarksFileGoogle]"
              :label="t('LabelBookmarksfile')"
              :hint="t('DescriptionBookmarksfilegoogle')"
              :persistent-hint="true" />
            <OptionSyncFolder
              v-if="isBrowser"
              v-model="localRoot" />

            <div class="d-flex flex-row-reverse">
              <v-btn
                :disabled="isBrowser? !localRoot : false"
                color="primary"
                @click="currentStep++">
                Continue
              </v-btn>
            </div>
          </v-stepper-content>
          <v-stepper-content step="4">
            <div class="headline">
              How do you want to sync?
            </div>

            <OptionSyncInterval
              v-if="isBrowser"
              v-model="syncInterval" />
            <OptionSyncStrategy
              v-model="strategy" />
            <OptionNestedSync
              v-if="isBrowser"
              v-model="nestedSync" />

            <div class="d-flex flex-row-reverse">
              <v-btn
                color="primary"
                @click="onCreate()">
                Continue
              </v-btn>
            </div>
          </v-stepper-content>
          <v-stepper-content step="5">
            <div class="headline">
              Account created <v-icon>mdi-check</v-icon>
            </div>
          </v-stepper-content>
        </v-stepper-items>
      </v-stepper>
    </v-card>
  </v-container>
</template>

<script>
import { actions } from '../store'
import OptionSyncFolder from '../components/OptionSyncFolder'
import OptionSyncInterval from '../components/OptionSyncInterval'
import OptionSyncStrategy from '../components/OptionSyncStrategy'
import OptionNestedSync from '../components/OptionNestedSync'

export default {
  name: 'NewAccount',
  components: { OptionNestedSync, OptionSyncStrategy, OptionSyncInterval, OptionSyncFolder },
  data() {
    return {
      currentStep: 1,
      isServerTestRunning: false,
      serverTestError: '',
      serverTestSuccessful: false,
      loginFlowError: '',
      server: 'https://',
      username: '',
      password: '',
      refreshToken: '',
      bookmark_file: 'bookmarks.xbel',
      serverRoot: '',
      localRoot: null,
      syncInterval: 15,
      strategy: 'default',
      nestedSync: true,
      showPassword: false,
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
      ],
    }
  },
  computed: {
    isLoginFlowRunning() {
      return this.$store.state.loginFlow.isRunning
    }
  },
  methods: {
    async onCreate() {
      await this.$store.dispatch('CREATE_ACCOUNT', {
        type: this.adapter,
        url: this.server,
        username: this.username,
        password: this.password,
        ...(this.adapter === 'nextcloud-bookmarks' && {serverRoot: this.serverRoot}),
        ...((this.adapter === 'webdav' || this.adapter === 'google-drive') && {bookmark_file: this.bookmark_file}),
        ...(this.adapter === 'google-drive' && {refreshToken: this.refreshToken}),
        ...(this.isBrowser && {localRoot: this.localRoot}),
        syncInterval: this.syncInterval,
        strategy: this.strategy,
        ...(this.isBrowser && {nestedSync: this.nestedSync}),
      })
      this.currentStep++
    },
    async testNextcloudServer() {
      this.isServerTestRunning = true
      this.serverTestError = ''
      try {
        await this.$store.dispatch(actions.TEST_NEXTCLOUD_SERVER, this.server)
        this.serverTestSuccessful = true
      } catch (e) {
        this.serverTestError = e.message
      }
      this.isServerTestRunning = false
    },
    async testWebdavServer() {
      this.isServerTestRunning = true
      this.serverTestError = ''
      try {
        await this.$store.dispatch(actions.TEST_WEBDAV_SERVER, {rootUrl: this.server, username: this.username, password: this.password})
        this.serverTestSuccessful = true
        this.currentStep++
      } catch (e) {
        this.serverTestError = e.message
      }
      this.isServerTestRunning = false
    },
    async loginGoogleDrive() {
      const GoogleDriveAdapter = (await import('../../lib/adapters/GoogleDrive')).default
      const { refresh_token, username } = await GoogleDriveAdapter.authorize()
      if (refresh_token) {
        this.authorized = true
        this.refreshToken = refresh_token
        this.username = username
        this.currentStep++
      }
    },
    async onFlowStart() {
      this.loginFlowError = null
      try {
        const credentials = await this.$store.dispatch(actions.START_LOGIN_FLOW, this.server)
        this.username = credentials.username
        this.password = credentials.password
        this.currentStep++
      } catch (e) {
        this.loginFlowError = e.message
      }
    },
    async onFlowStop() {
      await this.$store.dispatch('STOP_LOGIN_FLOW')
    },
    validateServerRoot(path) {
      return !path || path === '/' || (path[0] === '/' && path[path.length - 1] !== '/')
    },
    validateUrl(str) {
      try {
        const u = new URL(str)
        return Boolean(u) && u.protocol.startsWith('http')
      } catch (e) {
        return false
      }
    },
    validateBookmarksFile(path) {
      return path[0] !== '/' && path[path.length - 1] !== '/'
    },
    validateBookmarksFileGoogle(path) {
      return !path.includes('/')
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
