<template>
  <v-container>
    <v-card
      class="options mt-3">
      <v-stepper v-model="currentStep">
        <v-stepper-header>
          <v-stepper-step
            :complete="currentStep > 0"
            step="0" />
          <v-divider />
          <v-stepper-step
            :complete="currentStep > 1"
            step="1" />
          <v-divider />
          <v-stepper-step
            :complete="currentStep > 2"
            step="2" />
          <v-divider />
          <v-stepper-step
            step="3"
            :complete="currentStep > 3" />
          <v-divider />
          <v-stepper-step
            step="4"
            :complete="currentStep > 4" />
        </v-stepper-header>

        <v-stepper-items>
          <v-stepper-content step="0">
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
                @click="currentStep++">
                {{ t('LabelContinue') }}
              </v-btn>
              <v-btn
                :to="{ name: 'IMPORTEXPORT' }"
                class="mr-2">
                <v-icon>mdi-export</v-icon>
                <template v-if="isBrowser && true">
                  {{ t('LabelImportExport') }}
                </template>
              </v-btn>
            </div>
          </v-stepper-content>

          <v-stepper-content step="1">
            <div class="headline">
              {{ t('LabelAccountlabel') }}
            </div>
            <v-form>
              <v-text-field
                v-model="label"
                append-icon="mdi-label"
                class="mt-2 mb-4"
                :label="t('LabelAccountlabel')"
                :hint="t('DescriptionAccountlabel')"
                :persistent-hint="true"
                @keydown.enter.prevent="currentStep++" />
            </v-form>
            <div class="d-flex flex-row justify-space-between">
              <v-btn @click="currentStep--">
                {{ t('LabelBack') }}
              </v-btn>
              <v-btn
                class="primary"
                @click="currentStep++">
                {{ t('LabelContinue') }}
              </v-btn>
            </div>
          </v-stepper-content>

          <v-stepper-content step="2">
            <template v-if="adapter === 'nextcloud-bookmarks'">
              <div class="headline">
                {{ t('LabelServersetup') }}
              </div>
              <v-text-field
                v-model="server"
                :rules="[validateUrl]"
                :label="t('LabelNextcloudurl')"
                :loading="isServerTestRunning || isLoginFlowRunning"
                :error-messages="serverisNotHttps || serverTestError || loginFlowError"
                @keydown.enter="testNextcloudServer">
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
              <div class="d-flex flex-row justify-space-between">
                <v-btn @click="currentStep--">
                  {{ t('LabelBack') }}
                </v-btn>
                <v-btn
                  v-if="!serverTestSuccessful"
                  class="primary"
                  @click="testNextcloudServer">
                  {{ t('LabelConnect') }}
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

            <template v-else-if="adapter === 'linkwarden'">
              <div class="headline">
                {{ t('LabelServersetup') }}
              </div>
              <v-text-field
                v-model="server"
                :rules="[validateUrl]"
                :label="t('LabelLinkwardenurl')"
                :loading="isServerTestRunning"
                :error-messages="serverTestError || serverisNotHttps" />
              <v-text-field
                v-model="username"
                :label="t('LabelUsername')" />
              <v-text-field
                v-model="password"
                :label="t('LabelAccesstoken')"
                :append-icon="showPassword ? 'mdi-eye' : 'mdi-eye-off'"
                :type="showPassword ? 'text' : 'password'"
                @click:append="showPassword = !showPassword" />

              <div class="d-flex flex-row justify-space-between">
                <v-btn @click="currentStep--">
                  {{ t('LabelBack') }}
                </v-btn>
                <v-btn
                  class="primary"
                  @click="testLinkwardenServer">
                  {{ t('LabelContinue') }}
                </v-btn>
              </div>
            </template>

            <template v-else-if="adapter === 'webdav'">
              <div class="headline">
                {{ t('LabelServersetup') }}
              </div>
              <v-text-field
                v-model="server"
                :rules="[validateUrl]"
                :label="t('LabelWebdavurl')"
                :loading="isServerTestRunning"
                :error-messages="serverTestError || serverisNotHttps" />
              <v-text-field
                v-model="username"
                :label="t('LabelUsername')" />
              <v-text-field
                v-model="password"
                :label="t('LabelPassword')"
                :append-icon="showPassword ? 'mdi-eye' : 'mdi-eye-off'"
                :type="showPassword ? 'text' : 'password'"
                @click:append="showPassword = !showPassword" />
              <v-text-field
                v-model="passphrase"
                class="mt-2"
                :label="t('LabelPassphrase')"
                :hint="t('DescriptionPassphrase')"
                :persistent-hint="true"
                :append-icon="showPassphrase ? 'mdi-eye' : 'mdi-eye-off'"
                :type="showPassphrase ? 'text' : 'password'"
                @click:append="showPassphrase = !showPassphrase" />
              <div class="d-flex flex-row justify-space-between">
                <v-btn @click="currentStep--">
                  {{ t('LabelBack') }}
                </v-btn>
                <v-btn
                  class="primary"
                  @click="testWebdavServer">
                  {{ t('LabelContinue') }}
                </v-btn>
              </div>
            </template>

            <template v-else-if="adapter === 'git'">
              <div class="headline">
                {{ t('LabelServersetup') }}
              </div>
              <v-text-field
                v-model="server"
                :rules="[validateUrl]"
                :label="t('LabelGiturl')" />
              <v-text-field
                v-model="username"
                :label="t('LabelUsername')" />
              <v-text-field
                v-model="password"
                :label="t('LabelPassword')"
                :append-icon="showPassword ? 'mdi-eye' : 'mdi-eye-off'"
                :type="showPassword ? 'text' : 'password'"
                @click:append="showPassword = !showPassword" />
              <div class="d-flex flex-row justify-space-between">
                <v-btn @click="currentStep--">
                  {{ t('LabelBack') }}
                </v-btn>
                <v-btn
                  class="primary"
                  @click="currentStep++">
                  {{ t('LabelContinue') }}
                </v-btn>
              </div>
            </template>

            <template v-else-if="adapter === 'google-drive'">
              <div class="headline">
                {{ t('LabelGoogledrivesetup') }}
              </div>
              <v-btn
                color="primary"
                @click="loginGoogleDrive">
                {{ t('LabelLogingoogle') }}
              </v-btn>
              <p class="mt-1">
                {{ t('DescriptionLogingoogle') }}
              </p>
              <v-btn @click="currentStep--">
                {{ t('LabelBack') }}
              </v-btn>
            </template>
          </v-stepper-content>

          <v-stepper-content step="3">
            <div class="headline">
              {{ t('LabelSyncfoldersetup') }}
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

            <template v-if="adapter === 'linkwarden'">
              <div class="text-h6">
                {{ t('LabelServerfolder') }}
              </div>
              <div class="caption">
                {{ t('DescriptionServerfolderlinkwarden') }}
              </div>
              <v-text-field
                v-model="serverFolder"
                :label="t('LabelServerfolder')" />
            </template>

            <template v-if="adapter === 'webdav'">
              <div class="text-h6">
                {{ t('LabelBookmarksfile') }}
              </div>
              <v-text-field
                v-model="bookmark_file"
                class="mb-2"
                append-icon="mdi-file-document"
                :rules="[validateBookmarksFile]"
                :label="t('LabelBookmarksfile')"
                :hint="t('DescriptionBookmarksfile')"
                :persistent-hint="true" />
              <OptionFileType
                v-model="bookmark_file_type" />
            </template>

            <template v-if="adapter === 'git'">
              <div class="text-h6">
                {{ t('LabelBookmarksfile') }}
              </div>
              <v-text-field
                v-model="bookmark_file"
                class="mb-2"
                append-icon="mdi-file-document"
                :rules="[validateBookmarksFile]"
                :label="t('LabelBookmarksfile')"
                :hint="t('DescriptionBookmarksfilegit')"
                :persistent-hint="true" />
              <OptionFileType
                v-model="bookmark_file_type" />
              <v-text-field
                v-model="branch"
                class="mb-2"
                :label="t('LabelGitbranch')" />
            </template>

            <template v-if="adapter === 'google-drive'">
              <div class="text-h6">
                {{ t('LabelBookmarksfile') }}
              </div>
              <v-text-field
                v-model="bookmark_file"
                append-icon="mdi-file-document"
                :rules="[validateBookmarksFileGoogle]"
                :label="t('LabelBookmarksfile')"
                :hint="t('DescriptionBookmarksfilegoogle')"
                :persistent-hint="true" />
              <v-text-field
                v-model="passphrase"
                :append-icon="showPassphrase ? 'mdi-eye' : 'mdi-eye-off'"
                :type="showPassphrase ? 'text' : 'password'"
                class="mt-2"
                :label="t('LabelPassphrase')"
                :hint="t('DescriptionPassphrase')"
                :persistent-hint="true"
                @click:append="showPassphrase = !showPassphrase" />
            </template>

            <OptionSyncFolder
              v-if="isBrowser"
              v-model="localRoot" />

            <div class="d-flex flex-row justify-space-between">
              <v-btn @click="currentStep--">
                {{ t('LabelBack') }}
              </v-btn>
              <v-btn
                :disabled="isBrowser? !localRoot : false"
                color="primary"
                @click="currentStep++">
                {{ t('LabelContinue') }}
              </v-btn>
            </div>
          </v-stepper-content>

          <v-stepper-content step="4">
            <div class="headline">
              {{ t('LabelSyncbehaviorsetup') }}
            </div>
            <v-switch
              v-model="enabled"
              :aria-label="t('LabelAutosync')"
              :label="t('LabelAutosync')"
              dense
              class="mt-0 pt-0" />
            <OptionSyncInterval
              v-if="enabled"
              v-model="syncInterval" />
            <OptionSyncStrategy
              v-model="strategy" />
            <OptionNestedSync
              v-if="isBrowser"
              v-model="nestedSync" />
            <v-switch
              v-if="adapter === 'nextcloud-bookmarks'"
              v-model="clickCountEnabled"
              :aria-label="t('LabelClickcount')"
              :label="t('LabelClickcount')"
              :hint="t('DescriptionClickcount')"
              :persistent-hint="true"
              dense
              class="mt-0 pt-0 mb-4" />

            <div class="d-flex flex-row justify-space-between">
              <v-btn @click="currentStep--">
                {{ t('LabelBack') }}
              </v-btn>
              <v-btn
                color="primary"
                @click="onCreate()">
                {{ t('LabelContinue') }}
              </v-btn>
            </div>
          </v-stepper-content>
          <v-stepper-content step="5">
            <div class="headline">
              {{ t('LabelAccountcreated') }} <v-icon>mdi-check</v-icon>
            </div>
            <div v-if="isBrowser">
              {{ t('DescriptionAccountcreated') }}
            </div>
          </v-stepper-content>
        </v-stepper-items>
      </v-stepper>
    </v-card>
  </v-container>
