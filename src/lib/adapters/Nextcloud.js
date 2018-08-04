// Nextcloud ADAPTER
// All owncloud specifc stuff goes in here
import Adapter from '../Adapter'
import Logger from '../Logger'
import { Folder, Bookmark } from '../Tree'
import PathHelper from '../PathHelper'
import * as Basics from '../components/basics'
const Parallel = require('async-parallel')
const { h } = require('hyperapp')
const url = require('url')
const PQueue = require('p-queue')
const _ = require('lodash')

const TAG_PREFIX = 'floccus:'

const { Input, Button, Label, OptionSyncFolder, OptionDelete, H3, P } = Basics

export default class NextcloudAdapter extends Adapter {
  constructor(server) {
    super()
    this.server = server
    this.fetchQueue = new PQueue({ concurrency: 10 })
  }

  static getDefaultValues() {
    return {
      type: 'nextcloud',
      url: 'https://example.org',
      username: 'bob',
      password: 's3cret',
      serverRoot: ''
    }
  }

  static renderOptions(state, actions) {
    let data = state.account
    let onchange = (prop, e) => {
      actions.options.update({
        data: { [prop]: e.target.value }
      })
    }
    return (
      <form>
        <table>
          <tr>
            <td>
              <Label for="url">Nextcloud server URL:</Label>
            </td>
            <td>
              <Input
                value={data.url}
                type="text"
                name="url"
                onkeyup={onchange.bind(null, 'url')}
                onblur={onchange.bind(null, 'url')}
              />
            </td>
          </tr>
          <tr>
            <td>
              <Label for="username">User name:</Label>
            </td>
            <td>
              <Input
                value={data.username}
                type="text"
                name="username"
                onkeyup={onchange.bind(null, 'username')}
                onblur={onchange.bind(null, 'username')}
              />
            </td>
          </tr>
          <tr>
            <td>
              <Label for="password">Password:</Label>
            </td>
            <td>
              <Input
                value={data.password}
                type="password"
                name="password"
                onkeyup={onchange.bind(null, 'password')}
                onblur={onchange.bind(null, 'password')}
              />
            </td>
          </tr>
          <tr>
            <td />
            <td>
              <OptionSyncFolder account={state.account} />

              <H3>Server folder</H3>
              <P>
                This is the path prefix under which this account will work. E.g.
                if you use "/myBookmarks", all your bookmarks will be created on
                the server with this path prefixed to their normal path. This
                allows you to compartmentalize your server bookmarks.
              </P>
              <Input
                value={data.serverRoot || ''}
                type="text"
                name="serverRoot"
                placeholder="Default: root folder  Example: /my/subfolder"
                onkeyup={onchange.bind(null, 'serverRoot')}
                onblur={onchange.bind(null, 'serverRoot')}
              />

              <OptionDelete account={state.account} />
            </td>
          </tr>
        </table>
      </form>
    )
  }

  setData(data) {
    this.server = { ...data }
  }

  getData() {
    return { ...this.server }
  }

  getLabel() {
    let data = this.getData()
    return data.username + '@' + data.url
  }

  normalizeServerURL(input) {
    let serverURL = url.parse(input)
    let indexLoc = serverURL.pathname.indexOf('index.php')
    return url.format({
      protocol: serverURL.protocol,
      auth: serverURL.auth,
      host: serverURL.host,
      port: serverURL.port,
      pathname:
        serverURL.pathname.substr(0, ~indexLoc ? indexLoc : undefined) +
        (!~indexLoc && serverURL.pathname[serverURL.pathname.length - 1] !== '/'
          ? '/'
          : '')
    })
  }

  async getBookmarksList() {
    Logger.log('Fetching bookmarks', this.server)
    const json = await this.sendRequest(
      'GET',
      'index.php/apps/bookmarks/public/rest/v2/bookmark?page=-1'
    )

    let bookmarks = json.data.reduce((array, bm) => {
      let bookmark = new Bookmark({
        id: bm.id,
        url: bm.url,
        title: bm.title
        // Once firefox supports tags, we can do this:
        // tags: bm.tags.filter(tag => tag.indexOf('__floccus-path:') != 0)
      })

      // there may be multiple path tags per server bookmark, create a bookmark for each of them
      this.getPathsFromServerMark(bm).forEach(path => {
        // adjust path relative to serverRoot
        if (this.server.serverRoot) {
          if (path.indexOf(this.server.serverRoot) === 0) {
            path = path.substr(this.server.serverRoot.length)
          } else {
            // skip this bookmark
            return
          }
        }
        let b = bookmark.clone()
        b.parentId = path
        b.id += ';' + path // id = <serverId>;<path>
        array.push(b)
      })
      return array
    }, [])

    Logger.log('Received bookmarks from server', bookmarks)
    this.list = bookmarks
    return bookmarks
  }

