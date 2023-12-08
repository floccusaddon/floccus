import { Preferences as Storage } from '@capacitor/preferences'
import { Network } from '@capacitor/network'
import Cryptography from '../Crypto'
import NativeAccountStorage from './NativeAccountStorage'

import PQueue from 'p-queue'
import Account from '../Account'

const INACTIVITY_TIMEOUT = 1000 * 7
const DEFAULT_SYNC_INTERVAL = 15

class AlarmManager {
  constructor(ctl) {
    this.ctl = ctl
    this.backgroundSyncEnabled = true
    setInterval(() => this.checkSync(), 60 * 1000)

    Network.addListener('networkStatusChange', status => {
      if (status.connected && status.connectionType === 'wifi') {
        this.backgroundSyncEnabled = true
      } else {
        this.backgroundSyncEnabled = false
      }
    })
  }

  async checkSync() {
    if (!this.backgroundSyncEnabled) {
      return
    }
    const accounts = await NativeAccountStorage.getAllAccounts()
    for (let accountId of accounts) {
      const account = await Account.get(accountId)
      const data = account.getData()
      if (
        !data.lastSync ||
        Date.now() >
        (data.syncInterval || DEFAULT_SYNC_INTERVAL) * 1000 * 60 + data.lastSync
      ) {
        // noinspection ES6MissingAwait
        this.ctl.scheduleSync(accountId)
      }
    }
  }
}

export default class NativeController {
  constructor() {
    this.jobs = new PQueue({ concurrency: 1 })
    this.waiting = {}
    this.schedule = {}
    this.listeners = []

    this.alarms = new AlarmManager(this)

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

  async onLoad() {
    const accounts = await Account.getAllAccounts()
    await Promise.all(
      accounts.map(async acc => {
        if (acc.getData().syncing) {
          await acc.setData({
            ...acc.getData(),
            syncing: false,
            error: false,
          })
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
