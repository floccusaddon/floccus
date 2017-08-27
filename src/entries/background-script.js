import browser from '../lib/browser-api'
import Account from '../lib/Account'
import NextcloudAdapter from '../lib/adapters/Nextcloud'

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
      .catch(err => console.warn(err))
    }
  })
})

const onchange = (localId, details) => {
  browser.storage.local.get('accounts')
  .then((d) => {
    var accounts = d['accounts']
    Object.keys(accounts).forEach(accountId => {
      Account.get(accountId)
      .then((account) => {
        return Promise.all([
          account.hasBookmark(localId),
          account.getLocalRoot()
        ])
      })
      .then(data => {
        let [hasBookmark, localRoot] = data
        if (!syncing[accountId] && (hasBookmark || details.parentId === localRoot)) syncAccount(accountId)
      })
    })
  }) 
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
      syncAccount(accountId)
    }
    return
  }
  syncing[accountId] = true
  Account.get(accountId)
  .then((account) => {
    return account.sync()
  })
  .then(() => {delete syncing[accountId]})
  .catch((er) => {
    delete syncing[accountId]
    console.error(er)
  })
  .then(() => next[accountId] && next[accountId]())
}
