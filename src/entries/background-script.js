import browser from '../lib/browser-api'
import Account from '../lib/Account'
import AccountStorage from '../lib/AccountStorage'
import Tree from '../lib/Tree'

// FIRST RUN
// Set up some things on first run

browser.storage.local.get('notFirstRun')
.then(d => {
  if (d.notFirstRun) return
  browser.storage.local.set({notFirstRun: true})
  browser.storage.local.set({accounts: {}})
  browser.runtime.openOptionsPage()
})


// SYNC LOOP
// sync regularly
browser.alarms.create('sync', {periodInMinutes: 25})
browser.alarms.onAlarm.addListener(alarm => {
  browser.storage.local.get('accounts')
  .then((d) => {
    var accounts = d['accounts']
    for (var accountId in accounts) {
      syncAccount(accountId)
    }
  })
})

const onchange = async (localId, details) => {
  const allAccounts = await Account.getAllAccounts()

  // Check which accounts contain the bookmark and which used to contain (track) it
  var trackingAccountsFilter = await Promise.all(
    allAccounts
    .map(async account => {
      return (await account.tracksBookmark(localId))
    })
  )

  const accountsToSync = allAccounts
  // Filter out any accounts that are not tracking the bookmark
  .filter((account, i) => (trackingAccountsFilter[i]))
  // Filter out any accounts that are presently syncing
  .filter(account => !syncing[account.id])

  // We should now sync all accounts that are involved in this change (2 at max)
  accountsToSync.forEach((account) => {
    syncAccount(account.id)
  })

  var ancestors
  try {
    ancestors = await Tree.getIdPathFromLocalId(localId)
  }catch(e) {
    return
  }

  const containingAccount = await Account.getAccountContainingLocalId(localId, ancestors, allAccounts)
  if (containingAccount && !syncing[containingAccount.id] && !accountsToSync.some(acc => acc.id === containingAccount.id)) {
    syncAccount(containingAccount.id)
  }
}
browser.bookmarks.onChanged.addListener(onchange)
browser.bookmarks.onMoved.addListener(onchange)
browser.bookmarks.onRemoved.addListener(onchange)
browser.bookmarks.onCreated.addListener(onchange)

var syncing = {}
  , next = {}
window.syncAccount = function(accountId) {
  if (syncing[accountId]) {
    next[accountId] = () => {
      delete next[accountId]
      return syncAccount(accountId)
    }
    return Promise.resolve()
  }
  syncing[accountId] = true
  return Account.get(accountId)
  .then((account) => {
    return account.sync()
  })
  .then(() => {delete syncing[accountId]})
  .catch((error) => {
    delete syncing[accountId]
    console.error(error)
  })
  .then(() => next[accountId] && next[accountId]())
}
