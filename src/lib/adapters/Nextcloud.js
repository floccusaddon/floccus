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

  pullBookmarks() {
    return Promise.resolve()
    .then(d => {
      console.log('Fetching bookmarks', this.server)
      return fetch(this.normalizeServerURL(this.server.url) + "index.php/apps/bookmarks/public/rest/v2/bookmark?page=-1"
      , {
        headers: {
          Authorization: 'Basic '+btoa(this.server.username+':'+this.server.password)
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

  createBookmark(node) {
    return Promise.resolve()
    .then(d => {
      var body = new FormData()
      body.append('url', node.url)
      body.append('title', node.title)
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
}

class InputInitializeHook {
  constructor(initStr){this.initStr = initStr}
  hook(node, propertyName, previousValue) { 
    if ('undefined' != typeof previousValue) return
    node[propertyName] = this.initStr
  }
}
