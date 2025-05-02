import { Preferences as Storage } from '@capacitor/preferences'
import { Network } from '@capacitor/network'
import Cryptography from '../Crypto'
import NativeAccountStorage from './NativeAccountStorage'
import Account from '../Account'
import { STATUS_ALLGOOD, STATUS_DISABLED, STATUS_ERROR, STATUS_SYNCING } from '../interfaces/Controller'
import { freeStorageIfNecessary } from '../IndexedDB'
import Logger from '../Logger'

const INACTIVITY_TIMEOUT = 1000 * 7
const MAX_BACKOFF_INTERVAL = 1000 * 60 * 60 // 1 hour
const DEFAULT_SYNC_INTERVAL = 15

class AlarmManager {
  constructor(ctl) {
    this.ctl = ctl
    this.backgroundSyncEnabled = true
    setInterval(() => this.checkSync(), 25 * 1000)
    setInterval(() => this.checkStorage(), 30 * 1000)

    Network.addListener('networkStatusChange', status => {
      if (status.connected) {
        this.backgroundSyncEnabled = true
      } else {
        this.backgroundSyncEnabled = false
      }
    })
  }

  async checkStorage() {
    await freeStorageIfNecessary()
  }

  async checkSync() {
    if (!this.backgroundSyncEnabled) {
      return
    }
    const accounts = await NativeAccountStorage.getAllAccounts()
    for (let accountId of accounts) {
      const account = await Account.get(accountId)
      const data = account.getData()
      const lastSync = data.lastSync || 0
      const interval = data.syncInterval || DEFAULT_SYNC_INTERVAL
      if (data.scheduled) {
        await this.ctl.scheduleSync(accountId)
        continue
      }
      if (data.error && data.errorCount > 1) {
        if (Date.now() > this.getBackoffInterval(interval, data.errorCount, lastSync) + lastSync) {
          await this.ctl.scheduleSync(accountId)
          continue
        }
        continue
      }
      if (
        Date.now() >
        interval * 1000 * 60 + data.lastSync
      ) {
        await this.ctl.scheduleSync(accountId)
      }
    }
  }

  /**
   * Calculates the backoff interval based on the synchronization interval and the error count.
   *
   * This method determines the delay before retrying a synchronization
   * after one or more errors have occurred. It uses an exponential
   * backoff algorithm with a cap at the maximum backoff interval.
   *
   * @param {number} interval - The synchronization interval in minutes.
   * @param {number} errorCount - The number of consecutive errors encountered.
   * @param {number} lastSync - The timestamp of when the last successful sync happened.
   * @returns {number} - The calculated backoff interval in milliseconds.
   */
  getBackoffInterval(interval, errorCount, lastSync) {
    const maxErrorCount = Math.log2(MAX_BACKOFF_INTERVAL / (interval * 1000 * 60))
    if (errorCount < maxErrorCount || lastSync + MAX_BACKOFF_INTERVAL > Date.now()) {
      return Math.min(MAX_BACKOFF_INTERVAL, interval * 1000 * 60 * Math.pow(2, errorCount))
    } else {
      return MAX_BACKOFF_INTERVAL + MAX_BACKOFF_INTERVAL * (errorCount - maxErrorCount)
    }
  }
}

export default class NativeController {
  constructor() {
    this.schedule = {}
    this.listeners = []

    this.alarms = new AlarmManager(this)

    // Remove old logs

    NativeAccountStorage.changeEntry(
      'logs',
      log => {
        return []
      },
      []
    )

    // lock accounts when locking is enabled

    Storage.get({key: 'accountsLocked' }).then(async({value: accountsLocked}) => {
      this.setEnabled(!accountsLocked)
      this.unlocked = !accountsLocked
      if (accountsLocked) {
        this.key = null
      }
    })
  }

  setEnabled(enabled) {
    this.enabled = enabled
  }

  async unlock(key) {
    let accountsLocked = await Storage.get({ key: 'accountsLocked' })
    if (accountsLocked) {
      let hashedKey = await Cryptography.sha256(key)
      let decryptedHash = await Cryptography.decryptAES(
        key,
        accountsLocked,
        'FLOCCUS'
      )

      if (decryptedHash !== hashedKey) {
        throw new Error('The provided key was wrong')
      }
      this.key = key
    }
    this.unlocked = true
    this.setEnabled(true)
  }

  getUnlocked() {
    return Promise.resolve(this.unlocked)
  }

  async scheduleAll() {
    const accounts = await Account.getAllAccounts()
    for (const account of accounts) {
      this.scheduleSync(account.id)
    }
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
    setTimeout(() => this.updateStatus(), 500)
    try {
      await account.sync(strategy, forceSync)
    } catch (error) {
      console.error(error)
    }
    this.updateStatus()
  }

  async updateStatus() {
    this.listeners.forEach(fn => fn())
  }

  async getStatus() {
    if (!this.unlocked) {
      return STATUS_ERROR
    }
    const accounts = await Account.getAllAccounts()
    let overallStatus = accounts.reduce((status, account) => {
      const accData = account.getData()
      if (status === STATUS_SYNCING || accData.syncing) {
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

  onStatusChange(listener) {
    this.listeners.push(listener)
    let unregistered = false
    return () => {
      if (unregistered) return
      this.listeners.splice(this.listeners.indexOf(listener), 1)
      unregistered = true
    }
  }

  async onLoad() {
    const accounts = await Account.getAllAccounts()
    await Promise.all(
      accounts.map(async acc => {
        if (acc.getData().syncing) {
          Logger.log('Discovered account stuck syncing, resetting: ', acc.getLabel())
          await acc.setData({
            syncing: false,
            scheduled: acc.getData().enabled,
          })
          await acc.init()
        }
      })
    )
  }
}

let singleton
NativeController.getSingleton = function() {
  if (!singleton) {
    singleton = new NativeController()
  }
  return singleton
}