</template>

<script>
import { actions } from '../store/definitions'
import OptionSyncFolder from '../components/OptionSyncFolder'
import OptionSyncInterval from '../components/OptionSyncInterval'
import OptionSyncStrategy from '../components/OptionSyncStrategy'
import OptionNestedSync from '../components/OptionNestedSync'
import OptionFileType from '../components/OptionFileType'

export default {
  name: 'NewAccount',
  components: { OptionFileType, OptionNestedSync, OptionSyncStrategy, OptionSyncInterval, OptionSyncFolder },
  data() {
    return {
      currentStep: 0,
      isServerTestRunning: false,
      serverTestError: '',
      serverTestSuccessful: false,
      loginFlowError: '',
      server: 'https://',
      branch: 'main',
      username: '',
      password: '',
      passphrase: '',
      refreshToken: '',
      bookmark_file: 'bookmarks.xbel',
      bookmark_file_type: 'xbel',
      serverFolder: 'Floccus',
      serverRoot: '',
      localRoot: null,
      syncInterval: 15,
      strategy: 'default',
      enabled: true,
      nestedSync: true,
      showPassword: false,
      showPassphrase: false,
      clickCountEnabled: false,
      label: '',
      adapter: 'nextcloud-bookmarks',
      adapters: [
        {
          type: 'nextcloud-bookmarks',
          label: this.t('LabelAdapternextcloudfolders'),
          description: this.t('DescriptionAdapternextcloudfolders')
        },
        {
          type: 'linkwarden',
          label: this.t('LabelAdapterlinkwarden'),
          description: this.t('DescriptionAdapterlinkwarden')
        },
        {
          type: 'webdav',
          label: this.t('LabelAdapterwebdav'),
          description: this.t('DescriptionAdapterwebdav')
        },
        {
          type: 'git',
          label: this.t('LabelAdaptergit'),
          description: this.t('DescriptionAdaptergit')
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
    },
    serverisNotHttps() {
      return !this.server.startsWith('https') ? this.t('DescriptionNonhttps') : ''
    }
  },
  watch: {
    clickCountEnabled() {
      if (this.clickCountEnabled) {
        this.requestHistoryPermissions()
      }
    }
  },
  backButton() {
    this.$router.push({ name: 'HOME' })
  },
  methods: {
    async onCreate() {
      const accountId = await this.$store.dispatch('CREATE_ACCOUNT', {
        type: this.adapter,
        url: this.server,
        username: this.username,
        password: this.password,
        enabled: this.enabled,
        label: this.label,
        ...(this.adapter === 'nextcloud-bookmarks' && {serverRoot: this.serverRoot, clickCountEnabled: this.clickCountEnabled}),
        ...(this.adapter === 'linkwarden' && {serverFolder: this.serverFolder}),
        ...(this.adapter === 'git' && {branch: this.branch}),
        ...((this.adapter === 'webdav' || this.adapter === 'google-drive' || this.adapter === 'git') && {bookmark_file: this.bookmark_file}),
        ...((this.adapter === 'webdav' || this.adapter === 'google-drive' || this.adapter === 'git') && {bookmark_file_type: this.bookmark_file_type}),
        ...(this.adapter === 'google-drive' && {refreshToken: this.refreshToken}),
        ...(this.passphrase && {passphrase: this.passphrase}),
        ...(this.adapter === 'google-drive' && this.passphrase && {password: this.passphrase}),
        ...(this.isBrowser && {localRoot: this.localRoot}),
        syncInterval: this.syncInterval,
        strategy: this.strategy,
        ...(this.isBrowser && {nestedSync: this.nestedSync}),
      })
      this.currentStep++
      if (!this.isBrowser) {
        setTimeout(() => {
          this.$router.push({ name: 'TREE', params: { accountId } })
          this.$store.dispatch(actions.TRIGGER_SYNC, accountId)
        }, 2000)
      }
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
    async testLinkwardenServer() {
      this.isServerTestRunning = true
      this.serverTestError = ''
      try {
        await this.$store.dispatch(actions.TEST_LINKWARDEN_SERVER, {rootUrl: this.server, username: this.username, token: this.password})
        this.serverTestSuccessful = true
        this.currentStep++
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
      if (this.isBrowser) {
        await this.$store.dispatch(actions.REQUEST_NETWORK_PERMISSIONS)
      }
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
    requestHistoryPermissions() {
      this.$store.dispatch(actions.REQUEST_HISTORY_PERMISSIONS)
    }
  }
}
</script>

<style scoped>
    .options {
        max-width: 600px;
        margin: 0 auto;
    }
</style>
