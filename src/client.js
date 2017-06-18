function client(browser) {

adapters = {}

// OWNCLOUD ADAPTER
// All owncloud specifc stuff goes in here

adapters.owncloud = {
  pullBookmarks() {
    return browser.storage.local.get('owncloud')
    .then(d => {
      var server = d.owncloud
      console.log('Fetching bookmarks', server)
      return fetch(server.url + "/index.php/apps/bookmarks/public/rest/v2/bookmark?page=-1"
      , {
        headers: {
          Authorization: 'basic '+btoa(server.username+':'+server.password)
        }
      }
      )
    })
    .then(response => {
      if (response.status !== 200) return Promise.reject(new Error('Failed to retrieve bookmarks from ownCloud'))
      else return response.json()
    })
    .then((json) => {
      if ('success' !== json.status) return Promise.reject(json.data)
      console.log(json)
      return json.data
    })
  }
, createBookmark(node) {
    return browser.storage.local.get('owncloud')
    .then(d => {
      var server = d.owncloud
      var body = new FormData()
      body.append('url', node.url)
      body.append('title', node.title)
      return fetch(server.url+'/index.php/apps/bookmarks/public/rest/v2/bookmark', {
        method: 'POST'
      , body
      , headers: {
          Authorization: 'basic '+btoa(server.username+':'+server.password)
        }
      })
    })
    .then(res => {
      console.log(res)
      if (res.status !== 200) return Promise.reject(new Error('Signing into owncloud for creating a bookmark failed'))
      return Promise.resolve()
    })
    .catch((er) => console.log(er))
  }
, removeBookmark(remoteId) {
    return browser.storage.local.get('owncloud')
    .then(d => {
      var server = d.owncloud
      return fetch(server.url+'/index.php/apps/bookmarks/public/rest/v2/bookmark/'+remoteId, {
        method: 'DELETE'
      , headers: {
          Authorization: 'basic '+btoa(server.username+':'+server.password)
        }
      })
    })
    .then(res => {
      console.log(res)
      if (res.status !== 200) return Promise.reject(new Error('Signing into owncloud for creating a bookmark failed'))
      return Promise.resolve()
    })
    .catch((er) => console.log(er))
  }
}


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
    .then(() => browser.bookmarks.get(localRoot))
    .then(
      () => {}
    , (er) => bookmarks.init()
    )
    .then(() => {
      // In the mappings but not in the tree: SERVERDELETE
      return Promise.all(
        Object.keys(mappings.LocalToServer).map(localId => {
          return browser.bookmarks.get(localId)
          .then(node => node, er => {
            console.log('SERVERDELETE', localId, mappings.LocalToServer[localId])
            return bookmarks.adapter.removeBookmark(mappings.LocalToServer[localId])
            .then(() => {
              delete mappings.ServerToLocal[mappings.LocalToServer[localId]]
              delete mappings.LocalToServer[localId]
              return Promise.resolve()
            }, (e) => console.warn(e)) 
          })
        })
      )
    })
    .then(() => bookmarks.adapter.pullBookmarks())
    .then(json => { 
      // Update known ones and create new ones
      return Promise.all(
        json.map(obj => {
          var localId
          if (localId = mappings.ServerToLocal[obj.id]) {
            // known to mappings: UPDATE
            received[localId] = true
            console.log('UPDATE', localId, obj)
            // XXX: Check lastmodified
            return browser.bookmarks.update(localId, {
              title: obj.title
            , url: obj.url
            })
          }else{
            // Not yet known: CREATE
            return browser.bookmarks.create({parentId: localRoot, title: obj.title, url: obj.url})
            .then(bookmark => {
              console.log('CREATE', bookmark.id, obj)
              received[bookmark.id] = true
              mappings.ServerToLocal[obj.id] = bookmark.id
              mappings.LocalToServer[bookmark.id] = obj.id
            })
          }
        })
      )
    })
    .then(() => {
      // removed on the server: DELETE
      return Promise.all(
        Object.keys(mappings.LocalToServer).map(localId => {
          if (!received[localId]) {
            // If a bookmark was deleted on the server, we delete it as well
            console.log('DELETE', localId, mappings.LocalToServer[localId])
            return browser.bookmarks.remove(localId)
            .then(() => {
              delete mappings.ServerToLocal[mappings.LocalToServer[localId]]
              delete mappings.LocalToServer[localId]
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
          .filter(bookmark => !mappings.LocalToServer[bookmark.id])
          .map(bookmark => {
            console.log('SERVERCREATE', bookmark.id, bookmark.url)
            return bookmarks.adapter.createBookmark(bookmark)
            .then(()=> {
              mappings.LocalToServer[bookmark.id] = bookmark.url
              mappings.ServerToLocal[bookmark.url] = bookmark.id
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
, init() {
    return browser.bookmarks.getTree()
    .then(parentNode => browser.bookmarks.create({title: 'Owncloud', parentId: parentNode.id}))
    .then(bookmark => browser.storage.local.set({'bookmarks.localRoot': bookmark.id}))
    .then(() => browser.storage.local.set({
      'bookmarks.mappings': {
        ServerToLocal: {}
      , LocalToServer: {}
      }
    }))
    .catch(err => console.warn)
  }
}

return bookmarks;

}