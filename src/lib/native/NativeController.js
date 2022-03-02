import { Storage } from '@capacitor/storage'
import NativeAccount from './NativeAccount'
import NativeTree from './NativeTree'
import Cryptography from '../Crypto'
import packageJson from '../../../package.json'
import NativeAccountStorage from './NativeAccountStorage'
import {i18n} from './I18n'
import _ from 'lodash'

import PQueue from 'p-queue'

const INACTIVITY_TIMEOUT = 1000 * 60
const DEFAULT_SYNC_INTERVAL = 15

class AlarmManager {
  constructor(ctl) {
    this.ctl = ctl
    setInterval(() => this.checkSync(), 60 * 1000)
  }

  async checkSync() {
    const accounts = await NativeAccountStorage.getAllAccounts()
    for (let accountId of accounts) {
      const account = await NativeAccount.get(accountId)
      const data = account.getData()
      if (!data.lastSync ||
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

    // do some cleaning if this is a new version

    Storage.get({key: 'currentVersion'}).then(async({value: currentVersion}) => {
      if (packageJson.version === currentVersion) return
      await Storage.set({key: 'currentVersion', value: packageJson.version})

      const packageVersion = packageJson.version.split('.')
      const lastVersion = currentVersion ? currentVersion.split('.') : []
      if (packageVersion[0] !== lastVersion[0] || packageVersion[1] !== lastVersion[1]) {
        // TODO display '/dist/html/options.html#/update',
      }
    })
  }

  setEnabled(enabled) {
    this.enabled = enabled
  }

  async setKey(key) {
    let accounts = await NativeAccount.getAllAccounts()
    await Promise.all(accounts.map(a => a.updateFromStorage()))
    this.key = key
    let hashedKey = await Cryptography.sha256(key)
    let encryptedHash = await Cryptography.encryptAES(
      key,
      hashedKey,
      'FLOCCUS'
    )
    await Storage.set({ key: 'accountsLocked', value: encryptedHash })
    if (accounts.length) {
      await Promise.all(accounts.map(a => a.setData(a.getData())))
    }

    // ...aand unlock it immediately.
    this.unlocked = true
    this.setEnabled(true)
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

  async unsetKey() {
    if (!this.unlocked) {
      throw new Error('Cannot disable encryption without unlocking first')
    }
    let accounts = await NativeAccount.getAllAccounts()
    await Promise.all(accounts.map(a => a.updateFromStorage()))
    this.key = null
    await Storage.set({ key: 'accountsLocked', value: null })
    await Promise.all(accounts.map(a => a.setData(a.getData())))
  }

  async onchange(localId, details) {
    if (!this.enabled) {
      return
    }
    // Debounce this function
    this.setEnabled(false)

    const allAccounts = await NativeAccount.getAllAccounts()

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
      ancestors = await NativeTree.getIdPathFromLocalId(localId)
    } catch (e) {
      this.setEnabled(true)
      return
    }

    const containingAccounts = await NativeAccount.getAccountsContainingLocalId(
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
      this.cancelSync(account.id, true)
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

    let account = await NativeAccount.get(accountId)
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
    let account = await NativeAccount.get(accountId)
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
    let account = await NativeAccount.get(accountId)
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
    const accounts = await NativeAccount.getAllAccounts()
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
