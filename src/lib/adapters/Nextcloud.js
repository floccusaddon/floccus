// Nextcloud ADAPTER
// All owncloud specifc stuff goes in here
import Adapter from '../Adapter'
import Logger from '../Logger'
import { Folder, Bookmark } from '../Tree'
import PathHelper from '../PathHelper'
import * as Basics from '../components/basics'
import { Base64 } from 'js-base64'
const Parallel = require('async-parallel')
const { h } = require('hyperapp')
const url = require('url')
const PQueue = require('p-queue')
import AsyncLock from 'async-lock'
const _ = require('lodash')

const TAG_PREFIX = 'floccus:'
const PAGE_SIZE = 300

const {
  Input,
  Button,
  Label,
  OptionSyncFolder,
  OptionDelete,
  OptionResetCache,
  OptionParallelSyncing,
  H3
} = Basics

export default class NextcloudAdapter extends Adapter {
  constructor(server) {
    super()
    this.server = server
    this.fetchQueue = new PQueue({ concurrency: 100 })
    this.bookmarkLock = new AsyncLock()
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
        <Label for="url">Nextcloud server URL:</Label>
        <Input
          value={data.url}
          type="text"
          name="url"
          onkeyup={onchange.bind(null, 'url')}
          onblur={onchange.bind(null, 'url')}
        />
        <Label for="username">User name:</Label>
        <Input
          value={data.username}
          type="text"
          name="username"
          onkeyup={onchange.bind(null, 'username')}
          onblur={onchange.bind(null, 'username')}
        />
        <Label for="password">Password:</Label>
        <Input
          value={data.password}
          type="password"
          name="password"
          onkeyup={onchange.bind(null, 'password')}
          onblur={onchange.bind(null, 'password')}
        />
        <OptionSyncFolder account={state.account} />

        <H3>Server folder</H3>
        <p>
          This is the path prefix under which this account will operate on the
          server. E.g. if you use{' '}
          <i>
            <code>/work</code>
          </i>
          , all your bookmarks will be created on the server with this path
          prefixed to their original path (the one relative to the local folder
          you specified above). This allows you to separate your server
          bookmarks into multiple "profiles".
        </p>
        <Input
          value={data.serverRoot || ''}
          type="text"
          name="serverRoot"
          placeholder="Leave empty for no prefix"
          onkeyup={onchange.bind(null, 'serverRoot')}
          onblur={onchange.bind(null, 'serverRoot')}
        />

        <OptionResetCache account={state.account} />
        <OptionParallelSyncing account={state.account} />
        <OptionDelete account={state.account} />
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
    return data.username + '@' + url.parse(data.url).hostname
  }

