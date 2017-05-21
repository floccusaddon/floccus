import browser from '../lib/browser-api'
import Account from '../lib/Account'
import NextcloudAdapter from '../lib/adapter-nextcloud'

// FIRST RUN
// Set up some things on first run

browser.storage.local.get('notFirstRun')
.then(d => { 
  if (d.notFirstRun) return
  browser.storage.local.set({notFirstRun: true})
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
      var account = new Account(accountId, new NextcloudAdapter(accounts[accountId]))
      account.sync()
      .catch(err => console.warn(err))
    }
  })
})
