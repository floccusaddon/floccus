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

const INACTIVITY_TIMEOUT = 7 * 1000
const DEFAULT_SYNC_INTERVAL = 15

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
      }
      if (
        Date.now() >
        interval * 1000 * 60 + lastSync
      ) {
        // noinspection ES6MissingAwait
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

    browser.storage.local.get('currentVersion').then(async d => {
      if (packageJson.version === d.currentVersion) return
      await browser.storage.local.set({
        currentVersion: packageJson.version
      })

      const packageVersion = packageJson.version.split('.')
      const lastVersion = d.currentVersion ? d.currentVersion.split('.') : []
      if (packageVersion[0] !== lastVersion[0] || packageVersion[1] !== lastVersion[1]) {
        browser.tabs.create({
          url: '/dist/html/options.html#/update',
          active: false
        })
      }
    })

    // Set correct badge after waiting a bit
    setTimeout(() => this.updateStatus(), 3000)

    // Setup service worker messaging

    // eslint-disable-next-line no-undef
    if (!navigator.userAgent.includes('Firefox') && typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope) {
      addEventListener('message', (event) => this._receiveEvent(event.data, (data) => event.source.postMessage(data)))
    } else {
      browser.runtime.onMessage.addListener((data) => void (this._receiveEvent(data, (data) => browser.runtime.sendMessage(data))))
    }
    this.onStatusChange(async() => {
      if (self?.clients) {
        const clientList = await self.clients.matchAll()
        clientList.forEach(client => client.postMessage({ type: 'status:update', params: [] }))
      } else {
        browser.runtime.sendMessage({type: 'status:update', params: []})
      }
    })
  }

  async _receiveEvent(data, sendResponse) {
    const {type, params} = data
    console.log('Message received', data)
    const result = await this[type](...params)
    sendResponse({type: type + 'Response', params: [result]})
    console.log('Sending message', {type: type + 'Response', params: [result]})

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

    console.log('Changes in browser Bookmarks detected...')

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

    console.log('onchange', {accountsToSync})

    // Now we check the account of the new folder

    let containingAccounts = []
    try {
      const ancestors = await BrowserTree.getIdPathFromLocalId(localId)
      console.log('onchange:', {ancestors, allAccounts})
      containingAccounts = await BrowserAccount.getAccountsContainingLocalId(
        localId,
        ancestors,
        allAccounts
      )
    } catch (e) {
      console.log(e)
      console.log('Could not detect containing account from localId ', localId)
    }

    console.log('onchange', accountsToSync.concat(containingAccounts))

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

    console.log('getting account')
    let account = await Account.get(accountId)
    console.log('got account')
    if (account.getData().syncing) {
      console.log('Account is already syncing. Not syncing again.')
      return
    }
    // if the account is already scheduled, don't prevent it, to avoid getting stuck
    if (!account.getData().enabled && !account.getData().scheduled) {
      console.log('Account is not enabled. Not syncing.')
      return
    }

    const status = await this.getStatus()
    if (status === STATUS_SYNCING) {
      await account.setData({ ...account.getData(), scheduled: account.getData().scheduled || true })
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
      await account.setData({...account.getData(), scheduled: true})
    }
    this.updateStatus()
  }

  async cancelSync(accountId, keepEnabled) {
    let account = await Account.get(accountId)
    // Avoid starting it again automatically
    if (!keepEnabled) {
      await account.setData({ ...account.getData(), enabled: false })
    }
    await account.cancelSync()
  }

  async syncAccount(accountId, strategy) {
    console.log('Called syncAccount ', accountId)
    if (!this.enabled) {
      console.log('Flocccus controller is not enabled. Not syncing.')
      return
    }
    let account = await Account.get(accountId)
    if (account.getData().syncing) {
      console.log('Account is already syncing. Not triggering another sync.')
      return
    }
    // executes long-running async work without letting the service worker to die
    const interval = setInterval(() => browser.tabs.getCurrent(), 2e4)
    setTimeout(() => this.updateStatus(), 500)
    try {
      await account.sync(strategy)
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
        return STATUS_SYNCING
      } else if (status === STATUS_ERROR || (accData.error && !accData.syncing)) {
        return STATUS_ERROR
      } else {
        return STATUS_ALLGOOD
      }
    }, STATUS_ALLGOOD)

    if (overallStatus === STATUS_ALLGOOD) {
      if (accounts.every(account => !account.getData().enabled)) {
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
      if (navigator.userAgent.includes('Firefox')) {
        await browser.browserAction.setIcon(icon[status])
      } else {
        await browser.action.setIcon(icon[status])
      }
    }
  }

  async onLoad() {
    const accounts = await Account.getAllAccounts()
    await Promise.all(
      accounts.map(async acc => {
        if (acc.getData().syncing) {
          await acc.setData({
            ...acc.getData(),
            syncing: false,
          })
        }
      })
    )
  }
}
