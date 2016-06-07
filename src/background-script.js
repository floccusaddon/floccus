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
      return fetch(server.url + "/index.php/apps/bookmarks/public/rest/v1/bookmark"
      + "?user=" + encodeURIComponent(server.username)
      + "&password=" + encodeURIComponent(server.password)
      )
    })
    .then(response => {
      if (response.status !== 200) return Promise.reject(new Error('Failed to retrieve bookmarks from ownCloud'))
      else return response.json()
    })
  }
, createBookmark(node) {
    // This is a hack. Until the following issue is resolved:
    // https://github.com/owncloud/bookmarks/pull/218
    var owncloud
    return browser.storage.local.get('owncloud')
    // 1. Get ourselves a CSRF token
    .then(d => {
      owncloud = d.owncloud
      return fetch(owncloud.url+'/index.php/apps/bookmarks/bookmarklet?output=popup&url='+encodeURIComponent(node.url)+'&title=', {
        credentials: 'include'
      , headers: {
          Authorization: 'basic '+btoa(owncloud.username+':'+owncloud.password)
        }
      })
    })
    .then(res => {
      if (res.status !== 200) return Promise.reject(new Error('Signing into owncloud for creating a bookmark failed'))
      return res.text()
    })
    .then(src => {
      var parser = new DOMParser()
        , doc = parser.parseFromString(src, "text/html")
      return Promise.resolve(doc.head.dataset.requesttoken)
    })
    // 2. Now create the bookmark
    .then(token => {
      var body = new FormData()
      body.append('url', node.url)
      body.append('title', node.title)
      return fetch(owncloud.url+'/index.php/apps/bookmarks/bookmark', {
        method: 'POST'
      , body
      , credentials: 'include' // Send cookies!
      , headers: {
          Authorization: 'basic '+btoa(owncloud.username+':'+owncloud.password)
        , requesttoken: token
        }
      })
    })
    .then(res => {
      console.log(res)
      if (res.status !== 200) return Promise.reject(new Error('Signing into owncloud for creating a bookmark failed'))
      return Promise.resolve()
    })
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
    return Promise.resolve()
    .then(() => browser.storage.local.get(['bookmarks.localRoot', 'bookmarks.mappings']))
    .then(d => {
      mappings = d['bookmarks.mappings']
      localRoot = d['bookmarks.localRoot']
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
        return Promise.all(
          bookmarks
          .filter(bookmark => !!bookmark.NOTFOUND)
          .map(bookmark => {
            var localId = bookmark.NOTFOUND
            console.log('SERVERDELETE', localId, mappings.IdToURL[localId])
            return bookmarks.adapter.removeBookmark(localId)
            .then(() => {
              delete mappings.URLToId[mappings.IdToURL[localId]]
              delete mappings.IdToURL[localId]
              return Promise.resolve()
            }, (e)=> console.warn)
          })
        )
      })
    })
    .then(() => bookmarks.adapter.pullBookmarks())
    .then(json => { 
      // Update known ones and create new ones
      return Promise.all(
        json.map(obj => {
          var localId
          if (localId = mappings.URLToId[obj.url]) {
            // known to mappings: UPDATE
            received[localId] = true
            console.log('UPDATE', localId, obj)
            return browser.bookmarks.update(localId, obj)
          }else{
            // Not yet known: CREATE
            return browser.bookmarks.create({parentId: localRoot, title: obj.title, url: obj.url})
            .then(bookmark => {
              console.log('CREATE', bookmark.id, obj)
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
      return Promise.all(
        Object.keys(mappings.IdToURL).map(localId => {
          if (!received[localId]) {
            // If a bookmark was deleted on the server, we delete it as well
            console.log('DELETE', localId, mappings.IdToURL[localId])
            return browser.bookmarks.remove(localId)
            .then(() => {
              delete mappings.URLToId[mappings.IdToURL[localId]]
              delete mappings.IdToURL[localId]
              return Promise.resolve()
            })
          }
        })
      )
    })
    .then(() => {
      // In the tree yet not in the mappings: SERVERCREATE
      return browser.bookmarks.getChildren(localRoot)
      .then(children => {
        return Promise.all(
          children
          .filter(bookmark => !mappings.IdToURL[bookmark.id])
          .map(bookmark => {
            console.log('SERVERCREATE', bookmark.id, bookmark.url)
            return bookmarks.adapter.createBookmark(bookmark)
            .then(()=> {
              mappings.IdToURL[bookmark.id] = bookmark.url
              mappings.URLToId[bookmark.url] = bookmark.id
              return Promise.resolve()
            }, (e) => console.warn)
          })
        )
      })
    })
    .then(() => {
      return browser.storage.local.set({'bookmarks.mappings': mappings})
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
