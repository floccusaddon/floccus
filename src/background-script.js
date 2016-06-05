(function(browser) {

adapters = {}

// OWNCLOUD ADAPTER
// All owncloud specifc stuff goes in here

adapters.owncloud = {
  pullBookmarks() {
    return browser.storage.local.get('owncloud')
    .then(d => {
      var server = d.owncloud
      console.log('Fetching bookmarks', server)
      return fetch(server.url + "/index.php/apps/bookmarks/public/rest/v1/bookmark?user="
      + encodeURI(server.username)
      + "&password=" + encodeURI(server.password)
      )
    })
    .then(response => {
      if (response.status !== 200) return Promise.reject(new Error('Failed to retrieve bookmarks from ownCloud'))
      else return response.json()
    })
  }
, createBookmark(node) {
    return Promise.resolve()
  }
, removeBookmark(localId) {
    return Promise.resolve()
  }
}

// FIRST RUN
// Set up some things on first run

browser.storage.local.get('notFirstRun')
.then(d => { 
  if (d.notFirstRun) return
  
  // Create Owncloud bookmarks folder
  browser.bookmarks.getTree()
  .then(parentNode => browser.bookmarks.create({title: 'Owncloud', parentId: parentNode.id}))
  .then(bookmark => browser.storage.local.set({'bookmarks.localRoot': bookmark.id}))
  .catch(err => console.warn)

  browser.storage.local.set({
    'owncloud': {
      url: 'https://yourowncloud'
    , username: 'your username'
    , password: 'shhh!'
    }
  , 'bookmarks.lastState': {
      lastChanged: 0
    , lastSerialized: ''
    }
  , 'bookmarks.mappings': {
      URLToId: {}
    , IdToURL: {}
    }
  , notFirstRun: true
  })
  
  browser.runtime.openOptionsPage()
})

// sync regularly
browser.alarms.create('sync', {periodInMinutes: .5})
browser.alarms.onAlarm.addListener(alarm => {
  bookmarks.sync()
  .catch(err => console.warn(err))
})

const bookmarks = {
  adapter: adapters.owncloud
, sync() {
    var mappings 
      , localRoot
      , received = {}
    return Promise.all([
      bookmarks.adapter.pullBookmarks()
    , browser.storage.local.get(['bookmarks.localRoot', 'bookmarks.mappings'])
    ])
    .then(([json, d]) => {
      mappings = d['bookmarks.mappings']
      localRoot = d['bookmarks.localRoot']
      
      // Update known ones and create new ones
      return Promise.all(
        json.map(obj => {
          var localId
          if (localId = mappings.URLToId[obj.url]) {
            // known to mappings: UPDATE
            received[localId] = true
            return browser.bookmarks.update(localId, obj)
          }else{
            // Not yet known: CREATE
            return browser.bookmarks.create({parentId: localRoot, title: obj.title, url: obj.url})
            .then(bookmark => {
              received[bookmark.id] = true
              mappings.URLToId[obj.url] = bookmark.id
              mappings.IdToURL[bookmark.id] = obj.url
            })
          }
        })
      )
    })
    .then(() => {
      // removed on the server: DELETE
      var removals = []
      for (var localId in mappings.IdToURL) {
        if (!received[localId]) {
          // If a bookmark was deleted on the server, we delete it as well
          removals.push(browser.bookmarks.remove(localId))
          delete mappings.URLToId[mappings.IdToURL[localId]]
          delete mappings.IdToURL[localId]
        }
      }

      return Promise.all([
        browser.storage.local.set({'bookmarks.mappings': mappings})
      , Promise.all(removals)
      ])
    })
    .then(() => {
      // In the mappings but not in the tree: SERVERDELETE
      return Promise.all(
        Object.keys(mappings.IdToURL).map(localId => {
          return browser.bookmarks.get(localId)
          .then(node => node, er => {NOTFOUND: localId})
        })
      )
      .then(bookmarks => {
        return bookmarks
        .filter(bookmark => !!bookmark.NOTFOUND)
        .map(bookmark => bookmarks.adapter.removeBookmark(bookmark.NOTFOUND))
      })
    })
    .then(() => {
      // In the tree yet not in the mappings: SERVERCREATE
      return browser.bookmarks.getChildren(localRoot)
      .then(children => {
        return Promise.all(
          children
          .filter(bookmark => !!mappings.IdToURL[bookmark.id])
          .map(bookmark => bookmarks.adapter.createBookmark(bookmark))
        )
      })
    })
  }
}

})((function(){
  if ('undefined' === typeof browser && 'undefined' !== typeof chrome) {
    var b = new ChromePromise()
    b.alarms = chrome.alarms // Don't promisify alarms -- don't make sense, yo!
    return b
  }else{
    return browser
  }
})())
