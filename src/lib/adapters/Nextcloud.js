/* @jsx el */
// Nextcloud ADAPTER
// All owncloud specifc stuff goes in here
import Bookmark from '../Bookmark'
import humanizeDuration from 'humanize-duration'
const {h} = require('virtual-dom')

function el(el, props, ...children) {
return h(el, props, children);
};

const url = require('url')

const TAG_PREFIX = 'floccus:'

export default class NextcloudAdapter {

  constructor(server) {
    this.server = server
  }

  renderOptions(ctl, rootPath) {
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
              <span title={'Last synchronized: ' + (data.lastSync? humanizeDuration(Date.now() - data.lastSync, {largest: 1, round: true}) + ' ago' : 'never')}>✓ all good</span>
            )
        }</span>
        <a href="#" className="btn openOptions" ev-click={(e) => {
          var options = e.target.nextSibling.nextSibling
          if (options.classList.contains('open')) {
            e.target.classList.remove('active')
            options.classList.remove('open')
          }else if(!data.syncing) {
            e.target.classList.add('active')
            options.classList.add('open')
          }
        }}>Options</a>
        <a href="#" className={'btn forceSync '+(data.syncing? 'disabled' : '')} ev-click={() => !data.syncing && ctl.sync()}>Sync now</a>
        <div className="options">
          <formgroup>
            <h4>Sync folder</h4>
            <input type="text" disabled value={rootPath} /><br/>
            <a href="" title="Reset synchronized folder to create a new one" className={'btn resetRoot '+(data.syncing? 'disabled' : '')} ev-click={() => {
              !data.syncing && ctl.update({...data, localRoot: null})
            }}>Reset</a>
            <a href="#" title="Set an existing folder to sync" className={'btn chooseRoot '+(data.syncing? 'disabled' : '')} ev-click={(e) => {
              ctl.pickFolder()
            }}>Choose folder</a>
          </formgroup>
          <formgroup>
            <h4>Remove account</h4>
            <a href="#" className="btn remove" ev-click={() => ctl.delete()}>Delete this account</a>
          </formgroup>
        </div>
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
    const getUrl = this.normalizeServerURL(this.server.url) + "index.php/apps/bookmarks/public/rest/v2/bookmark?page=-1"
    let response = await fetch(getUrl, {
      headers: {
        Authorization: 'Basic '+btoa(this.server.username+':'+this.server.password)
      }
    })
    
    if (response.status !== 200) {
      throw new Error('Failed to retrieve bookmarks from ownCloud')
    }

    let json = await response.json()
    if ('success' !== json.status) {
      throw new Error('Fetch failed:'+JSON.stringify(json))
   }

    // for every bm without a path tag, add one
    let bmsWithoutPath = json.data
    .filter(bm => bm.tags.every(tag => tag.indexOf(TAG_PREFIX) != 0))
    
    for (var i=0; i < bmsWithoutPath.length; i++) {
      let bm = bmsWithoutPath[i]
      try {
        await this.updateBookmark(bm.id, {
          ...bm
        , path: NextcloudAdapter.getPathFromServerMark(bm)
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

    console.log('Received bookmarks from server', bookmarks)
    return bookmarks
  }
  
  async getBookmark(id, autoupdate) {
    console.log('Fetching single bookmark', this.server)
    const getUrl = this.normalizeServerURL(this.server.url) + "index.php/apps/bookmarks/public/rest/v2/bookmark/"+id
    let response = await fetch(getUrl, {
      headers: {
        Authorization: 'Basic '+btoa(this.server.username+':'+this.server.password)
      }
    })
    
    if (response.status !== 200) {
      throw new Error('Failed to retrieve bookmark from ownCloud')
    }

    let json = await response.json()
    if ('success' !== json.status) {
      throw new Error('Fetch failed:'+JSON.stringify(json))
    }

    // for every bm without a path tag, add one
    let bm = json.item
    if (autoupdate && bm.tags.every(tag => tag.indexOf(TAG_PREFIX) != 0)) {
      await this.updateBookmark(bm.id, {
        ...bm
        , path: NextcloudAdapter.getPathFromServerMark(bm)
      })
    }
    
    let bookmark = new Bookmark(bm.id, null, bm.url, bm.title, NextcloudAdapter.getPathFromServerMark(bm))
    bookmark.tags = NextcloudAdapter.filterPathTagFromTags(bm.tags)
    return bookmark  
  }

  async createBookmark(bm) {
    let body = new FormData()
    body.append('url', bm.url)
    body.append('title', bm.title)
    body.append('item[tags][]', NextcloudAdapter.convertPathToTag(bm.path))
    const createUrl = this.normalizeServerURL(this.server.url)+'index.php/apps/bookmarks/public/rest/v2/bookmark'
    const res = await fetch(createUrl, {
      method: 'POST'
    , body
    , headers: {
        Authorization: 'Basic '+btoa(this.server.username+':'+this.server.password)
      }
    })
      
    console.log(res)
    
    if (res.status !== 200) {
      throw new Error('Signing into owncloud for creating a bookmark failed')
    }
    const json = await res.json()
    if (json.status != 'success') {
      throw new Error('nextcloud API returned error')
    }
    bm.id = json.item.id
    return bm
  }
  
  async updateBookmark(remoteId, newBm) {
    let bm = await this.getBookmark(remoteId, false)

    let body = new URLSearchParams()
    body.append('url', newBm.url)
    body.append('title', newBm.title)

    bm.tags
    .concat(NextcloudAdapter.filterPathTagFromTags(newBm.tags))
    .concat([NextcloudAdapter.convertPathToTag(newBm.path)])
    .forEach((tag) => body.append('item[tags][]', tag))
    
    let updateUrl = this.normalizeServerURL(this.server.url)+'index.php/apps/bookmarks/public/rest/v2/bookmark/'+remoteId
    let putRes = await fetch(updateUrl, {
      method: 'PUT'
    , body
    , headers: {
        Authorization: 'Basic '+btoa(this.server.username+':'+this.server.password)
      }
    })

    console.log(putRes)
    
    if (putRes.status !== 200) {
      throw new Error('Signing into owncloud for updating a bookmark failed')
    }
    
    let putJson = await putRes.json()
    if (putJson.status != 'success') {
      throw new Error('nextcloud API returned error')
    }
    
    return new Bookmark(remoteId, null, putJson.item.url, putJson.item.title, NextcloudAdapter.getPathFromServerMark(putJson.item))
  }

  async removeBookmark(remoteId) {
    const delUrl = this.normalizeServerURL(this.server.url)+'index.php/apps/bookmarks/public/rest/v2/bookmark/'+remoteId
    let res = await fetch(delUrl, {
      method: 'DELETE'
    , headers: {
        Authorization: 'Basic '+btoa(this.server.username+':'+this.server.password)
      }
    })

    console.log(res)
    
    if (res.status !== 200) {
      throw new Error('Signing into owncloud for removing a bookmark failed')
    }
  }
  
  static getPathFromServerMark(bm) {
    return this.convertTagToPath(this.getPathTagFromTags(bm.tags))
  }

  static filterPathTagFromTags(tags) {
    return ( tags || [] )
        .filter(tag => (tag.indexOf(TAG_PREFIX) != 0 && tag.indexOf('__floccus-path:') != 0)) // __floccus-path: is depecrated, but we still remove it from the filters here, so it's automatically removed
  }

  static getPathTagFromTags(tags) {
    return ( tags || [] )
        .filter(tag => (tag.indexOf(TAG_PREFIX) == 0 || tag.indexOf('__floccus-path:') == 0))
        .concat([this.convertPathToTag('/')]) // default
        [0]
  }

  static convertPathToTag(path) {
    return TAG_PREFIX + path.split('/').join('>')
  }
  
  static convertTagToPath(tag) {
    const old_prefix = '__floccus-path:'
    return tag.indexOf(old_prefix) === 0? tag.substr(old_prefix.length)
          : tag.substr(TAG_PREFIX.length)
              .split('>')
              .join('/')
  }
}

class InputInitializeHook {
  constructor(initStr){this.initStr = initStr}
  hook(node, propertyName, previousValue) { 
    if ('undefined' != typeof previousValue) return
    node[propertyName] = this.initStr
  }
}