  async getBookmarksTree() {
    let list = await this.getBookmarksList()
    list.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    let tree = new Folder({ id: '' })

    list.forEach(bookmark => {
      let pathArray = PathHelper.pathToArray(bookmark.parentId)

      var currentSubtree = tree
      pathArray.forEach((title, i) => {
        // we already have created the root folder
        if (i === 0) return
        var folder = currentSubtree.children.filter(
          folder => folder.title === title
        )[0]
        if (!folder) {
          var folder = new Folder({
            parentId: currentSubtree.id,
            id: PathHelper.arrayToPath(pathArray.slice(0, i + 1)),
            title
          })
          currentSubtree.children.push(folder)
        }
        currentSubtree = folder
      })

      // attach path to id, since it might be duplicated
      currentSubtree.children.push(bookmark)
    })

    this.tree = tree
    return tree
  }

  async createFolder(parentId, title) {
    Logger.log('(nextcloud)CREATEFOLDER', { parentId, title }, '(noop)')
    let newId = PathHelper.arrayToPath(
      PathHelper.pathToArray(parentId).concat([title])
    )
    return newId
  }

  async updateFolder(id, title) {
    Logger.log('(nextcloud)UPDATEFOLDER', { id, title })
    let folder = this.tree.findFolder(id)
    if (!folder) {
      throw new Error('Folder not found')
    }
    folder.title = title
    let newParentId = PathHelper.arrayToPath(
      PathHelper.pathToArray(folder.parentId).concat([title])
    )
    folder.id = newParentId
    await Parallel.each(folder.children, async child => {
      if (child instanceof Folder) {
        await this.moveFolder(child.id, newParentId)
      } else {
        child.parentId = newParentId
        await this.updateBookmark(child)
      }
    })
  }

  async moveFolder(id, parentId) {
    Logger.log('(nextcloud)MOVEFOLDER', { id, title })
    let folder = this.tree.findFolder(id)
    if (!folder) {
      throw new Error('Folder not found')
    }
    folder.parentId = parentId
    let newParentId = PathHelper.arrayToPath(
      PathHelper.pathToArray(parentId).concat([folder.title])
    )
    folder.id = newParentId
    await Parallel.each(folder.children, async child => {
      if (child instanceof Folder) {
        await this.moveFolder(child.id, newParentId)
      } else {
        child.parentId = newParentId
        await this.updateBookmark(child)
      }
    })
  }

  async removeFolder(id) {
    Logger.log('(nextcloud)REMOVEFOLDER', id)
    let folder = this.tree.findFolder(id)
    if (!folder) {
      return
    }
    await Parallel.each(folder.children, async child => {
      if (child instanceof Folder) {
        await this.removeFolder(child.id)
      } else {
        await this.removeBookmark(child.id)
      }
    })
  }

  async _getBookmark(id) {
    Logger.log('Fetching single bookmark', this.server)

    const json = await this.sendRequest(
      'GET',
      'index.php/apps/bookmarks/public/rest/v2/bookmark/' + id
    )

    let bm = json.item

    let paths = this.getPathsFromServerMark(bm)

    let bookmarks = paths.map(path => {
      let bookmark = new Bookmark({
        id: bm.id + ';' + path,
        url: bm.url,
        title: bm.title,
        parentId: path
      })
      bookmark.tags = NextcloudAdapter.filterPathTagsFromTags(bm.tags)
      return bookmark
    })

    return bookmarks
  }

  /*
   * This is pretty expensive! We need to wait until NcBookmarks has support for
   * querying urls directly
   */
  async getExistingBookmark(url) {
    await this.getBookmarksList()
    let existing = _.find(this.list, bookmark => bookmark.url === url)
    if (!existing) return
    return existing.id.split(';')[0]
  }

  async createBookmark(bm) {
    Logger.log('(nextcloud)CREATE', bm)
    if (!~['https:', 'http:', 'ftp:'].indexOf(url.parse(bm.url).protocol)) {
      return false
    }
    let existingBookmark = await this.getExistingBookmark(bm.url)
    if (existingBookmark) {
      bm.id = existingBookmark + ';' + bm.parentId
    } else {
      let body = new FormData()
      body.append('url', bm.url)
      body.append('title', bm.title)

      const json = await this.sendRequest(
        'POST',
        'index.php/apps/bookmarks/public/rest/v2/bookmark',
        body
      )
      bm.id = json.item.id + ';' + bm.parentId
    }

    await this.updateBookmark(bm)

    return bm.id
  }

