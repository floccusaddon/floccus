import browser from '../browser-api'
import Controller from '../Controller'
import BrowserAccount from './BrowserAccount'
import BrowserTree from './BrowserTree'
import Cryptography from '../Crypto'
import packageJson from '../../../package.json'
import BrowserAccountStorage from './BrowserAccountStorage'
import uniqBy from 'lodash/uniqBy'
import Account from '../Account'
import { STATUS_ALLGOOD, STATUS_DISABLED, STATUS_ERROR, STATUS_SYNCING } from '../interfaces/Controller'
import * as Sentry from '@sentry/browser'

const INACTIVITY_TIMEOUT = 7 * 1000 // 7 seconds
const DEFAULT_SYNC_INTERVAL = 15 // 15 minutes
const STALE_SYNC_TIME = 1000 * 60 * 60 * 24 * 2 // two days
const INTERVENTION_INTERVAL = 1000 * 60 * 60 * 25 * 75 // 75 days

class AlarmManager {
  constructor(ctl) {
    this.ctl = ctl
  }

  async checkSync() {
    const accounts = await BrowserAccountStorage.getAllAccounts()
    const promises = []
    for (let accountId of accounts) {
      const account = await Account.get(accountId)
      const data = account.getData()
      const lastSync = data.lastSync || 0
      const interval = data.syncInterval || DEFAULT_SYNC_INTERVAL
      if (data.scheduled) {
        promises.push(this.ctl.scheduleSync(accountId))
        continue
      }
      if (data.error && data.errorCount > 1) {
        if (Date.now() > interval * 2 ** data.errorCount + lastSync) {
          promises.push(this.ctl.scheduleSync(accountId))
        }
        continue
      }
      if (
        Date.now() >
        interval * 1000 * 60 + lastSync
      ) {
        promises.push(this.ctl.scheduleSync(accountId))
      }
    }
    await Promise.all(promises)
  }
}

export default class BrowserController {
  constructor() {
    this.schedule = {}
    this.listeners = []

    this.alarms = new AlarmManager(this)

    this.unlocked = true
    this.setEnabled(true)

    Controller.singleton = this

    // set up change listener
    browser.bookmarks.onChanged.addListener((localId, details) =>
      this.onchange(localId, details)
    )
    browser.bookmarks.onMoved.addListener((localId, details) =>
      this.onchange(localId, details)
    )
    browser.bookmarks.onRemoved.addListener((localId, details) =>
      this.onchange(localId, details)
    )
    browser.bookmarks.onCreated.addListener((localId, details) =>
      this.onchange(localId, details)
    )

    browser.permissions.contains({permissions: ['history']}).then((historyAllowed) => {
      if (historyAllowed) {
        browser.history.onVisited.addListener((historyItem) => this.onVisitUrl(historyItem))
      }
    })

    // Set up the alarms

    browser.alarms.create('checkSync', { periodInMinutes: 1 })
    browser.alarms.onAlarm.addListener(async alarm => {
      await this.alarms[alarm.name]()
    })

    // lock accounts when locking is enabled

    browser.storage.local.get('accountsLocked').then(async d => {
      this.setEnabled(!d.accountsLocked)
      this.unlocked = !d.accountsLocked
      if (d.accountsLocked) {
        this.key = null
      }
    })

    // do some cleaning if this is a new version

    browser.storage.local.get(['currentVersion', 'lastInterventionAt']).then(async d => {
      if (packageJson.version === d.currentVersion) return
      await browser.storage.local.set({
        currentVersion: packageJson.version
      })

      const packageVersion = packageJson.version.split('.')
      const accounts = await Account.getAllAccounts()
      const lastVersion = d.currentVersion ? d.currentVersion.split('.') : []
      if ((packageVersion[0] !== lastVersion[0] || packageVersion[1] !== lastVersion[1]) && accounts.length !== 0) {
        if (d.lastInterventionAt && d.lastInterventionAt > Date.now() - INTERVENTION_INTERVAL) {
          return
        }
        browser.tabs.create({
          url: '/dist/html/options.html#/update',
          active: false
        })
        browser.storage.local.set({ lastInterventionAt: Date.now() })
      }
    })

    browser.storage.local.get('lastInterventionAt').then(async d => {
      const accounts = await Account.getAllAccounts()
      if (d.lastInterventionAt && d.lastInterventionAt < Date.now() - INTERVENTION_INTERVAL && accounts.length !== 0) {
        browser.tabs.create({
          url: 'https://floccus.org/donate/',
          active: false
        })
        browser.storage.local.set({ lastInterventionAt: Date.now() })
      }
    })

    // Set correct badge after waiting a bit
    setTimeout(() => this.updateStatus(), 3000)

    // Setup service worker messaging

    // eslint-disable-next-line no-undef
    if (!navigator.userAgent.includes('Firefox') && typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope) {
      addEventListener('message', (event) => this._receiveEvent(event.data, (data) => event.source.postMessage(data)))
    } else {
      browser.runtime.onMessage.addListener((data) => void (this._receiveEvent(data, (data) => {
        try {
          browser.runtime.sendMessage(data)
        } catch (e) {
          console.warn(e)
        }
      })))
    }
    this.onStatusChange(async() => {
      if (self?.clients) {
        const clientList = await self.clients.matchAll()
        clientList.forEach(client => {
          try {
            client.postMessage({ type: 'status:update', params: [] })
          } catch (e) {
            console.warn(e)
          }
        })
      } else {
        try {
          await browser.runtime.sendMessage({ type: 'status:update', params: [] })
        } catch (e) {
          console.warn(e)
        }
      }
    })

    // Run some things on browser startup
    browser.runtime.onStartup.addListener(this.onStartup)
  }

