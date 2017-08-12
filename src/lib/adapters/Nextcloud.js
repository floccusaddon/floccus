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
    this.server.url = this.normalizeServerURL(server.url)
  }

  renderOptions(ctl) {
    let data = this.getData()
    let onchangeURL = (e) => ctl.update({...data, url: e.target.value})
    let onchangeUsername = (e) => ctl.update({...data, username: e.target.value})
    let onchangePassword = (e) => ctl.update({...data, password: e.target.value})
    return <div className="account">
      <form>
      <table>
      <tr>
        <td><label for="url">Nextcloud server URL:</label></td>
        <td><input value={data.url} type="text" className="url" name="url" ev-keyup={onchangeURL} ev-blur={onchangeURL}/></td>
      </tr>
      <tr>
        <td><label for="username">User name:</label></td>
        <td><input value={data.username} type="text" className="username" name="password" ev-keyup={onchangeUsername} ev-blur={onchangeUsername}/></td>
      </tr>
      <tr>
        <td><label for="password">Password:</label></td>
        <td><input value={data.password} type="password" className="password" name="password" ev-keydown={onchangePassword} ev-blur={onchangePassword}/></td></tr>
      <tr><td></td><td>
        <a href="#" className="remove" ev-click={() => ctl.delete()}>Delete</a>
        <a href="#" className="forceSync" ev-click={() => ctl.sync()}>force Sync</a>
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
    return serverURL.protocol + '//' + serverURL.host + serverURL.pathname.substr(0, ~indexLoc? indexLoc : null)
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

  createBookmark(node) {
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
