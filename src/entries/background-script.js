import browser from '../lib/browser-api'
import Account from '../lib/Account'
import AccountStorage from '../lib/AccountStorage'
import Tree from '../lib/Tree'

const STATUS_ERROR = Symbol('error')
const STATUS_SYNCING = Symbol('syncing')
const STATUS_ALLGOOD = Symbol('allgood')

// FIRST RUN
// Set up some things on first run

browser.storage.local.get('notFirstRun')
  .then(d => {
    if (d.notFirstRun) return
    browser.storage.local.set({notFirstRun: true})
    browser.storage.local.set({accounts: {}})
    browser.runtime.openOptionsPage()
  })

class AlarmManger {
  constructor (ctl) {
    this.ctl = ctl
  }

  syncAllAccounts () {
    browser.storage.local.get('accounts')
      .then((d) => {
        var accounts = d['accounts']
        for (var accountId in accounts) {
          this.ctl.syncAccount(accountId)
        }
      })
  }
}

class Controller {
  constructor () {
    this.syncing = {}

    this.alarms = new AlarmManger(this)

    // set up change listener
    browser.bookmarks.onChanged.addListener((localId, details) => this.onchange(localId, details))
    browser.bookmarks.onMoved.addListener((localId, details) => this.onchange(localId, details))
    browser.bookmarks.onRemoved.addListener((localId, details) => this.onchange(localId, details))
    browser.bookmarks.onCreated.addListener((localId, details) => this.onchange(localId, details))

    // Set up the alarms

    browser.alarms.create('syncAllAccounts', {periodInMinutes: 25})
    browser.alarms.onAlarm.addListener(alarm => {
      this.alarms[alarm.name]()
    })

    window.syncAccount = (accountId) => this.syncAccount(accountId)
  }

  async onchange (localId, details) {
    const allAccounts = await Account.getAllAccounts()

    // Check which accounts contain the bookmark and which used to contain (track) it
    var trackingAccountsFilter = await Promise.all(
      allAccounts
        .map(async account => {
          return account.tracksBookmark(localId)
        })
    )

    const accountsToSync = allAccounts
    // Filter out any accounts that are not tracking the bookmark
      .filter((account, i) => (trackingAccountsFilter[i]))
      // Filter out any accounts that are presently syncing
      .filter(account => !this.syncing[account.id])

    // We should now sync all accounts that are involved in this change (2 at max)
    accountsToSync.forEach((account) => {
      this.syncAccount(account.id)
    })

    var ancestors
    try {
      ancestors = await Tree.getIdPathFromLocalId(localId)
    } catch (e) {
      return
    }

    const containingAccount = await Account.getAccountContainingLocalId(localId, ancestors, allAccounts)
    if (containingAccount &&
      !this.syncing[containingAccount.id] &&
      !accountsToSync.some(acc => acc.id === containingAccount.id)) {
      this.syncAccount(containingAccount.id)
    }
  }

  syncAccount (accountId) {
    if (this.syncing[accountId]) {
      return this.syncing[accountId].then(() => {
        return this.syncAccount(accountId)
      })
    }
    this.syncing[accountId] = Account.get(accountId)
      .then((account) => {
        setTimeout(() => this.updateBadge(), 500)
        return account.sync()
      })
      .then(() => {
        this.syncing[accountId] = false
        this.updateBadge()
      }, (error) => {
        console.error(error)
        this.syncing[accountId] = false
        this.updateBadge()
      })
    return this.syncing[accountId]
  }

  async updateBadge () {
    const accounts = await Account.getAllAccounts()
    const overallStatus = accounts
      .reduce((status, account) => {
        const accData = account.getData()
        if (accData.error && !accData.syncing) {
          return STATUS_ERROR
        } else if (accData.syncing && status !== STATUS_ERROR) {
          return STATUS_SYNCING
        } else {
          return STATUS_ALLGOOD
        }
      }, STATUS_ALLGOOD)
    this.setStatusBadge(overallStatus)
  }

  async setStatusBadge (status) {
    switch (status) {
      case STATUS_ALLGOOD:
        browser.browserAction.setBadgeText({text: ''})
        break
      case STATUS_SYNCING:
        browser.browserAction.setBadgeText({text: '<->'})
        browser.browserAction.setBadgeBackgroundColor({color: '#0088dd'})
        break
      case STATUS_ERROR:
        browser.browserAction.setBadgeText({text: '!'})
        browser.browserAction.setBadgeBackgroundColor({color: '#dd4d00'})
        break
    }
  }
}

var controller = new Controller()