  async _receiveEvent(data, sendResponse) {
    const {type, params} = data
    const result = await this[type](...params)
    sendResponse({type: type + 'Response', params: [result]})

    // checkSync after waiting a bit
    setTimeout(() => this.alarms.checkSync(), 3000)
  }

  setEnabled(enabled) {
    this.enabled = enabled
    if (enabled) {
      // Sync after 7s
      setTimeout(() => {
        this.alarms.checkSync()
      }, 7000)
    }
  }

  async unlock(key) {
    let d = await browser.storage.local.get({ 'accountsLocked': null })
    if (d.accountsLocked) {
      let hashedKey = await Cryptography.sha256(key)
      let decryptedHash = await Cryptography.decryptAES(
        key,
        d.accountsLocked,
        'FLOCCUS'
      )

      if (decryptedHash !== hashedKey) {
        throw new Error('The provided key was wrong')
      }
      this.key = key
    }
    this.unlocked = true
    this.setEnabled(true)

    // remove encryption
    this.key = null
    await browser.storage.local.set({ accountsLocked: null })
    const accountIds = await BrowserAccountStorage.getAllAccounts()
    for (let accountId of accountIds) {
      const storage = new BrowserAccountStorage(accountId)
      const data = await storage.getAccountData(key)
      await storage.setAccountData(data, null)
    }
    let accounts = await BrowserAccount.getAllAccounts()
    await Promise.all(accounts.map(a => a.updateFromStorage()))
  }

  getUnlocked() {
    return Promise.resolve(this.unlocked)
  }

  async onchange(localId, details) {
    if (!this.enabled) {
      return
    }
    // Debounce this function
    this.setEnabled(false)

    const allAccounts = await BrowserAccount.getAllAccounts()

    // Check which accounts contain the bookmark and which used to contain (track) it
    const trackingAccountsFilter = await Promise.all(
      allAccounts.map(account => {
        return account.tracksBookmark(localId)
      })
    )

    let accountsToSync = allAccounts
      // Filter out any accounts that are not tracking the bookmark
      .filter((account, i) => trackingAccountsFilter[i])

    // Now we check the account of the new folder

    let containingAccounts = []
    try {
      const ancestors = await BrowserTree.getIdPathFromLocalId(localId)
      containingAccounts = await BrowserAccount.getAccountsContainingLocalId(
        localId,
        ancestors,
        allAccounts
      )
    } catch (e) {
      console.log(e)
      console.log('Could not detect containing account from localId ', localId)
    }

    accountsToSync = uniqBy(
      accountsToSync.concat(containingAccounts),
      acc => acc.id
    )
      // Filter out accounts that are not enabled
      .filter(account => account.getData().enabled)
      // Filter out accounts that are syncing, because the event may stem from the sync run
      .filter(account => !account.getData().syncing)

    // schedule a new sync for all accounts involved
    accountsToSync.forEach(account => {
      this.scheduleSync(account.id, true)
    })

    this.setEnabled(true)
  }

  async scheduleSync(accountId, wait) {
    if (wait) {
      if (this.schedule[accountId]) {
        clearTimeout(this.schedule[accountId])
      }
      console.log('scheduleSync: setting a timeout in ms :', INACTIVITY_TIMEOUT)
      this.schedule[accountId] = setTimeout(
        () => this.scheduleSync(accountId),
        INACTIVITY_TIMEOUT
      )
      return
    }

    let account = await Account.get(accountId)
    if (account.getData().syncing) {
      return
    }
    // if the account is already scheduled, don't prevent it, to avoid getting stuck
    if (!account.getData().enabled && !account.getData().scheduled) {
      return
    }

    const status = await this.getStatus()
    if (status === STATUS_SYNCING) {
      await account.setData({ scheduled: account.getData().scheduled || true })
      return
    }

    if (account.getData().scheduled === true) {
      await this.syncAccount(accountId)
    } else {
      await this.syncAccount(accountId, account.getData().scheduled)
    }
  }

