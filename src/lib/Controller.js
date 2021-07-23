import browser from './browser-api'
import Account from './Account'
import LocalTree from './LocalTree'
import Cryptography from './Crypto'
import DefunctCryptography from './DefunctCrypto'
import packageJson from '../../package.json'
import AccountStorage from './AccountStorage'
import _ from 'lodash'

import PQueue from 'p-queue'

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
    const accounts = await AccountStorage.getAllAccounts()
    for (let accountId of accounts) {
      const account = await Account.get(accountId)
      const data = account.getData()
      const lastSync = data.lastSync || 0
      const interval = data.syncInterval || DEFAULT_SYNC_INTERVAL
      if (
        Date.now() >
        interval * 1000 * 60 + lastSync
      ) {
        // noinspection ES6MissingAwait
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
      await browser.storage.local.set({
        currentVersion: packageJson.version
      })

      // Set flag to switch to new encryption implementation
      const oldVersion = d.currentVersion.split('.')
      const e = await browser.storage.local.get('accountsLocked')
      // eslint-disable-next-line eqeqeq
      if (e.accountsLocked && oldVersion[0] === '4' && (oldVersion[1] < 5 || (oldVersion[1] == 5 && oldVersion[2] == 0))) {
        await browser.storage.local.set({
          rekeyAfterUpdate: true
        })
      }

      const packageVersion = packageJson.version.split('.')
      const lastVersion = d.currentVersion ? d.currentVersion.split('.') : []
      if (packageVersion[0] !== lastVersion[0] || packageVersion[1] !== lastVersion[1]) {
        browser.tabs.create({
          url: '/dist/html/options.html#/update',
          active: false
        })
      }
    })

    setInterval(() => this.updateStatus(), 10000)
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

  async setKey(key) {
    let accounts = await Account.getAllAccounts()
    await Promise.all(accounts.map(a => a.updateFromStorage()))
    this.key = key
    let hashedKey = await Cryptography.sha256(key)
    let encryptedHash = await Cryptography.encryptAES(
      key,
      hashedKey,
      'FLOCCUS'
    )
    await browser.storage.local.set({ accountsLocked: encryptedHash })
    if (accounts.length) {
      await Promise.all(accounts.map(a => a.setData(a.getData())))
    }

    // ...aand unlock it immediately.
    this.unlocked = true
    this.setEnabled(true)
  }

  async unlock(key) {
    let d = await browser.storage.local.get({ 'accountsLocked': null })
    let e = await browser.storage.local.get({ 'rekeyAfterUpdate': null })
    if (d.accountsLocked) {
      if (e.rekeyAfterUpdate) {
        let hashedKey = await DefunctCryptography.sha256(key)
        let decryptedHash = await DefunctCryptography.decryptAES(
          key,
          DefunctCryptography.iv,
          d.accountsLocked
        )

        if (decryptedHash !== hashedKey) {
          throw new Error('The provided key was wrong')
        }

        this.unlocked = true
        this.key = key
        await this.unsetKey()
        await this.setKey(key)

        await browser.storage.local.set({
          rekeyAfterUpdate: null
        })
      } else {
        let hashedKey = await Cryptography.sha256(key)
        let decryptedHash = await Cryptography.decryptAES(
          key,
          d.accountsLocked,
          'FLOCCUS'
        )

        if (decryptedHash !== hashedKey) {
          throw new Error('The provided key was wrong')
        }
      }
      this.key = key
    }
    this.unlocked = true
    this.setEnabled(true)
  }

  async unsetKey() {
    if (!this.unlocked) {
      throw new Error('Cannot disable encryption without unlocking first')
    }
    let accounts = await Account.getAllAccounts()
    await Promise.all(accounts.map(a => a.updateFromStorage()))
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
    const trackingAccountsFilter = await Promise.all(
      allAccounts.map(async account => {
        return account.tracksBookmark(localId)
      })
    )

    let accountsToSync = allAccounts
      // Filter out any accounts that are not tracking the bookmark
      .filter((account, i) => trackingAccountsFilter[i])

    // Now we check the account of the new folder

    let ancestors
    try {
      ancestors = await LocalTree.getIdPathFromLocalId(localId)
    } catch (e) {
      this.setEnabled(true)
      return
    }

    const containingAccounts = await Account.getAccountsContainingLocalId(
      localId,
      ancestors,
      allAccounts
    )
    accountsToSync = _.uniqBy(
      accountsToSync.concat(containingAccounts),
      acc => acc.id)
      // Filter out any accounts that are presently syncing
      .filter(account => !account.getData().syncing)
      // Filter out accounts that are not enabled
      .filter(account => account.getData().enabled)

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

  async cancelSync(accountId, keepEnabled) {
    let account = await Account.get(accountId)
    // Avoid starting it again automatically
    if (!keepEnabled) {
      await account.setData({ ...account.getData(), enabled: false })
    }
    await account.cancelSync()
  }

  async syncAccount(accountId, strategy) {
    this.waiting[accountId] = false
    if (!this.enabled) {
      return
    }
    let account = await Account.get(accountId)
    if (account.getData().syncing) {
      return
    }
    setTimeout(() => this.updateStatus(), 500)
    try {
      await account.sync(strategy)
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

  async setStatusBadge(status) {
    const badge = {
      [STATUS_ALLGOOD]: {
        text: ''
      },
      [STATUS_SYNCING]: {
        text: '<->',
        color: '#0088dd'
      },
      [STATUS_ERROR]: {
        text: '!',
        color: '#dd4d00'
      }
    }

    await browser.browserAction.setBadgeText({ text: badge[status].text })
    if (badge[status].color) {
      await browser.browserAction.setBadgeBackgroundColor({
        color: badge[status].color
      })
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
          // reset cache after interrupted sync
          await acc.init()
        }
      })
    )
  }
}
