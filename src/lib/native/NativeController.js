import { Preferences as Storage } from '@capacitor/preferences'
import { Network } from '@capacitor/network'
import Cryptography from '../Crypto'
import NativeAccountStorage from './NativeAccountStorage'
import Account from '../Account'
import { STATUS_ALLGOOD, STATUS_DISABLED, STATUS_ERROR, STATUS_SYNCING } from '../interfaces/Controller'
import { LocalNotifications } from '@capacitor/local-notifications'
import { i18n } from './I18n'
import ScreenWakeLock from './ScreenWakeLock'
import { isSyncDue } from '../SyncSchedule'

const INACTIVITY_TIMEOUT = 1000 * 7
const NETWORK_SETTLE_TIMEOUT = 1000 * 5

class AlarmManager {
  constructor(ctl) {
    this.ctl = ctl
    this.backgroundSyncEnabled = true
    setInterval(() => this.checkSync(), 25 * 1000)
    setInterval(() => this.checkStorage(), 30 * 1000)

    Network.addListener('networkStatusChange', status => {
      if (status.connected) {
        const restored = !this.backgroundSyncEnabled
        this.backgroundSyncEnabled = true
        if (restored) {
          // Retry failed syncs right away instead of waiting out the backoff,
          // once the network had a moment to settle
          setTimeout(() => this.checkSync(true), NETWORK_SETTLE_TIMEOUT)
        }
      } else {
        this.backgroundSyncEnabled = false
      }
    })
  }

  async checkStorage() {
    // empty
  }

  /**
   * @param {boolean} networkRestored - the connection just came back, see isSyncDue
   */
  async checkSync(networkRestored = false) {
    if (!this.backgroundSyncEnabled) {
      return
    }
    const accounts = await NativeAccountStorage.getAllAccounts()
    for (let accountId of accounts) {
      const account = await Account.get(accountId)
      if (isSyncDue(account.getData(), Date.now(), true, networkRestored)) {
        await this.ctl.scheduleSync(accountId)
      }
    }
  }
}

export default class NativeController {
  constructor() {
    this.schedule = {}
    this.listeners = []

    this.alarms = new AlarmManager(this)

    // Remove old logs. Only the stored ones: what this run has logged so far
    // is still in Logger's buffer and belongs in the fresh log.

    NativeAccountStorage.clearLogs()

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
    const startTime = Date.now()
    setTimeout(() => this.updateStatus(), 500)
    let notifications
    if ((await LocalNotifications.checkPermissions()).display !== 'denied') {
      ({ notifications } = await LocalNotifications.schedule({
        notifications: [
          {
            id: Math.round((Math.random() * 2 - 1) * 2147483647),
            title: i18n.getMessage('StatusSyncing'),
            body: i18n.getMessage('NotificationSyncingprofile', [account.getLabel()]),
            ongoing: true,
            smallIcon: 'notification_icon',
            largeIcon: 'notification_icon',
          }
        ]
      }))
    }
    await ScreenWakeLock.acquire()
    try {
      await account.sync(strategy, forceSync)
    } catch (error) {
      console.error(error)
    } finally {
      await ScreenWakeLock.release()
    }
    if ((await LocalNotifications.checkPermissions()).display !== 'denied') {
      // Cancel the ongoing notification
      await LocalNotifications.cancel({ notifications })
      // eslint-disable-next-line no-constant-condition
      if (Date.now() - startTime > 60 * 1000) {
        await LocalNotifications.schedule({
          notifications: [
            {
              id: Math.round((Math.random() * 2 - 1) * 2147483647),
              title: account.getData().error
                ? i18n.getMessage('StatusSyncingfailed')
                : i18n.getMessage('StatusSyncingcomplete'),
              body: account.getData().error
                ? i18n.getMessage('NotificationSyncingfailed', [account.getLabel()])
                : i18n.getMessage('NotificationSyncingsucceeded', [account.getLabel()]),
              smallIcon: 'notification_icon',
              largeIcon: 'notification_icon',
            }
          ]
        })
      }
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
      if (accounts.every(account => !account.getData().enabled && !account.getData().syncIntervalEnabled && !account.getData().syncOnStartupEnabled)) {
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
    if ((await LocalNotifications.checkPermissions()).display !== 'denied') {
      LocalNotifications.requestPermissions()
    }

    const accounts = await Account.getAllAccounts()
    await Promise.all(
      accounts.map(async acc => {
        if (acc.getData().syncing) {
          await acc.setData({
            syncing: false,
            scheduled: false,
          })
        }
        if (acc.getData().syncOnStartupEnabled) {
          this.scheduleSync(acc.id)
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
