import browser from './browser-api'
import Account from './Account'
import LocalTree from './LocalTree'
import Cryptography from './Crypto'
import packageJson from '../../package.json'
const PQueue = require('p-queue')

const STATUS_ERROR = Symbol('error')
const STATUS_SYNCING = Symbol('syncing')
const STATUS_ALLGOOD = Symbol('allgood')
const INACTIVITY_TIMEOUT = 1000 * 60
const DEFAULT_SYNC_INTERVAL = 15

class AlarmManager {
  constructor(ctl) {
    this.ctl = ctl
  }

  async checkSync() {
    const d = await browser.storage.local.get('accounts')
    var accounts = d['accounts']
    for (var accountId in accounts) {
      const account = await Account.get(accountId)
      const data = account.getData()
      if (
        Date.now() >
        (data.syncInterval || DEFAULT_SYNC_INTERVAL) * 1000 * 60 + data.lastSync
      ) {
        this.ctl.scheduleSync(accountId)
      }
    }
  }
}

export default class Controller {
  constructor() {
    this.jobs = new PQueue({ concurrency: 1 })
    this.waiting = {}
    this.schedule = {}
    this.listeners = []

    this.alarms = new AlarmManager(this)

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
    browser.alarms.onAlarm.addListener(alarm => {
      this.alarms[alarm.name]()
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
      const accounts = await Account.getAllAccounts()
      await Promise.all(accounts.map(account => account.init()))
      await Promise.all(
        accounts.map(account =>
          account.setData({ ...account.getData(), enabled: true })
        )
      )
      await browser.storage.local.set({
        currentVersion: packageJson.version
      })
    })

    this.alarms.checkSync()

    setInterval(() => this.updateStatus(), 500)
  }

  setEnabled(enabled) {
    this.enabled = enabled
  }

  async setKey(key) {
    let accounts = await Account.getAllAccounts()
    this.key = key
    let hashedKey = await Cryptography.sha256(key)
    let encryptedHash = await Cryptography.encryptAES(
      key,
      Cryptography.iv,
      hashedKey
    )
    await browser.storage.local.set({ accountsLocked: encryptedHash })
    await Promise.all(accounts.map(a => a.setData(a.getData())))

    // ...aand lock it immediately.
    this.key = null
    this.unlocked = false
    this.setEnabled(false)
  }

  async unlock(key) {
    let d = await browser.storage.local.get('accountsLocked')
    let hashedKey = await Cryptography.sha256(key)
    let decryptedHash = await Cryptography.decryptAES(
      key,
      Cryptography.iv,
      d.accountsLocked
    )
    if (decryptedHash !== hashedKey) {
      throw new Error('The provided key was wrong')
    }
    this.key = key
    this.unlocked = true
    this.setEnabled(true)
  }

  async unsetKey() {
    if (!this.unlocked) {
      throw new Error('Cannot disable encryption without unlocking first')
    }
    let accounts = await Account.getAllAccounts()
    this.key = null
    await browser.storage.local.set({ accountsLocked: null })
    await Promise.all(accounts.map(a => a.setData(a.getData())))
  }

  async onchange(localId, details) {
    if (!this.enabled) {
      return
    }
    // Debounce this function
    this.setEnabled(false)

    const allAccounts = await Account.getAllAccounts()

    // Check which accounts contain the bookmark and which used to contain (track) it
    var trackingAccountsFilter = await Promise.all(
      allAccounts.map(async account => {
        return account.tracksBookmark(localId)
      })
    )

    const accountsToSync = allAccounts
      // Filter out any accounts that are not tracking the bookmark
      .filter((account, i) => trackingAccountsFilter[i])
      // Filter out any accounts that are presently syncing
      .filter(account => !account.getData().syncing)
      // Filter out accounts that are not enabled
      .filter(account => account.getData().enabled)

    // We should now sync the account that used to contain this bookmark
    accountsToSync.forEach(account => {
      this.scheduleSync(account.id)
    })

    // Now we check the account of the new folder

    var ancestors
    try {
      ancestors = await LocalTree.getIdPathFromLocalId(localId)
    } catch (e) {
      this.setEnabled(true)
      return
    }

    const containingAccount = await Account.getAccountContainingLocalId(
      localId,
      ancestors,
      allAccounts
    )
    if (
      containingAccount &&
      !containingAccount.getData().syncing &&
      containingAccount.getData().enabled &&
      !accountsToSync.some(acc => acc.id === containingAccount.id)
    ) {
      this.scheduleSync(containingAccount.id, true)
    }

    this.setEnabled(true)
  }

  async scheduleSync(accountId, wait) {
    if (wait) {
      if (this.schedule[accountId]) {
        clearTimeout(this.schedule[accountId])
      }
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
    if (!account.getData().enabled) {
      return
    }

    if (this.waiting[accountId]) {
      return
    }

    this.waiting[accountId] = true

    return this.jobs.add(() => this.syncAccount(accountId))
  }

  async cancelSync(accountId) {
    let account = await Account.get(accountId)
    // Avoid starting it again automatically
    account.setData({ ...account.getData(), enabled: false })
    account.cancelSync()
  }

  async syncAccount(accountId) {
    this.waiting[accountId] = false
    if (!this.enabled) {
      return
    }
    let account = await Account.get(accountId)
    if (account.getData().syncing) {
      return
    }
    if (!account.getData().enabled) {
      return
    }
    setTimeout(() => this.updateStatus(), 500)
    try {
      await account.sync()
    } catch (error) {
      console.error(error)
    }
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

  async updateBadge() {
    if (!this.unlocked) {
      return this.setStatusBadge(STATUS_ERROR)
    }
    const accounts = await Account.getAllAccounts()
    const overallStatus = accounts.reduce((status, account) => {
      const accData = account.getData()
      if (status === STATUS_ERROR || (accData.error && !accData.syncing)) {
        return STATUS_ERROR
      } else if (status === STATUS_SYNCING || accData.syncing) {
        return STATUS_SYNCING
      } else {
        return STATUS_ALLGOOD
      }
    }, STATUS_ALLGOOD)
    this.setStatusBadge(overallStatus)
  }

  // TODO: Convert switch to object access
  async setStatusBadge(status) {
    switch (status) {
      case STATUS_ALLGOOD:
        browser.browserAction.setBadgeText({ text: '' })
        break
      case STATUS_SYNCING:
        browser.browserAction.setBadgeText({ text: '<->' })
        browser.browserAction.setBadgeBackgroundColor({ color: '#0088dd' })
        break
      case STATUS_ERROR:
        browser.browserAction.setBadgeText({ text: '!' })
        browser.browserAction.setBadgeBackgroundColor({ color: '#dd4d00' })
        break
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
            error: browser.i18n.getMessage('Error027')
          })
        }
      })
    )
  }
}
