(function(browser) {
var bookmarks = client(browser);

// FIRST RUN
// Set up some things on first run
browser.storage.local.get('notFirstRun')
.then(d => {
  if (d.notFirstRun) return

  // Create Owncloud bookmarks folder and mappings
  bookmarks.init()

  browser.storage.local.set({
    'owncloud': {
      url: 'https://yourowncloud'
    , username: 'your username'
    , password: 'shhh!'
    }
  , notFirstRun: true
  })

  browser.runtime.openOptionsPage()
})

// sync regularly
browser.alarms.create('sync', {periodInMinutes: 25})
browser.alarms.onAlarm.addListener(alarm => {
  bookmarks.sync()
  .catch(err => console.warn(err))
})


})((function(){
  if ('undefined' === typeof browser && 'undefined' !== typeof chrome) {
    var b = new ChromePromise()
    b.alarms = chrome.alarms // Don't promisify alarms -- don't make sense, yo!
    return b
  }else{
    return browser
  }
})())
