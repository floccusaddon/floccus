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

export default class NextcloudFoldersAdapter extends Adapter {
  constructor(server) {
    super()
    this.server = server
    this.fetchQueue = new PQueue({ concurrency: 10 })
    this.bookmarkLock = new AsyncLock()
  }

  static getDefaultValues() {
    return {
      type: 'nextcloud-folders',
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
              <p>
                This is the path prefix under which this account will operate on
                the server. E.g. if you use{' '}
                <i>
                  <code>/work</code>
                </i>, all your bookmarks will be created on the server with this
                path prefixed to their original path (the one relative to the
                local folder you specified above). This allows you to separate
                your server bookmarks into multiple "profiles".
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
      bm.folders.forEach(parentId => {
        let b = bookmark.clone()
        b.id = b.id
        b.parentId = parentId
        array.push(b)
      })
      return array
    }, [])

    Logger.log('Received bookmarks from server', bookmarks)
    this.list = bookmarks
    return bookmarks
  }

  async getBookmarksTree() {
    this.list = null // clear cache before starting a new sync
    let list = await this.getBookmarksList()

    const json = await this.sendRequest(
      'GET',
      'index.php/apps/bookmarks/public/rest/v2/folder'
    )

    let tree = new Folder({ id: '-1' })
    let childFolders = json.data
    if (this.server.serverRoot) {
      await Parallel.each(
        this.server.serverRoot.split('/').slice(1),
        async segment => {
          let currentChild = childFolders.filter(
            folder => folder.title === segment
          )[0]
          if (!currentChild) {
            // create folder
            let body = JSON.stringify({
              parent_folder: tree.id,
              title: segment
            })
            const json = await this.sendRequest(
              'POST',
              'index.php/apps/bookmarks/public/rest/v2/folder',
              'application/json',
              body
            )
            currentChild = { id: json.item.id, children: [] }
          }
          tree = new Folder({ id: currentChild.id })
          childFolders = currentChild.children
        },
        1
      )
    }
    const recurseChildFolders = async (tree, childFolders) => {
      // retrieve folder order
      const json = await this.sendRequest(
        'GET',
        `index.php/apps/bookmarks/public/rest/v2/folder/${tree.id}/childorder`
      )
      await Promise.all(
        json.data.map(child => {
          if (child.type === 'folder') {
            // get the folder from the tree we've fetched above
            let folder = childFolders.filter(
              folder => folder.id === child.id
            )[0]
            if (!folder)
              throw new Error(
                'Inconsistent server state! Folder present in childorder list but not in folder tree'
              )
            let newFolder = new Folder({
              id: child.id,
              title: folder.title,
              parentId: tree.id
            })
            tree.children.push(newFolder)
            // ... and recurse
            return recurseChildFolders(newFolder, folder.children)
          } else {
            // get the bookmark from the list we've fetched above
            let childBookmark = _.find(
              list,
              bookmark =>
                bookmark.id === child.id && bookmark.parentId === tree.id
            )
            if (!childBookmark) {
              throw new Error(
                `Folder #${tree.id}[${
                  tree.title
                }] contains an nonexistent bookmark ${child.id}`
              )
            }
            childBookmark = childBookmark.clone()
            childBookmark.id = childBookmark.id + ';' + tree.id
            childBookmark.parentId = tree.id
            tree.children.push(childBookmark)
            return Promise.resolve()
          }
        })
      )
    }
    await recurseChildFolders(tree, childFolders)

    this.tree = tree
    return tree.clone()
  }

  async createFolder(parentId, title) {
    Logger.log('(nextcloud-folders)CREATEFOLDER', { parentId, title })

    let parentFolder
    if (parentId !== '-1') {
      parentFolder = this.tree
    } else {
      parentFolder = this.tree.findFolder(parentId)
      if (!parentFolder) {
        throw new Error('Folder not found')
      }
    }
    let body = JSON.stringify({
      parent_folder: parentId,
      title: title
    })
    const json = await this.sendRequest(
      'POST',
      'index.php/apps/bookmarks/public/rest/v2/folder',
      'application/json',
      body
    )
    parentFolder.children.push(
      new Folder({ id: json.item.id, title, parentId })
    )
    this.tree.createIndex()
    return json.item.id
  }

  async updateFolder(id, title) {
    Logger.log('(nextcloud-folders)UPDATEFOLDER', { id, title })
    let folder = this.tree.findFolder(id)
    if (!folder) {
      throw new Error('Folder not found')
    }
    let body = JSON.stringify({
      parent_folder: folder.parentId,
      title: title
    })
    const json = await this.sendRequest(
      'PUT',
      `index.php/apps/bookmarks/public/rest/v2/folder/${id}`,
      'application/json',
      body
    )
    folder.title = title
    this.tree.createIndex()
  }

  async moveFolder(id, parentId) {
    Logger.log('(nextcloud-folders)MOVEFOLDER', { id, parentId })
    let folder = this.tree.findFolder(id)
    if (!folder) {
      throw new Error('Folder not found')
    }
    let body = JSON.stringify({
      parent_folder: parentId,
      title: folder.title
    })
    const json = await this.sendRequest(
      'PUT',
      `index.php/apps/bookmarks/public/rest/v2/folder/${id}`,
      'application/json',
      body
    )
    let oldParentFolder = this.tree.findFolder(folder.parentId)
    oldParentFolder.children = oldParentFolder.children.filter(
      child => child.id !== id
    )
    let newParentFolder = this.tree.findFolder(parentId)
    folder.parentId = parentId
    newParentFolder.children.push(folder)
    this.tree.createIndex()
  }

  async orderFolder(id, order) {
    Logger.log('(nextcloud-folders)ORDERFOLDER', { id, order })
    const body = {
      data: order.map(item => ({
        id: String(item.id).split(';')[0],
        type: item.type
      }))
    }
    const json = await this.sendRequest(
      'PATCH',
      `index.php/apps/bookmarks/public/rest/v2/folder/${id}/childorder`,
      'application/json',
      JSON.stringify(body)
    )
  }

  async removeFolder(id) {
    Logger.log('(nextcloud-folders)REMOVEFOLDER', id)
    let folder = this.tree.findFolder(id)
    if (!folder) {
      return
    }
    const json = await this.sendRequest(
      'DELETE',
      `index.php/apps/bookmarks/public/rest/v2/folder/${id}`
    )
    let parent = this.tree.findFolder(folder.parentId)
    parent.children = parent.children.filter(child => child.id !== id)

    this.tree.createIndex()
  }

  async _getBookmark(id) {
    Logger.log('Fetching single bookmark')

    const json = await this.sendRequest(
      'GET',
      'index.php/apps/bookmarks/public/rest/v2/bookmark/' + id
    )

    let bm = json.item
    let bookmarks = bm.folders.map(parentId => {
      let bookmark = new Bookmark({
        id: bm.id + ';' + parentId,
        url: bm.url,
        title: bm.title,
        parentId: parentId
      })
      bookmark.tags = bm.tags
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
    return existing.id
  }

  async createBookmark(bm) {
    Logger.log('(nextcloud-folders)CREATE', bm)

    // We need this lock to avoid creating two boomarks with the same url
    // in parallel
    return await this.bookmarkLock.acquire(bm.url, async () => {
      let existingBookmark = await this.getExistingBookmark(bm.url)
      if (existingBookmark) {
        bm.id = existingBookmark + ';' + bm.parentId
        await this.updateBookmark(bm)
      } else {
        let body = JSON.stringify({
          url: bm.url,
          title: bm.title,
          folders: [bm.parentId]
        })

        const json = await this.sendRequest(
          'POST',
          'index.php/apps/bookmarks/public/rest/v2/bookmark',
          'application/json',
          body
        )
        bm.id = json.item.id + ';' + bm.parentId
      }
      // add bookmark to cached list
      let upstreamMark = bm.clone()
      upstreamMark.id = bm.id.split(';')[0]
      this.list.push(upstreamMark)

      return bm.id
    })
  }

  async updateBookmark(newBm) {
    Logger.log('(nextcloud-folders)UPDATE', newBm)

    let [upstreamId, oldParentId] = newBm.id.split(';')

    // We need this lock to avoid updating bookmarks which are in two places at Once
    // in parallel
    return await this.bookmarkLock.acquire(upstreamId, async () => {
      let bms = await this._getBookmark(upstreamId)

      let body = JSON.stringify({
        url: newBm.url,
        title: newBm.title,
        folders: bms
          .map(bm => bm.parentId)
          .filter(parentId => parentId !== oldParentId)
          .concat([newBm.parentId]),
        tags: bms[0].tags
      })

      await this.sendRequest(
        'PUT',
        `index.php/apps/bookmarks/public/rest/v2/bookmark/${upstreamId}`,
        'application/json',
        body
      )

      return upstreamId + ';' + newBm.parentId
    })
  }

  async removeBookmark(id) {
    Logger.log('(nextcloud-folders)REMOVE', { id })

    let [upstreamId, parentId] = id.split(';')

    // Just to be safe
    return await this.bookmarkLock.acquire(upstreamId, async () => {
      await this.sendRequest(
        'DELETE',
        `index.php/apps/bookmarks/public/rest/v2/folder/${parentId}/bookmarks/${upstreamId}`
      )

      // remove bookmark from the cached list
      const list = await this.getBookmarksList()
      let listIndex = _.findIndex(list, bookmark => bookmark.id === upstreamId)
      list.splice(listIndex, 1)
    })
  }

  async sendRequest(verb, relUrl, type, body) {
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
              ...(type && { 'Content-type': type }),
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
}
