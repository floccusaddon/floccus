import Bookmark from '../Bookmark'
import humanizeDuration from 'humanize-duration'

const url = require('url')

export default class WebDavAdapter {
  constructor (server) {
    this.server = server
    this.db = new Map()
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

  async pullBookmarks () {
    console.log('Fetching bookmarks', this.server)

    let bookmarks = Array.from(this.db.values())
      .map(bm => {
        return new Bookmark(bm.id, null, bm.url, bm.title, bm.path)
      })

    console.log('Received bookmarks from server', bookmarks)
    return bookmarks
  }

  async getBookmark (id, autoupdate) {
    console.log('Fetching single bookmark', this.server)
    let bm = this.db.get(id)
    if (!bm) {
      throw new Error('Failed to fetch bookmark')
    }
    let bookmark = new Bookmark(bm.id, null, bm.url, bm.title, bm.path)
    return bookmark
  }

  async createBookmark (bm) {
    if (!~['https:', 'http:', 'ftp:'].indexOf(url.parse(bm.url).protocol)) {
      return false
    }

    const highestId = Array.from(this.db.keys()).reduce((highestId, bm) => {
      return highestId < bm.id ? bm.id : highestId
    }, 0)
    bm.id = highestId + 1
    this.db.set(bm.id, {
      id: bm.id
      , url: bm.url
      , title: bm.title
      , path: bm.path
    })
    return bm
  }

  async updateBookmark (remoteId, newBm) {
    if (!~['https:', 'http:', 'ftp:'].indexOf(url.parse(newBm.url).protocol)) {
      return false
    }
    let bm = await this.getBookmark(remoteId, false)

    this.db.set(bm.id, {
      id: bm.id
      , url: newBm.url
      , title: newBm.title
      , path: newBm.path
    })
    return new Bookmark(remoteId, null, newBm.url, newBm.title, newBm.path)
  }

  async removeBookmark (remoteId) {
    this.db.delete(remoteId)
  }

  renderOptions (ctl, rootPath) {
    let data = this.getData()
    let onchangeURL = (e) => {
      if (this.saveTimeout) clearTimeout(this.saveTimeout)
      this.saveTimeout = setTimeout(() => ctl.update({...data, url: e.target.value}), 300)
    }
    let onchangeUsername = (e) => {
      if (this.saveTimeout) clearTimeout(this.saveTimeout)
      this.saveTimeout = setTimeout(() => ctl.update({...data, username: e.target.value}), 300)
    }
    let onchangePassword = (e) => {
      if (this.saveTimeout) clearTimeout(this.saveTimeout)
      this.saveTimeout = setTimeout(() => ctl.update({...data, password: e.target.value}), 300)
    }
    let onchangeBookmarkFile = (e) => {
      if (this.saveTimeout) clearTimeout(this.saveTimeout)
      this.saveTimeout = setTimeout(() => ctl.update({...data, bookmark_file: e.target.value}), 300)
    }
    return <div className="account">
      <form>
        <table>
          <tr>
            <td><label for="url">WebDav server URL:</label></td>
            <td><input value={new InputInitializeHook(data.url)} type="text" className="url" name="url" ev-keyup={onchangeURL} ev-blur={onchangeURL}/></td>
          </tr>
          <tr>
            <td><label for="username">User name:</label></td>
            <td><input value={new InputInitializeHook(data.username)} type="text" className="username" name="password" ev-keyup={onchangeUsername} ev-blur={onchangeUsername}/></td>
          </tr>
          <tr>
            <td><label for="password">Password:</label></td>
            <td><input value={new InputInitializeHook(data.password)} type="password" className="password" name="password" ev-keydown={onchangePassword} ev-blur={onchangePassword}/></td></tr>
          <tr>
            <td><label for="bookmark_file">Bookmark File:</label></td>
            <td><input value={new InputInitializeHook(data.bookmark_file)} type="text" className="text" name="bookmark_file" ev-keydown={onchangePassword} ev-blur={onchangeBookmarkFile}/></td></tr>
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
                <input type="text" disabled value={rootPath} /><br/>
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
}
