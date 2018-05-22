// Nextcloud ADAPTER
// All owncloud specifc stuff goes in here
import InputInitializeHook from '../InputInitializeHook'
import Bookmark from '../Bookmark'
import humanizeDuration from 'humanize-duration'
const Parallel = require('async-parallel')

const {h} = require('virtual-dom')

function el (el, props, ...children) {
  return h(el, props, children)
};

const url = require('url')
const reverseStr = (str) => str.split('').reverse().join('')

const TAG_PREFIX = 'floccus:'

export default class NextcloudAdapter {
  constructor (server) {
    this.server = server
  }

  renderOptions (ctl, rootPath) {
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
    let onchangeServerRoot = (e) => {
      let val = e.target.value
      if (val[val.length - 1] === '/') {
        val = val.substr(0, val.length - 1)
        e.target.value = val
      }
      ctl.update({...data, serverRoot: e.target.value})
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
            <td><input value={new InputInitializeHook(data.username)} type="text" className="username" name="username" ev-keyup={onchangeUsername} ev-blur={onchangeUsername}/></td>
          </tr>
          <tr>
            <td><label for="password">Password:</label></td>
            <td><input value={new InputInitializeHook(data.password)} type="password" className="password" name="password" ev-keydown={onchangePassword} ev-blur={onchangePassword}/></td>
          </tr>
          <tr>
            <td><label for="serverRoot">Server path:</label></td>
            <td><input value={new InputInitializeHook(data.serverRoot || '')} type="text" className="serverRoot" name="serverRoot" placeholder="Default: root folder  Example: /my/subfolder" ev-keyup={onchangeServerRoot} ev-blur={onchangeServerRoot}/></td>
          </tr>
          <tr><td></td><td>
            <span className="status">{
              data.syncing
                ? '↻ Syncing...'
                : (data.error
                  ? <span>✘ Error!</span>
                  : <span>✓ all good</span>
                )
            }</span>
            <a href="#" className="btn openOptions" ev-click={(e) => {
              e.preventDefault()
              var options = e.target.parentNode.querySelector('.options')
              if (options.classList.contains('open')) {
                e.target.classList.remove('active')
                options.classList.remove('open')
              } else {
                e.target.classList.add('active')
                options.classList.add('open')
              }
            }}>Options</a>
            <a href="#" className={'btn forceSync ' + (data.syncing ? 'disabled' : '')} ev-click={() => !data.syncing && ctl.sync()}>Sync now</a>
            <div className="status-details">{data.error
              ? data.error
              : data.syncing === 'initial'
                ? 'Syncing from scratch. This may take a longer than usual...'
                : 'Last synchronized: ' + (data.lastSync ? humanizeDuration(Date.now() - data.lastSync, {largest: 1, round: true}) + ' ago' : 'never')}</div>
            <div className="options">
              <formgroup>
                <h4>Sync folder</h4>
                <input type="text" disabled placeholder="*Root folder*" value={rootPath} /><br/>
                <a href="" title="Reset synchronized folder to create a new one" className={'btn resetRoot ' + (data.syncing ? 'disabled' : '')} ev-click={() => {
                  !data.syncing && ctl.update({...data, localRoot: null})
                }}>Reset</a>
                <a href="#" title="Set an existing folder to sync" className={'btn chooseRoot ' + (data.syncing ? 'disabled' : '')} ev-click={(e) => {
                  e.preventDefault()
                  ctl.pickFolder()
                }}>Choose folder</a>
              </formgroup>
              <formgroup>
                <h4>Remove account</h4>
                <a href="#" className="btn remove" ev-click={(e) => {
                  e.preventDefault()
                  ctl.delete()
                }}>Delete this account</a>
              </formgroup>
            </div>
          </td></tr>
        </table>
      </form>
    </div>
  }

  setData (data) {
    this.server = data
  }

  getData () {
    return JSON.parse(JSON.stringify(this.server))
  }

  getLabel () {
    let data = this.getData()
    return data.username + '@' + data.url
  }

  normalizeServerURL (input) {
    let serverURL = url.parse(input)
    let indexLoc = serverURL.pathname.indexOf('index.php')
    return url.format({
      protocol: serverURL.protocol
      , auth: serverURL.auth
      , host: serverURL.host
      , port: serverURL.port
      , pathname: serverURL.pathname.substr(0, ~indexLoc ? indexLoc : undefined) +
                (!~indexLoc && serverURL.pathname[serverURL.pathname.length - 1] !== '/' ? '/' : '')
    })
  }

  async pullBookmarks () {
    console.log('Fetching bookmarks', this.server)
    const getUrl = this.normalizeServerURL(this.server.url) + 'index.php/apps/bookmarks/public/rest/v2/bookmark?page=-1'
    var response
    try {
      response = await fetch(getUrl, {
        headers: {
          Authorization: 'Basic ' + btoa(this.server.username + ':' + this.server.password)
        }
      })
    } catch (e) {
      throw new Error('Network error: Check your network connection and your account details')
    }

    if (response.status === 401) {
      throw new Error('Couldn\'t authenticate for removing bookmarks from the server.')
    }
    if (response.status !== 200) {
      throw new Error('Failed to retrieve bookmarks from server')
    }

    let json = await response.json()
    if (json.status !== 'success') {
      throw new Error('Fetch failed:' + JSON.stringify(json))
    }

    // for every bm without a path tag, add one
    let bmsWithoutPath = json.data
      .filter(bm => bm.tags.every(tag => tag.indexOf(TAG_PREFIX) !== 0))

    await Parallel.each(bmsWithoutPath,
      async (bm) => {
        try {
          await this.updateBookmark(bm.id, {
            ...bm
            , path: NextcloudAdapter.getPathFromServerMark(bm)
          })
        } catch (e) {
          console.log(e)
        }
      },
      /* parallel: */ 10
    )

    let bookmarks = json.data
      .map(bm => {
        return new Bookmark(bm.id, null, bm.url, bm.title, NextcloudAdapter.getPathFromServerMark(bm))
      // tags: bm.tags.filter(tag => tag.indexOf('__floccus-path:') != 0)
      })

    console.log('Received bookmarks from server', bookmarks)
    return bookmarks
  }

  async getBookmark (id, autoupdate) {
    console.log('Fetching single bookmark', this.server)
    const getUrl = this.normalizeServerURL(this.server.url) + 'index.php/apps/bookmarks/public/rest/v2/bookmark/' + id
    var response
    try {
      response = await fetch(getUrl, {
        headers: {
          Authorization: 'Basic ' + btoa(this.server.username + ':' + this.server.password)
        }
      })
    } catch (e) {
      throw new Error('Network error: Check your network connection and your account details')
    }

    if (response.status === 401) {
      throw new Error('Couldn\'t authenticate for retrieving a bookmark from the server.')
    }
    if (response.status !== 200) {
      throw new Error('Failed to retrieve bookmark from server: id=' + id)
    }

    let json = await response.json()
    if (json.status !== 'success') {
      throw new Error('Fetch failed:' + JSON.stringify(json))
    }

    // for every bm without a path tag, add one
    let bm = json.item
    if (autoupdate && bm.tags.every(tag => tag.indexOf(TAG_PREFIX) !== 0)) {
      await this.updateBookmark(bm.id, {
        ...bm
        , path: NextcloudAdapter.getPathFromServerMark(bm)
      })
    }

    let bookmark = new Bookmark(bm.id, null, bm.url, bm.title, NextcloudAdapter.getPathFromServerMark(bm))
    bookmark.tags = NextcloudAdapter.filterPathTagFromTags(bm.tags)
    return bookmark
  }

  async createBookmark (bm) {
    if (!~['https:', 'http:', 'ftp:'].indexOf(url.parse(bm.url).protocol)) {
      return false
    }
    let body = new FormData()
    body.append('url', bm.url)
    body.append('title', bm.title)
    body.append('item[tags][]', NextcloudAdapter.convertPathToTag(bm.path))
    const createUrl = this.normalizeServerURL(this.server.url) + 'index.php/apps/bookmarks/public/rest/v2/bookmark'
    var res
    try {
      res = await fetch(createUrl, {
        method: 'POST'
        , body
        , headers: {
          Authorization: 'Basic ' + btoa(this.server.username + ':' + this.server.password)
        }
      })
    } catch (e) {
      throw new Error('Network error: Check your network connection and your account details')
    }

    console.log(res)

    if (res.status === 401) {
      throw new Error('Couldn\'t authenticate for creating a bookmark on the server.')
    }
    if (res.status !== 200) {
      throw new Error('Creating a bookmark on the server failed: ' + bm.url)
    }
    const json = await res.json()
    if (json.status !== 'success') {
      throw new Error('Server API returned error')
    }
    bm.id = json.item.id
    return bm
  }

  async updateBookmark (remoteId, newBm) {
    if (!~['https:', 'http:', 'ftp:'].indexOf(url.parse(newBm.url).protocol)) {
      return false
    }

    let bm = await this.getBookmark(remoteId, false)

    let body = new URLSearchParams()
    body.append('url', newBm.url)
    body.append('title', newBm.title)

    bm.tags
      .concat(NextcloudAdapter.filterPathTagFromTags(newBm.tags))
      .concat([NextcloudAdapter.convertPathToTag(newBm.path)])
      .forEach((tag) => body.append('item[tags][]', tag))

    let updateUrl = this.normalizeServerURL(this.server.url) + 'index.php/apps/bookmarks/public/rest/v2/bookmark/' + remoteId
    var putRes
    try {
      putRes = await fetch(updateUrl, {
        method: 'PUT'
        , body
        , headers: {
          Authorization: 'Basic ' + btoa(this.server.username + ':' + this.server.password)
        }
      })
    } catch (e) {
      throw new Error('Network error: Check your network connection and your account details')
    }

    console.log(putRes)

    if (putRes.status === 401) {
      throw new Error('Couldn\'t authenticate for updating a bookmark on the server.')
    }
    if (putRes.status !== 200) {
      throw new Error('Updating a bookmark on the server failed: ' + newBm.url)
    }

    let putJson = await putRes.json()
    if (putJson.status !== 'success') {
      throw new Error('nextcloud API returned error')
    }

    return new Bookmark(remoteId, null, putJson.item.url, putJson.item.title, NextcloudAdapter.getPathFromServerMark(putJson.item))
  }

  async removeBookmark (remoteId) {
    const delUrl = this.normalizeServerURL(this.server.url) + 'index.php/apps/bookmarks/public/rest/v2/bookmark/' + remoteId
    var res
    try {
      res = await fetch(delUrl, {
        method: 'DELETE'
        , headers: {
          Authorization: 'Basic ' + btoa(this.server.username + ':' + this.server.password)
        }
      })
    } catch (e) {
      throw new Error('Network error: Check your network connection and your account details')
    }

    console.log(res)

    if (res.status === 401) {
      throw new Error('Couldn\'t authenticate for removing a bookmark on the server.')
    }
    if (res.status !== 200) {
      throw new Error('Removing a bookmark on the server failed. remoteId=' + remoteId)
    }
  }

  static getPathFromServerMark (bm) {
    return this.convertTagToPath(this.getPathTagFromTags(bm.tags))
  }

  static filterPathTagFromTags (tags) {
    return (tags || [])
      .filter(tag => tag.indexOf(TAG_PREFIX) !== 0) // __floccus-path: is depecrated, but we still remove it from the filters here, so it's automatically removed
  }

  static getPathTagFromTags (tags) {
    return (tags || [])
      .filter(tag => tag.indexOf(TAG_PREFIX) === 0)
      .concat([this.convertPathToTag('')])[0]
  }

  static convertPathToTag (path) {
    // We reverse the string and do a negative lookahead, reversing again afterwards
    return TAG_PREFIX + reverseStr(path)
      .split(/[/](?![\\])/)
      .reverse()
      .map(str => reverseStr(str).replace(/>/g, '\\>'))
      .join('>')
      .replace(/%2C/g, '%252C')
      .replace(/,/g, '%2C') // encodeURIComponent(',') == '%2C'
  }

  static convertTagToPath (tag) {
    // We reverse the string and split using a negative lookahead, reversing again afterwards
    return reverseStr(tag.substr(TAG_PREFIX.length))
      .split(/>(?![\\])/)
      .reverse()
      .map(str => reverseStr(str).replace(/\\>/g, '>'))
      .join('/')
      .replace(/%2C/g, ',') // encodeURIComponent(',') == '%2C'
      .replace(/%252C/g, '%2C')
  }
}