  async scheduleAll() {
    const accounts = await Account.getAllAccounts()
    for (const account of accounts) {
      await account.setData({ scheduled: true })
    }
    this.updateStatus()
  }

  async cancelSync(accountId, keepEnabled) {
    let account = await Account.get(accountId)
    // Avoid starting it again automatically
    if (!keepEnabled) {
      await account.setData({ enabled: false })
    }
    await account.cancelSync()
  }

  async syncAccount(accountId, strategy, forceSync = false) {
    if (!this.enabled) {
      return
    }
    let account = await Account.get(accountId)
    if (account.getData().syncing) {
      return
    }
    // executes long-running async work without letting the service worker to die
    const interval = setInterval(() => browser.tabs.getCurrent(), 2e4)
    setTimeout(() => this.updateStatus(), 500)
    try {
      await account.sync(strategy, forceSync)
    } catch (error) {
      console.error(error)
    }
    clearInterval(interval)
    this.updateStatus()
  }

  async updateStatus() {
    await this.updateBadge()
    this.listeners.forEach(fn => fn())
  }

  onStatusChange(listener) {
    this.listeners.push(listener)
    let unregistered = false
    return () => {
      if (unregistered) return
      this.listeners.splice(this.listeners.indexOf(listener), 1)
      unregistered = true
    }
  }

  async getStatus() {
    if (!this.unlocked) {
      return STATUS_ERROR
    }
    const accounts = await Account.getAllAccounts()
    let overallStatus = accounts.reduce((status, account) => {
      const accData = account.getData()
      if (status === STATUS_SYNCING || accData.syncing || account.syncing) {
        // Show syncing symbol if any account is syncing
        return STATUS_SYNCING
      } else if (status === STATUS_ERROR || (accData.error && !accData.syncing) || (accData.enabled && accData.lastSync < Date.now() - STALE_SYNC_TIME)) {
        // Show error symbol if any account has an error and not currently syncing, or if any account is enabled but hasn't been synced for two days
        return STATUS_ERROR
      } else {
        // show allgood symbol otherwise
        return STATUS_ALLGOOD
      }
    }, STATUS_ALLGOOD)

    if (overallStatus === STATUS_ALLGOOD) {
      if (accounts.every(account => !account.getData().enabled)) {
        // if status is allgood but no account is enabled, show disabled
        overallStatus = STATUS_DISABLED
      }
    }

    return overallStatus
  }

  async updateBadge() {
    await this.setStatusBadge(await this.getStatus())
  }

  async setStatusBadge(status) {
    const icon = {
      [STATUS_ALLGOOD]: {path: '/icons/logo_32.png'},
      [STATUS_SYNCING]: {path: '/icons/syncing_32.png'},
      [STATUS_ERROR]: {path: '/icons/error_32.png'},
      [STATUS_DISABLED]: {path: '/icons/disabled_32.png'}
    }

    if (icon[status]) {
      if (browser.browserAction) {
        await browser.browserAction.setIcon(icon[status])
      } else if (browser.action) {
        await browser.action.setIcon(icon[status])
      }
    }
  }

  async onStartup() {
    const accounts = await Account.getAllAccounts()
    await Promise.all(
      accounts.map(async acc => {
        if (acc.getData().syncing) {
          await acc.setData({
            syncing: false,
            scheduled: acc.getData().enabled,
          })
        }
        if (acc.getData().localRoot === 'tabs') {
          await acc.init()
        }
      })
    )
  }

  async onLoad() {
    browser.storage.local.get('telemetryEnabled').then(async d => {
      if (!d.telemetryEnabled) {
        return
      }
      Sentry.init({
        dsn: 'https://836f0f772fbf2e12b9dd651b8e6b6338@o4507214911307776.ingest.de.sentry.io/4507216408870992',
        integrations: [],
        sampleRate: 0.15,
        release: packageJson.version,
        debug: true,
      })
    })
  }

  async onVisitUrl(historyItem) {
    if (!historyItem.url) {
      return
    }
    let accounts = await Account.getAllAccounts()
    accounts = accounts.filter(account => account.getData().clickCountEnabled)
    if (!accounts.length) {
      return
    }
    const bookmarks = await browser.bookmarks.search({url: historyItem.url})
    for (let bookmark of bookmarks) {
      let matchingAccounts = []
      try {
        const ancestors = await BrowserTree.getIdPathFromLocalId(bookmark.id)
        matchingAccounts = await BrowserAccount.getAccountsContainingLocalId(
          bookmark.id,
          ancestors,
          accounts,
          true
        )
      } catch (e) {
        console.log(e)
        console.log('Could not detect containing account from localId ', bookmark.id)
      }
      if (matchingAccounts.length) {
        await Promise.all(
          matchingAccounts.map(async account => {
            const server = await account.getServer()
            if (server.countClick) {
              await server.countClick(historyItem.url)
            }
          })
        )
      }
    }
  }
}
