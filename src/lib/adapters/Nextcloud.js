/* @jsx el */
// Nextcloud ADAPTER
// All owncloud specifc stuff goes in here

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
      ctl.update({...data, url: e.target.value, valid: null})
    }
    let onchangeUsername = (e) => {
      ctl.update({...data, username: e.target.value, valid: null})
    }
    let onchangePassword = (e) => {
      ctl.update({...data, password: e.target.value, valid: null})
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
              (data.valid == true?
                '✓ connected' :
                (data.valid == false?
                  '✘ couldn\'t connect' :
                  '… checking'
                )
              )
            )
        }</span>
        <a href="#" className="btn remove" ev-click={() => ctl.delete()}>Delete</a>
        <a href="#" className={'btn forceSync '+(data.syncing || !data.valid? 'disabled' : '')} ev-click={() => (!data.syncing && data.valid) && ctl.sync()}>force Sync</a>
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
      return {
        ...bm
      , tags: bm.tags.filter(tag => tag.indexOf('__floccus-path:') != 0)
      , path: NextcloudAdapter.getPathFromServerMark(bm)
      }
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
    
    return {
      ...bm
    , tags: bm.tags.filter(tag => tag.indexOf('__floccus-path:') != 0)
    , path: NextcloudAdapter.getPathFromServerMark(bm)
    }
  }

  createBookmark(bm) {
    return Promise.resolve()
    .then(d => {
      var body = new FormData()
      body.append('url', bm.url)
      body.append('title', bm.title)
      body.append('item[tags]i[]', '__floccus-path:'+bm.path)
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
      return Promise.resolve(json.item)
    })
    .catch((er) => console.log(er))
  }
  
  async updateBookmark(remoteId, node) {
    let bm = await this.getBookmark(remoteId, false)

    let body = new URLSearchParams()
    body.append('url', node.url)
    body.append('title', node.title)
    bm.tags
    .filter(tag => tag.indexOf('__floccus-path:') != 0)
    .concat(node.tags || [])
    .concat(['__floccus-path:'+node.path])
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
    return bm = {
      ...putJson.item
    , path: NextcloudAdapter.getPathFromServerMark(putJson.item)
    }
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
