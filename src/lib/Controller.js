import browser from './browser-api'
import Account from './Account'
import Tree from './Tree'
import Cryptography from './Crypto'
import packageJson from '../../package.json'

const STATUS_ERROR = Symbol('error')
const STATUS_SYNCING = Symbol('syncing')
const STATUS_ALLGOOD = Symbol('allgood')
const INACTIVITY_TIMEOUT = 1000 * 60

class AlarmManger {
  constructor(ctl) {
    this.ctl = ctl
  }

  syncAllAccounts() {
    browser.storage.local.get('accounts').then(d => {
      var accounts = d['accounts']
      for (var accountId in accounts) {
        this.ctl.syncAccount(accountId)
      }
    })
  }
}

export default class Controller {
  constructor() {
    this.schedule = {}
    this.listeners = []

    this.alarms = new AlarmManger(this)

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

    browser.alarms.create('syncAllAccounts', { periodInMinutes: 15 })
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
      await browser.storage.local.set({
        currentVersion: packageJson.version
      })
      browser.runtime.openOptionsPage()
    })
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

    // We should now sync all accounts that are involved in this change (2 at max)
    accountsToSync.forEach(account => {
      this.scheduleSyncAccount(account.id)
    })

    var ancestors
    try {
      ancestors = await Tree.getIdPathFromLocalId(localId)
    } catch (e) {
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
      !accountsToSync.some(acc => acc.id === containingAccount.id)
    ) {
      this.scheduleSyncAccount(containingAccount.id)
    }
  }

  scheduleSyncAccount(accountId) {
    if (this.schedule[accountId]) {
      clearTimeout(this.schedule[accountId])
    }
    this.schedule[accountId] = setTimeout(
      () => this.syncAccount(accountId),
      INACTIVITY_TIMEOUT
    )
  }

  async syncAccount(accountId) {
    if (!this.enabled) {
      return
    }
    let account = await Account.get(accountId)
    if (account.getData().syncing) {
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
      } else if (status == STATUS_SYNCING || accData.syncing) {
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
            error: 'Sync process was interrupted'
          })
        }
      })
    )
  }
}

window.controller = new Controller()
