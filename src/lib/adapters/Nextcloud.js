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
    const json = await this.sendRequest(
      'GET',
      'index.php/apps/bookmarks/public/rest/v2/bookmark?page=-1'
    )

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
            parentId: this.getPathsFromServerMark(bm)[0]
          })
        } catch (e) {
          console.log(e)
        }
      },
      /* parallel: */ 10
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
        let b = bookmark.clone()
        b.parentId = path
        b.id += ';' + path // id = <serverId>;<path>
        array.push(b)
      })
      return array
    }, [])

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

      // attach path to id, since it might be duplicated
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
    console.log('(nextcloud)UPDATEFOLDER', { id, title })
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

  async getBookmark(id) {
    console.log('Fetching single bookmark', this.server)

    const json = await this.sendRequest(
      'GET',
      'index.php/apps/bookmarks/public/rest/v2/bookmark/' + id
    )

    let bm = json.item

    let bookmarks = this.getPathsFromServerMark(bm).map(path => {
      let bookmark = new Bookmark({
        id: bm.id,
        url: bm.url,
        title: bm.title,
        parentId: path
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
      bookmark.tags = NextcloudAdapter.filterPathTagsFromTags(bm.tags)
      return bookmark
    })

    return bookmarks
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

    const json = await this.sendRequest(
      'POST',
      'index.php/apps/bookmarks/public/rest/v2/bookmark',
      body
    )

    bm.id = json.item.id + ';' + bm.parentId
    await this.updateBookmark(bm)

    return bm.id
  }

  async updateBookmark(newBm) {
    console.log('(nextcloud)UPDATE', newBm)
    if (!~['https:', 'http:', 'ftp:'].indexOf(url.parse(newBm.url).protocol)) {
      return false
    }

    let bms = await this.getBookmark(newBm.id.split(';')[0])

    // adjust path relative to serverRoot
    if (this.server.serverRoot) {
      newBm.parentId = this.server.serverRoot + newBm.parentId
    }
    let body = new URLSearchParams()
    body.append('url', newBm.url)
    body.append('title', newBm.title)

    let oldPath = newBm.id.split(';')[1]
    bms
      .map(bm => bm.parentId)
      .filter(path => path !== oldPath)
      .map(path => NextcloudAdapter.convertPathToTag(path))
      .concat([NextcloudAdapter.convertPathToTag(newBm.parentId)])
      .forEach(tag => body.append('item[tags][]', tag))

    await this.sendRequest(
      'PUT',
      'index.php/apps/bookmarks/public/rest/v2/bookmark/' +
        newBm.id.split(';')[0],
      body
    )

    // update bookmark id in-place, so it'll be updated in the mappings
    newBm.id = newBm.id.split(';')[0] + newBm.parentId
  }

  async removeBookmark(id) {
    console.log('(nextcloud)REMOVE', { id })

    let bms = await this.getBookmark(id.split(';')[0])

    if (bms.length !== 1) {
      // multiple bookmarks of the same url
      // only remove one of the multiple path tags
      let body = new URLSearchParams()
      body.append('url', bms[0].url)
      body.append('title', bms[0].title)

      let oldPath = id.split(';')[1]
      bms
        .map(bm => bm.parentId)
        .filter(path => path !== oldPath)
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
    return pathTags.length
      ? pathTags.map(pathTag => NextcloudAdapter.convertTagToPath(pathTag))
      : [this.server.serverRoot]
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
