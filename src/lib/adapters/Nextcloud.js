/* @jsx el */
// Nextcloud ADAPTER
// All owncloud specifc stuff goes in here
import Bookmark from '../Bookmark'
const {h} = require('virtual-dom')

function el(el, props, ...children) {
return h(el, props, children);
};

const url = require('url')

export default class NextcloudAdapter {

  constructor(server) {
    this.server = server
  }

  renderOptions(ctl) {
    let data = this.getData()
    let onchangeURL = (e) => {
      ctl.update({...data, url: e.target.value})
    }
    let onchangeUsername = (e) => {
      ctl.update({...data, username: e.target.value})
    }
    let onchangePassword = (e) => {
      ctl.update({...data, password: e.target.value})
    }
    return <div className="account">
      <form>
      <table>
      <tr>
        <td><label for="url">Nextcloud server URL:</label></td>
        <td><input value={new InputInitializeHook(data.url)} type="text" className="url" name="url" ev-keyup={onchangeURL} ev-blur={onchangeURL}/></td>
      </tr>
      <tr>
        <td><label for="username">User name:</label></td>
        <td><input value={new InputInitializeHook(data.username)} type="text" className="username" name="password" ev-keyup={onchangeUsername} ev-blur={onchangeUsername}/></td>
      </tr>
      <tr>
        <td><label for="password">Password:</label></td>
        <td><input value={new InputInitializeHook(data.password)} type="password" className="password" name="password" ev-keydown={onchangePassword} ev-blur={onchangePassword}/></td></tr>
      <tr><td></td><td>
        <span className="status">{
          data.syncing === true?
            '↻ Syncing...' :
            (data.error?
              <span title={data.error}>✘ Error!</span> :
                '✓ all good'
            )
        }</span>
        <a href="#" className="btn remove" ev-click={() => ctl.delete()}>Delete</a>
        <a href="#" className={'btn forceSync '+(data.syncing? 'disabled' : '')} ev-click={() => !data.syncing && ctl.sync()}>force Sync</a>
      </td></tr>
      </table>
      </form>
    </div>
  }

  getData() {
    return JSON.parse(JSON.stringify(this.server))
  }
  
  getLabel() {
    let data = this.getData()
    return data.username + '@' + data.url
  }

  normalizeServerURL(input) {
    let serverURL = url.parse(input)
    let indexLoc = serverURL.pathname.indexOf('index.php')
    return url.format({
      protocol: serverURL.protocol
    , auth: serverURL.auth
    , host: serverURL.host
    , port: serverURL.port
    , pathname: serverURL.pathname.substr(0, ~indexLoc? indexLoc : undefined)
                + (!~indexLoc && serverURL.pathname[serverURL.pathname.length-1] !== '/'? '/' : '')
    })
  }

  async pullBookmarks() {
    console.log('Fetching bookmarks', this.server)
    let response = await fetch(this.normalizeServerURL(this.server.url) + "index.php/apps/bookmarks/public/rest/v2/bookmark?page=-1"
    , {
      headers: {
        Authorization: 'Basic '+btoa(this.server.username+':'+this.server.password)
      }
    }
    )
    
    if (response.status !== 200) throw new Error('Failed to retrieve bookmarks from ownCloud')
    
    let json = await response.json()
    
    if ('success' !== json.status) throw new Error('Fetch failed:'+JSON.stringify(json))
   
   // for every bm without a path tag, add one
    let bmsWithoutPath = json.data
    .filter(bm => bm.tags.every(tag => tag.indexOf('__floccus-path:') != 0))
    
    for (var i=0; i < bmsWithoutPath.length; i++) {
      let bm = bmsWithoutPath[i]
      try {
        await this.updateBookmark(bm.id, {
          ...bm
        , path: '/'
        })
      }catch(e) {
        console.log(e)
      }
    }

    let bookmarks = json.data
    .map(bm => {
      return new Bookmark(bm.id, null, bm.url, bm.title, NextcloudAdapter.getPathFromServerMark(bm))
      // tags: bm.tags.filter(tag => tag.indexOf('__floccus-path:') != 0)
    })

    console.log(bookmarks)
    return bookmarks
  }
  