  async updateBookmark(newBm) {
    Logger.log('(nextcloud)UPDATE', newBm)
    if (!~['https:', 'http:', 'ftp:'].indexOf(url.parse(newBm.url).protocol)) {
      return false
    }

    // returns the full paths from the server
    let bms = await this._getBookmark(newBm.id.split(';')[0])

    let body = new URLSearchParams()
    body.append('url', newBm.url)
    body.append('title', newBm.title)

    const realParentId = this.server.serverRoot
      ? this.server.serverRoot + newBm.parentId
      : newBm.parentId

    let oldPath = newBm.id.split(';')[1]
    if (this.server.serverRoot) {
      oldPath = this.server.serverRoot + oldPath
    }
    console.log(bms, '-', oldPath)
    let newTags = bms
      .map(bm => bm.parentId)
      .filter(path => path !== oldPath)
      .map(path => NextcloudAdapter.convertPathToTag(path))
      .concat([NextcloudAdapter.convertPathToTag(realParentId)])
      .concat(bms.length ? bms[0].tags : [])
    console.log('newTags', newTags)
    newTags.forEach(tag => body.append('item[tags][]', tag))

    await this.sendRequest(
      'PUT',
      'index.php/apps/bookmarks/public/rest/v2/bookmark/' +
        newBm.id.split(';')[0],
      body
    )

    // update bookmark id in-place, so it'll be updated in the mappings
    newBm.id = newBm.id.split(';')[0] + ';' + newBm.parentId
  }

  async removeBookmark(id) {
    Logger.log('(nextcloud)REMOVE', { id })

    let bms = await this._getBookmark(id.split(';')[0])

    if (bms.length !== 1) {
      // multiple bookmarks of the same url
      // only remove one of the multiple path tags
      let body = new URLSearchParams()
      body.append('url', bms[0].url)
      body.append('title', bms[0].title)

      let oldPath = id.split(';')[1]
      if (this.server.serverRoot) {
        oldPath = this.server.serverRoot + oldPath
      }
      bms
        .map(bm => bm.parentId)
        .filter(path => path !== oldPath)
        .map(path => NextcloudAdapter.convertPathToTag(path))
        .forEach(tag => body.append('item[tags][]', tag))

      await this.sendRequest(
        'PUT',
        'index.php/apps/bookmarks/public/rest/v2/bookmark/' + id.split(';')[0],
        body
      )
    } else {
      // remove the whole bookmark
      await this.sendRequest(
        'DELETE',
        'index.php/apps/bookmarks/public/rest/v2/bookmark/' + id.split(';')[0]
      )
    }
  }

  async sendRequest(verb, relUrl, body) {
    const url = this.normalizeServerURL(this.server.url) + relUrl
    var res
    try {
      res = await this.fetchQueue.add(() =>
        fetch(url, {
          method: verb,
          headers: {
            Authorization:
              'Basic ' + btoa(this.server.username + ':' + this.server.password)
          },
          body
        })
      )
    } catch (e) {
      throw new Error(
        'Network error: Check your network connection and your account details'
      )
    }

    Logger.log(res)

    if (res.status === 401) {
      throw new Error("Couldn't authenticate with the server")
    }
    if (res.status !== 200) {
      throw new Error(`Failed ${verb} request`)
    }
    let json = await res.json()
    if (json.status !== 'success') {
      throw new Error('Nextcloud API error: ' + JSON.stringify(json))
    }

    return json
  }

  getPathsFromServerMark(bm) {
    let pathTags = NextcloudAdapter.getPathTagsFromTags(bm.tags)
    return pathTags.map(pathTag => NextcloudAdapter.convertTagToPath(pathTag))
  }

  static filterPathTagsFromTags(tags) {
    return (tags || []).filter(tag => tag.indexOf(TAG_PREFIX) !== 0)
  }

  static getPathTagsFromTags(tags) {
    return (tags || []).filter(tag => tag.indexOf(TAG_PREFIX) === 0)
  }

  static convertPathToTag(path) {
    // We reverse the string and do a negative lookahead, reversing again afterwards
    return (
      TAG_PREFIX +
      PathHelper.pathToArray(path)
        .map(str => str.replace(/>/g, '\\>'))
        .join('>')
        .replace(/%2C/g, '%252C')
        .replace(/,/g, '%2C')
    ) // encodeURIComponent(',') == '%2C'
  }

  static convertTagToPath(tag) {
    // We reverse the string and split using a negative lookahead, reversing again afterwards
    return PathHelper.reverseStr(tag.substr(TAG_PREFIX.length))
      .split(/>(?![\\])/)
      .reverse()
      .map(str => PathHelper.reverseStr(str).replace(/\\>/g, '>'))
      .join('/')
      .replace(/%2C/g, ',') // encodeURIComponent(',') == '%2C'
      .replace(/%252C/g, '%2C')
  }
}
