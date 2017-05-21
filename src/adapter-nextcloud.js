// Nextcloud ADAPTER
// All owncloud specifc stuff goes in here

export default class NextcloudAdapter {

  constructor(server) {
    this.server = server
  }

  pullBookmarks() {
    return Promise.resolve()
    .then(d => {
      console.log('Fetching bookmarks', this.server)
      return fetch(this.server.url + "/index.php/apps/bookmarks/public/rest/v2/bookmark?page=-1"
      , {
        headers: {
          Authorization: 'basic '+btoa(this.server.username+':'+this.server.password)
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
    return Promise.resolve()
    .then(d => {
      var body = new FormData()
      body.append('url', node.url)
      body.append('title', node.title)
      return fetch(this.server.url+'/index.php/apps/bookmarks/public/rest/v2/bookmark', {
        method: 'POST'
      , body
      , headers: {
          Authorization: 'basic '+btoa(this.server.username+':'+this.server.password)
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
    return Promise.resolve()
    .then(d => {
      return fetch(this.server.url+'/index.php/apps/bookmarks/public/rest/v2/bookmark/'+remoteId, {
        method: 'DELETE'
      , headers: {
          Authorization: 'basic '+btoa(this.server.username+':'+this.server.password)
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