  acceptsBookmark(bm) {
    if (!~['https:', 'http:', 'ftp:'].indexOf(url.parse(bm.url).protocol)) {
      return false
    }
    return true
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
    if (this.list) {
      return this.list
    }

    Logger.log('Fetching bookmarks')
    let i = 0
    let data = []
    let json
    do {
      json = await this.sendRequest(
        'GET',
        `index.php/apps/bookmarks/public/rest/v2/bookmark?page=${i}&limit=${PAGE_SIZE}`
      )
      data = data.concat(json.data)
      i++
    } while (json.data.length === PAGE_SIZE)

    let bookmarks = data.reduce((array, bm) => {
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
    this.list.raw = json.data
    return bookmarks
  }

  async getBookmarksTree() {
    this.list = null // clear cache before starting a new sync
    let list = await this.getBookmarksList()
    list.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    let tree = new Folder({ id: '' })

    list.forEach(bookmark => {
      let pathArray = PathHelper.pathToArray(bookmark.parentId)

      var currentSubtree = tree
      pathArray.forEach((title, i) => {
        var folder
        // we already have created the root folder
        if (i === 0) return
        folder = currentSubtree.children
          .filter(child => child instanceof Folder)
          .filter(folder => folder.title === title)[0]
        if (!folder) {
          folder = new Folder({
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
    let folder = new Folder({ title, parentId, id: newId })
    let newParent = this.tree.findFolder(parentId)
    if (!newParent) {
      throw new Error('New parent folder not found')
    }
    newParent.children.push(folder)
    this.tree.createIndex()
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
    await Parallel.each(
      folder.children,
      async child => {
        if (child instanceof Folder) {
          await this.moveFolder(child.id, newParentId)
        } else {
          child.parentId = newParentId
          await this.updateBookmark(child)
        }
      },
      1
    )
    this.tree.createIndex()
  }

  async moveFolder(id, parentId) {
    Logger.log('(nextcloud)MOVEFOLDER', { id, parentId })
    let folder = this.tree.findFolder(id)
    if (!folder) {
      throw new Error('Folder not found')
    }
    let oldParent = this.tree.findFolder(folder.parentId)
    if (!oldParent) {
      throw new Error('Parent folder not found')
    }
    oldParent.children.splice(oldParent.children.indexOf(folder), 1)

    let newParent = this.tree.findFolder(parentId)
    if (!newParent) {
      throw new Error('New parent folder not found')
    }
    newParent.children.push(folder)
    folder.parentId = parentId
    let newParentId = PathHelper.arrayToPath(
      PathHelper.pathToArray(parentId).concat([folder.title])
    )
    folder.id = newParentId

    await Parallel.each(
      folder.children,
      async child => {
        if (child instanceof Folder) {
          await this.moveFolder(child.id, newParentId)
        } else {
          child.parentId = newParentId
          await this.updateBookmark(child)
        }
      },
      1
    )
    this.tree.createIndex()
  }

  async removeFolder(id) {
    Logger.log('(nextcloud)REMOVEFOLDER', id)
    let folder = this.tree.findFolder(id)
    if (!folder) {
      return
    }

    await Parallel.each(
      folder.children,
      async child => {
        if (child instanceof Folder) {
          await this.removeFolder(child.id)
        } else {
          await this.removeBookmark(child.id)
        }
      },
      1
    )

    let oldParent = this.tree.findFolder(folder.parentId)
    if (!oldParent) {
      throw new Error('Parent folder not found')
    }
    oldParent.children.splice(oldParent.children.indexOf(folder), 1)
    this.tree.createIndex()
  }

  async _getBookmark(id) {
    Logger.log('Fetching single bookmark')

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

    return { bookmarks, tags: NextcloudAdapter.filterPathTagsFromTags(bm.tags) }
  }

  /*
   * This is pretty expensive! We need to wait until NcBookmarks has support for
   * querying urls directly
   */
  async getExistingBookmark(url) {
    Logger.log('Fetching bookmarks to find existing bookmark')
    const list = await this.getBookmarksList()
    let existing = _.find(list.raw, bookmark => bookmark.url === url)
    if (!existing) return
    return existing.id
  }

  async createBookmark(bm) {
    Logger.log('(nextcloud)CREATE', bm)

    // We need this lock to avoid creating multiple bookmarks with the same URL in parallel
    return await this.bookmarkLock.acquire(bm.url, async () => {
      let existingBookmark = await this.getExistingBookmark(bm.url)
      if (existingBookmark) {
        bm.id = existingBookmark + ';' + bm.parentId
        await this.updateBookmark(bm)
      } else {
        let body = new FormData()
        body.append('url', bm.url)
        body.append('title', bm.title)

        const realParentId = this.server.serverRoot
          ? this.server.serverRoot + bm.parentId
          : bm.parentId

        body.append(
          'item[tags][]',
          NextcloudAdapter.convertPathToTag(realParentId)
        )

        const json = await this.sendRequest(
          'POST',
          'index.php/apps/bookmarks/public/rest/v2/bookmark',
          body
        )
        bm.id = json.item.id + ';' + bm.parentId

        // add bookmark to cached URLs
        this.list.raw.push({ id: json.item.id, url: bm.url })
      }

      // add bookmark to cached list
      this.list.push(bm)

      return bm.id
    })
  }

  async updateBookmark(newBm) {
    Logger.log('(nextcloud)UPDATE', newBm)

    const serverId = newBm.id.split(';')[0]

    // We need this lock to avoid changing a bookmark that is
    // in two places in parallel for those two places
    return await this.bookmarkLock.acquire(serverId, async () => {
      // returns the full paths from the server
      let { bookmarks: bms, tags } = await this._getBookmark(serverId)

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
      console.log(bms, tags, '-', oldPath)
      let newTags = bms
        .map(bm => bm.parentId)
        .filter(path => path !== oldPath)
        .map(path => NextcloudAdapter.convertPathToTag(path))
        .concat([NextcloudAdapter.convertPathToTag(realParentId)])
        .concat(tags)
      console.log('newTags', newTags)
      newTags.forEach(tag => body.append('item[tags][]', tag))

      await this.sendRequest(
        'PUT',
        'index.php/apps/bookmarks/public/rest/v2/bookmark/' + serverId,
        body
      )

      return newBm.id.split(';')[0] + ';' + newBm.parentId
    })
  }

  async removeBookmark(id) {
    Logger.log('(nextcloud)REMOVE', { id })

    const serverId = id.split(';')[0]

    // We need this lock to avoid deleting a bookmark that is in two places
    // in parallel
    return await this.bookmarkLock.acquire(serverId, async () => {
      let { bookmarks: bms, tags } = await this._getBookmark(serverId)

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
          .concat(tags)
          .forEach(tag => body.append('item[tags][]', tag))

        console.log(bms, tags, '-', oldPath)

        await this.sendRequest(
          'PUT',
          'index.php/apps/bookmarks/public/rest/v2/bookmark/' + serverId,
          body
        )
      } else {
        // remove the whole bookmark
        await this.sendRequest(
          'DELETE',
          'index.php/apps/bookmarks/public/rest/v2/bookmark/' + serverId
        )

        // remove url from the cached list
        const list = await this.getBookmarksList()
        let listIndex = _.findIndex(
          list.raw,
          bookmark => bookmark.id === serverId
        )
        list.raw.splice(listIndex, 1)
      }

      // remove bookmark from the cached list
      const list = await this.getBookmarksList()
      let listIndex = _.findIndex(list, bookmark => bookmark.id === id)
      list.splice(listIndex, 1)
    })
  }

  async sendRequest(verb, relUrl, body) {
    const url = this.normalizeServerURL(this.server.url) + relUrl
    let res
    let authString = Base64.encode(
      this.server.username + ':' + this.server.password
    )
    try {
      res = await this.fetchQueue.add(() =>
        Promise.race([
          fetch(url, {
            method: verb,
            credentials: 'omit',
            headers: {
              Authorization: 'Basic ' + authString
            },
            body
          }),

          new Promise((resolve, reject) =>
            setTimeout(() => {
              const e = new Error(
                'Request timed out. Check your server configuration'
              )
              e.pass = true
              reject(e)
            }, 60000)
          )
        ])
      )
    } catch (e) {
      if (e.pass) throw e
      throw new Error(
        'Network error: Check your network connection and your account details'
      )
    }

    if (res.status === 401) {
      throw new Error("Couldn't authenticate with the server")
    }
    if (res.status !== 200) {
      throw new Error(
        `Error ${
          res.status
        }. Failed ${verb} request. Check your server configuration.`
      )
    }
    let json
    try {
      json = await res.json()
    } catch (e) {
      throw new Error(
        'Could not parse server response. Is the bookmarks app installed on your server?\n' +
          e.message
      )
    }
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
    return (
      TAG_PREFIX +
      path
        .replace(/[/]/g, '>')
        .replace(/%2C/g, '%252C')
        .replace(/,/g, '%2C')
    ) // encodeURIComponent(',') == '%2C'
  }

  static convertTagToPath(tag) {
    return tag
      .substr(TAG_PREFIX.length)
      .replace(/>/g, '/')
      .replace(/%2C/g, ',') // encodeURIComponent(',') == '%2C'
      .replace(/%252C/g, '%2C')
  }
}