  async getBookmark(id, autoupdate) {
    console.log('Fetching single bookmark', this.server)
    let response = await fetch(this.normalizeServerURL(this.server.url) + "index.php/apps/bookmarks/public/rest/v2/bookmark/"+id
    , {
      headers: {
        Authorization: 'Basic '+btoa(this.server.username+':'+this.server.password)
      }
    }
    )
    
    if (response.status !== 200) throw new Error('Failed to retrieve bookmark from ownCloud')
    
    let json = await response.json()
    
    if ('success' !== json.status) throw new Error('Fetch failed:'+JSON.stringify(json))
   
    // for every bm without a path tag, add one
    let bm = json.item
    if (autoupdate && bm.tags.every(tag => tag.indexOf('__floccus-path:') != 0)) {
      await this.updateBookmark(bm.id, {
        ...bm
      , tags: bm.tags.filter(tag => tag.indexOf('__floccus-path:') != 0)
      , path: '/'
      })
    }
    
    let bookmark = new Bookmark(bm.id, null, bm.url, bm.title, NextcloudAdapter.getPathFromServerMark(bm))
    bookmark.tags = bm.tags
    return bookmark  
  }

  createBookmark(bm) {
    return Promise.resolve()
    .then(d => {
      var body = new FormData()
      body.append('url', bm.url)
      body.append('title', bm.title)
      body.append('item[tags][]', '__floccus-path:'+bm.path)
      return fetch(this.normalizeServerURL(this.server.url)+'index.php/apps/bookmarks/public/rest/v2/bookmark', {
        method: 'POST'
      , body
      , headers: {
          Authorization: 'Basic '+btoa(this.server.username+':'+this.server.password)
        }
      })
    })
    .then(res => {
      console.log(res)
      if (res.status !== 200) return Promise.reject(new Error('Signing into owncloud for creating a bookmark failed'))
      return res.json()
    })
    .then((json) => {
      if (json.status != 'success') return Promise.reject(new Error('nextcloud API returned error'))
      bm.id = json.item.id
      return Promise.resolve(bm)
    })
    .catch((er) => console.log(er))
  }
  
  async updateBookmark(remoteId, newBm) {
    let bm = await this.getBookmark(remoteId, false)

    let body = new URLSearchParams()
    body.append('url', newBm.url)
    body.append('title', newBm.title)
    bm.tags
    .filter(tag => tag.indexOf('__floccus-path:') != 0)
    .concat(newBm.tags || [])
    .concat(['__floccus-path:'+newBm.path])
    .forEach((tag) => body.append('item[tags][]', tag))
    
    let putRes = await fetch(this.normalizeServerURL(this.server.url)+'index.php/apps/bookmarks/public/rest/v2/bookmark/'+remoteId, {
      method: 'PUT'
    , body
    , headers: {
        Authorization: 'Basic '+btoa(this.server.username+':'+this.server.password)
      }
    })
    console.log(putRes)
    if (putRes.status !== 200) return Promise.reject(new Error('Signing into owncloud for updating a bookmark failed'))
    let putJson = await putRes.json()
    if (putJson.status != 'success') return Promise.reject(new Error('nextcloud API returned error'))
    return new Bookmark(remoteId, null, putJson.item.url, putJson.item.title, NextcloudAdapter.getPathFromServerMark(putJson.item))
  }

  removeBookmark(remoteId) {
    return Promise.resolve()
    .then(d => {
      return fetch(this.normalizeServerURL(this.server.url)+'index.php/apps/bookmarks/public/rest/v2/bookmark/'+remoteId, {
        method: 'DELETE'
      , headers: {
          Authorization: 'Basic '+btoa(this.server.username+':'+this.server.password)
        }
      })
    })
    .then(res => {
      console.log(res)
      if (res.status !== 200) return Promise.reject(new Error('Signing into owncloud for removing a bookmark failed'))
      return Promise.resolve()
    })
    .catch((er) => console.log(er))
  }
  
  static getPathFromServerMark(bm) {
    return !bm.tags? null
      : bm.tags
        .filter(tag => tag.indexOf('__floccus-path:') == 0)
        .concat(['__floccus-path:/']) // default
        [0]
        .substr('__floccus-path:'.length)
  }
}

class InputInitializeHook {
  constructor(initStr){this.initStr = initStr}
  hook(node, propertyName, previousValue) { 
    if ('undefined' != typeof previousValue) return
    node[propertyName] = this.initStr
  }
}
