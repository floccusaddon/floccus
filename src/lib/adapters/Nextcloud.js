// Nextcloud ADAPTER
// All owncloud specifc stuff goes in here
import Adapter from '../Adapter'
import { Folder, Bookmark } from '../Tree'
import PathHelper from '../PathHelper'
import * as Basics from '../components/basics'
const Parallel = require('async-parallel')
const { h } = require('hyperapp')
const url = require('url')
const PQueue = require('p-queue')

const TAG_PREFIX = 'floccus:'

const {
  Input,
  Button,
  Label,
  Options,
  Account,
  AccountStatus,
  AccountStatusDetail,
  OptionSyncFolder,
  OptionDelete,
  H3
} = Basics

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
      actions.accounts.update({
        accountId: state.account.id,
        data: { [prop]: e.target.value }
      })
    }
    return (
      <Account account={state.account}>
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
                <AccountStatus account={state.account} />
                <Button
                  onclick={e => {
                    e.preventDefault()
                    actions.accounts.toggleOptions(state.account.id)
                  }}
                >
                  Options
                </Button>
                <Button
                  disabled={!!data.syncing}
                  onclick={e => {
                    e.preventDefault()
                    !data.syncing && actions.accounts.sync(state.account.id)
                  }}
                >
                  Sync now
                </Button>
                <AccountStatusDetail account={state.account} />
                <Options show={state.showOptions}>
                  <OptionSyncFolder account={state.account} />

                  <H3>Server folder</H3>
                  <Input
                    value={data.serverRoot || ''}
                    type="text"
                    name="serverRoot"
                    placeholder="Default: root folder  Example: /my/subfolder"
                    onkeyup={onchange.bind(null, 'serverRoot')}
                    onblur={onchange.bind(null, 'serverRoot')}
                  />

                  <OptionDelete account={state.account} />
                </Options>
              </td>
            </tr>
          </table>
        </form>
      </Account>
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
    console.log('Fetching bookmarks', this.server)
    const getUrl =
      this.normalizeServerURL(this.server.url) +
      'index.php/apps/bookmarks/public/rest/v2/bookmark?page=-1'
    var response
    try {
      response = await this.fetchQueue.add(() =>
        fetch(getUrl, {
          headers: {
            Authorization:
              'Basic ' + btoa(this.server.username + ':' + this.server.password)
          }
        })
      )
    } catch (e) {
      throw new Error(
        'Network error: Check your network connection and your account details'
      )
    }

    if (response.status === 401) {
      throw new Error(
        "Couldn't authenticate for fetching bookmarks from the server."
      )
    }
    if (response.status !== 200) {
      throw new Error('Failed to retrieve bookmarks from server')
    }

    let json = await response.json()
    if (json.status !== 'success') {
      throw new Error('Fetch failed:' + JSON.stringify(json))
    }

    // for every bm without a path tag, add one
    let bmsWithoutPath = json.data.filter(bm =>
      bm.tags.every(tag => tag.indexOf(TAG_PREFIX) !== 0)
    )

    await Parallel.each(
      bmsWithoutPath,
      async bm => {
        try {
          await this.updateBookmark(bm.id, {
            ...bm,
            path: this.getPathFromServerMark(bm)
          })
        } catch (e) {
          console.log(e)
        }
      },
      /* parallel: */ 10
    )

    let bookmarks = json.data.map(bm => {
      let bookmark = new Bookmark({
        id: bm.id,
        url: bm.url,
        title: bm.title
        // Once firefox supports tags, we can do this:
        // tags: bm.tags.filter(tag => tag.indexOf('__floccus-path:') != 0)
      })
      bookmark.parentId = this.getPathFromServerMark(bm)
      return bookmark
    })

    console.log('Received bookmarks from server', bookmarks)
    return bookmarks
  }

  async getBookmarksTree() {
    let list = await this.getBookmarksList()
    list.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    let tree = new Folder({ id: '' })

    list.forEach(bookmark => {
      // adjust path relative to serverRoot
      if (this.server.serverRoot) {
        if (bookmark.parentId.indexOf(this.server.serverRoot) === 0) {
          bookmark.parentId = bookmark.parentId.substr(
            0,
            this.server.serverRoot.length
          )
        } else {
          // skip this bookmark
          return
        }
      }
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

      bookmark.parentId = currentSubtree.id
      currentSubtree.children.push(bookmark)
    })

    this.tree = tree
    return tree
  }

  async createFolder(parentId, title) {
    console.log('(nextcloud)CREATEFOLDER', { parentId, title }, '(noop)')
    let newId = PathHelper.arrayToPath(
      PathHelper.pathToArray(parentId).concat([title])
    )
    return newId
  }

  async updateFolder(id, title) {
    console.log('(nextcloud)CREATEFOLDER', { id, title })
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
    console.log('(nextcloud)MOVEFOLDER', { id, title })
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
    console.log('(nextcloud)REMOVEFOLDER', id)
    let folder = this.tree.findFolder(id)
    if (!folder) {
      return
    }
    await Parallel.each(folder.children, async child => {
      if (child instanceof Folder) {
        await this.removeFolder(child.id)
      } else {
        await this.removeBookmark(child)
      }
    })
  }

  async getBookmark(id, autoupdate) {
    console.log('Fetching single bookmark', this.server)
    const getUrl =
      this.normalizeServerURL(this.server.url) +
      'index.php/apps/bookmarks/public/rest/v2/bookmark/' +
      id
    var response
    try {
      response = await this.fetchQueue.add(() =>
        fetch(getUrl, {
          headers: {
            Authorization:
              'Basic ' + btoa(this.server.username + ':' + this.server.password)
          }
        })
      )
    } catch (e) {
      throw new Error(
        'Network error: Check your network connection and your account details'
      )
    }

    if (response.status === 401) {
      throw new Error(
        "Couldn't authenticate for retrieving a bookmark from the server."
      )
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
        ...bm,
        parentId: this.getPathFromServerMark(bm)
      })
    }

    let bookmark = new Bookmark({
      id: bm.id,
      url: bm.url,
      title: bm.title,
      parentId: this.getPathFromServerMark(bm)
    })
    // adjust path relative to serverRoot
    if (this.server.serverRoot) {
      if (bookmark.parentId.indexOf(this.server.serverRoot) === 0) {
        bookmark.parentId = bookmark.parentId.substr(
          0,
          this.server.serverRoot.length
        )
      } else {
        // Kind of a PEBCAK
      }
    }
    bookmark.tags = NextcloudAdapter.filterPathTagFromTags(bm.tags)
    return bookmark
  }

  async createBookmark(bm) {
    console.log('(nextcloud)CREATE', bm)
    if (!~['https:', 'http:', 'ftp:'].indexOf(url.parse(bm.url).protocol)) {
      return false
    }
    if (this.server.serverRoot) {
      bookmark.parentId = this.server.serverRoot + bookmark.parentId
    }
    let body = new FormData()
    body.append('url', bm.url)
    body.append('title', bm.title)
    body.append('item[tags][]', NextcloudAdapter.convertPathToTag(bm.parentId))
    const createUrl =
      this.normalizeServerURL(this.server.url) +
      'index.php/apps/bookmarks/public/rest/v2/bookmark'
    var res
    try {
      res = await this.fetchQueue.add(() =>
        fetch(createUrl, {
          method: 'POST',
          body,
          headers: {
            Authorization:
              'Basic ' + btoa(this.server.username + ':' + this.server.password)
          }
        })
      )
    } catch (e) {
      throw new Error(
        'Network error: Check your network connection and your account details'
      )
    }

    console.log(res)

    if (res.status === 401) {
      throw new Error(
        "Couldn't authenticate for creating a bookmark on the server."
      )
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

  async updateBookmark(newBm) {
    console.log('(nextcloud)UPDATE', newBm)
    if (!~['https:', 'http:', 'ftp:'].indexOf(url.parse(newBm.url).protocol)) {
      return false
    }

    let bm = await this.getBookmark(newBm.id, false)

    // adjust path relative to serverRoot
    if (this.server.serverRoot) {
      newBm.parentId = this.server.serverRoot + newBm.parentId
    }
    let body = new URLSearchParams()
    body.append('url', newBm.url)
    body.append('title', newBm.title)

    NextcloudAdapter.filterPathTagFromTags(bm.tags)
      .concat([NextcloudAdapter.convertPathToTag(newBm.parentId)])
      .forEach(tag => body.append('item[tags][]', tag))

    let updateUrl =
      this.normalizeServerURL(this.server.url) +
      'index.php/apps/bookmarks/public/rest/v2/bookmark/' +
      newBm.id
    var putRes
    try {
      putRes = await this.fetchQueue.add(() =>
        fetch(updateUrl, {
          method: 'PUT',
          body,
          headers: {
            Authorization:
              'Basic ' + btoa(this.server.username + ':' + this.server.password)
          }
        })
      )
    } catch (e) {
      throw new Error(
        'Network error: Check your network connection and your account details'
      )
    }

    console.log(putRes)

    if (putRes.status === 401) {
      throw new Error(
        "Couldn't authenticate for updating a bookmark on the server."
      )
    }
    if (putRes.status !== 200) {
      throw new Error('Updating a bookmark on the server failed: ' + newBm.url)
    }

    let putJson = await putRes.json()
    if (putJson.status !== 'success') {
      throw new Error('nextcloud API returned error')
    }
  }

  async removeBookmark(bm) {
    console.log('(nextcloud)REMOVE', bm)
    const delUrl =
      this.normalizeServerURL(this.server.url) +
      'index.php/apps/bookmarks/public/rest/v2/bookmark/' +
      bm.id
    var res
    try {
      res = await this.fetchQueue.add(() =>
        fetch(delUrl, {
          method: 'DELETE',
          headers: {
            Authorization:
              'Basic ' + btoa(this.server.username + ':' + this.server.password)
          }
        })
      )
    } catch (e) {
      throw new Error(
        'Network error: Check your network connection and your account details'
      )
    }

    console.log(res)

    if (res.status === 401) {
      throw new Error(
        "Couldn't authenticate for removing a bookmark on the server."
      )
    }
    if (res.status !== 200) {
      throw new Error('Removing a bookmark on the server failed. url=' + bm.url)
    }
  }

  getPathFromServerMark(bm) {
    let pathTag = NextcloudAdapter.getPathTagFromTags(bm.tags)
    return pathTag
      ? NextcloudAdapter.convertTagToPath(pathTag)
      : this.server.serverRoot
  }

  static filterPathTagFromTags(tags) {
    return (tags || []).filter(tag => tag.indexOf(TAG_PREFIX) !== 0) // __floccus-path: is depecrated, but we still remove it from the filters here, so it's automatically removed
  }

  static getPathTagFromTags(tags) {
    return (tags || []).filter(tag => tag.indexOf(TAG_PREFIX) === 0)[0]
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
