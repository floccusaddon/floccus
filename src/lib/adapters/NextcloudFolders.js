// Nextcloud ADAPTER
// All owncloud specifc stuff goes in here
import Adapter from '../interfaces/Adapter'
import HtmlSerializer from '../serializers/Html'
import Logger from '../Logger'
import { Bookmark, Folder } from '../Tree'
import * as Basics from '../components/basics'
import { Base64 } from 'js-base64'
import AsyncLock from 'async-lock'
import browser from '../browser-api'

const Parallel = require('async-parallel')
const { h } = require('hyperapp')
const url = require('url')
const PQueue = require('p-queue')
const _ = require('lodash')

const PAGE_SIZE = 300
const TIMEOUT = 180000

const {
  Input,
  Button,
  Label,
  OptionSyncFolder,
  OptionDelete,
  OptionResetCache,
  OptionParallelSyncing,
  OptionSyncInterval,
  OptionSyncStrategy,
  H3
} = Basics

export default class NextcloudFoldersAdapter extends Adapter {
  constructor(server) {
    super()
    this.server = server
    this.fetchQueue = new PQueue({ concurrency: 12 })
    this.bookmarkLock = new AsyncLock()
    this.hasFeatureHashing = false
    this.hasFeatureExistanceCheck = false
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

  static renderOptions(state, update) {
    let data = state.account
    let onchange = (prop, e) => {
      update({ [prop]: e.target.value })
    }
    return (
      <form>
        <Label for="url">{browser.i18n.getMessage('LabelNextcloudurl')}</Label>
        <Input
          value={data.url}
          type="text"
          name="url"
          oninput={onchange.bind(null, 'url')}
        />
        <Label for="username">{browser.i18n.getMessage('LabelUsername')}</Label>
        <Input
          value={data.username}
          type="text"
          name="username"
          oninput={onchange.bind(null, 'username')}
        />
        <Label for="password">{browser.i18n.getMessage('LabelPassword')}</Label>
        <Input
          value={data.password}
          type="password"
          name="password"
          oninput={onchange.bind(null, 'password')}
        />
        <OptionSyncFolder account={state.account} />

        <H3>{browser.i18n.getMessage('LabelServerfolder')}</H3>
        <p>{browser.i18n.getMessage('DescriptionServerfolder')}</p>
        <Input
          value={data.serverRoot || ''}
          type="text"
          name="serverRoot"
          oninput={onchange.bind(null, 'serverRoot')}
        />

        <OptionSyncInterval account={state.account} />
        <OptionResetCache account={state.account} />
        <OptionParallelSyncing account={state.account} />
        <OptionSyncStrategy account={state.account} />
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
    return ~['https:', 'http:', 'ftp:'].indexOf(url.parse(bm.url).protocol)
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
      if (!Array.isArray(json.data)) {
        throw new Error(browser.i18n.getMessage('Error015'))
      }
      data = data.concat(json.data)
      i++
    } while (json.data.length === PAGE_SIZE)

    let bookmarks = _.flatten(
      data.map(bm => {
        let bookmark = new Bookmark({
          id: bm.id,
          url: bm.url,
          title: bm.title
        })

        return bm.folders.map(parentId => {
          let b = bookmark.clone()
          b.parentId = parentId
          return b
        })
      })
    )

    Logger.log('Received bookmarks from server', bookmarks)
    this.list = bookmarks
    return bookmarks
  }

  async getBookmarksTree(loadAll) {
    this.list = null // clear cache before starting a new sync

    // feature detection: Check if the server offers hashes
    const hashResponse = await this.sendRequest(
      'GET',
      'index.php/apps/bookmarks/public/rest/v2/folder/-1/hash',
      null,
      null,
      true
    )
    let json
    try {
      json = await hashResponse.json()
    } catch (e) {
      // noop
    }

    if (
      !loadAll &&
      ((hashResponse.status === 200 && json && json.status === 'success') ||
        hashResponse.status === 504)
    ) {
      return this.getSparseBookmarksTree()
    } else {
      this.hasFeatureHashing = false
      return this.getCompleteBookmarksTree()
    }
  }

  async _getChildOrder(folderId, layers) {
    const childrenOrderJson = await this.sendRequest(
      'GET',
      `index.php/apps/bookmarks/public/rest/v2/folder/${folderId}/childorder` +
        (layers ? `?layers=${layers}` : '')
    )
    if (!Array.isArray(childrenOrderJson.data)) {
      throw new Error(browser.i18n.getMessage('Error015'))
    }
    return childrenOrderJson.data
  }

  async _getChildFolders(folderId, layers) {
    const folderJson = await this.sendRequest(
      'GET',
      `index.php/apps/bookmarks/public/rest/v2/folder?root=${folderId}&layers=${layers}`
    )
    if (!Array.isArray(folderJson.data)) {
      throw new Error(browser.i18n.getMessage('Error015'))
    }
    return folderJson.data
  }

  async _findServerRoot(childFolders) {
    let tree = new Folder({ id: '-1' })
    await Parallel.each(
      this.server.serverRoot.split('/').slice(1),
      async segment => {
        let currentChild = _.find(
          childFolders,
          folder => folder.title === segment
        )
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
          if (typeof json.item !== 'object') {
            throw new Error(browser.i18n.getMessage('Error015'))
          }
          currentChild = { id: json.item.id, children: [] }
        }
        tree = new Folder({ id: currentChild.id })
        childFolders =
          currentChild.children ||
          (await this._getChildFolders(currentChild.id))
      },
      1
    )
    return { tree, childFolders }
  }

  async getCompleteBookmarksTree() {
    let list = await this.getBookmarksList()

    const childrenLayers = 2

    let childFolders = await this._getChildFolders(-1, childrenLayers)
    Logger.log(
      'Received initial folders from server (may be incomplete)',
      childFolders
    )

    let tree = new Folder({ id: '-1' })
    if (this.server.serverRoot) {
      ;({ tree, childFolders } = await this._findServerRoot(childFolders))
    }

    // retrieve folder order
    let childrenOrder = await this._getChildOrder(tree.id, childrenLayers)
    Logger.log(
      'Received initial children order from server (may be incomplete)',
      childrenOrder
    )

    const recurseChildFolders = async (tree, childFolders, childrenOrder) => {
      const folders = await Parallel.map(
        childrenOrder,
        async child => {
          if (child.type === 'folder') {
            // get the folder from the tree we've fetched above
            let folder = childFolders.find(folder => folder.id === child.id)
            if (!folder) throw new Error(browser.i18n.getMessage('Error021'))
            let newFolder = new Folder({
              id: child.id,
              title: folder.title,
              parentId: tree.id
            })
            tree.children.push(newFolder)
            return [newFolder, child, folder]
          } else {
            // get the bookmark from the list we've fetched above
            let childBookmark = _.find(
              list,
              bookmark =>
                parseInt(bookmark.id) === parseInt(child.id) &&
                parseInt(bookmark.parentId) === parseInt(tree.id)
            )
            if (!childBookmark) {
              throw new Error(
                browser.i18n.getMessage('Error022', [
                  `#${tree.id}[${tree.title}]`,
                  child.id
                ])
              )
            }
            childBookmark = childBookmark.clone()
            childBookmark.id = childBookmark.id + ';' + tree.id
            childBookmark.parentId = tree.id
            tree.children.push(childBookmark)
          }
        },
        1
      )
      await Parallel.each(
        folders.filter(Boolean),
        async ([newFolder, child, folder]) => {
          if (typeof child.children === 'undefined') {
            child.children = await this._getChildOrder(child.id, childrenLayers)
          }
          if (typeof folder.children === 'undefined') {
            folder.children = await this._getChildFolders(
              folder.id,
              childrenLayers
            )
          }

          // ... and recurse
          return recurseChildFolders(newFolder, folder.children, child.children)
        },
        3
      )
    }
    await recurseChildFolders(tree, childFolders, childrenOrder)

    this.tree = tree
    return tree.clone()
  }

  async getSparseBookmarksTree() {
    this.hasFeatureHashing = true
    this.hasFeatureExistanceCheck = true

    const childrenLayers = 3

    let childFolders = await this._getChildFolders(-1, childrenLayers)
    let tree = new Folder({ id: '-1' })

    if (this.server.serverRoot) {
      ;({ tree, childFolders } = await this._findServerRoot(childFolders))
    }

    Logger.log('Received initial folders from server', childFolders)

    const recurseChildFolders = (tree, childFolders) => {
      childFolders.forEach(childFolder => {
        let newFolder = new Folder({
          id: childFolder.id,
          title: childFolder.title,
          parentId: tree.id
        })
        tree.children.push(newFolder)
        // ... and recurse
        return recurseChildFolders(newFolder, childFolder.children || [])
      })
    }
    this.list = null
    tree.hashValue = { true: await this._getFolderHash(-1) }
    recurseChildFolders(tree, childFolders)
    this.tree = tree.clone(true) // we clone (withHash), so we can mess with our own version
    return tree
  }

  async _getFolderHash(folderId) {
    return this.sendRequest(
      'GET',
      `index.php/apps/bookmarks/public/rest/v2/folder/${folderId}/hash`
    )
      .catch(e => {
        return { data: '0' } // fallback
      })
      .then(json => {
        return json.data
      })
  }

  async _getChildren(folderId, layers) {
    let childrenJson
    if (
      'undefined' === typeof this.hasFeatureChildren ||
      this.hasFeatureChildren
    ) {
      try {
        childrenJson = await this.sendRequest(
          'GET',
          `index.php/apps/bookmarks/public/rest/v2/folder/${folderId}/children?layers=${layers}`
        )
        this.hasFeatureChildren = true
      } catch (e) {
        this.hasFeatureChildren = false
      }
    }
    if (this.hasFeatureChildren) {
      const children = childrenJson.data
      const recurseChildren = (folderId, children) => {
        return children.map(item => {
          if (item.type === 'bookmark') {
            return new Bookmark({
              id: item.id + ';' + folderId,
              title: item.title,
              parentId: folderId,
              url: item.url
            })
          } else if (item.type === 'folder') {
            const childFolder = new Folder({
              id: item.id,
              parentId: folderId,
              title: item.title
            })
            childFolder.loaded = Boolean(item.children)
            childFolder.children = recurseChildren(item.id, item.children || [])
            return childFolder
          }
        })
      }
      return recurseChildren(folderId, children)
    } else {
      const [childrenOrder, childFolders, childBookmarks] = await Promise.all([
        this._getChildOrder(folderId),
        this._getChildFolders(folderId),
        Promise.resolve().then(
          () =>
            this.list ||
            this.sendRequest(
              'GET',
              `index.php/apps/bookmarks/public/rest/v2/bookmark?folder=${folderId}&page=-1`
            ).then(json => json.data)
        )
      ])
      const recurseFolders = (folderId, childFolders) => {
        if (!childFolders) return
        return childFolders.map(child => {
          if (child instanceof Folder) {
            return child
          }
          const childFolder = new Folder({
            id: child.id,
            parentId: folderId,
            title: child.title
          })
          childFolder.children = recurseFolders(child.id, child.children)
          return childFolder
        })
      }
      const folder = new Folder({
        children: recurseFolders(folderId, childFolders)
      })
      return childrenOrder.map(item => {
        if (item.type === 'bookmark') {
          const bm = _.find(
            childBookmarks,
            child => parseInt(child.id) === parseInt(item.id)
          )
          if (bm instanceof Bookmark) return bm // in case we've got this from the cached list
          return new Bookmark({
            id: bm.id + ';' + folderId,
            title: bm.title,
            parentId: folderId,
            url: bm.url
          })
        } else if (item.type === 'folder') {
          return folder.findFolder(item.id)
        }
      })
    }
  }

  async loadFolderChildren(folderId) {
    if (!this.hasFeatureHashing) {
      return
    }
    const folder = this.tree.findFolder(folderId)
    if (folder.loaded) {
      return folder.clone(true).children
    }
    const children = await this._getChildren(folderId, 1)
    const recurse = async children => {
      return Parallel.each(children, async child => {
        if (child instanceof Folder && !child.loaded) {
          const folderHash = await this._getFolderHash(child.id)
          child.hashValue = { true: folderHash }
          await recurse(child.children)
        }
      })
    }
    await recurse(children)
    folder.children = children
    return folder.clone(true).children
  }

  async createFolder(parentId, title) {
    Logger.log('(nextcloud-folders)CREATEFOLDER', { parentId, title })

    let parentFolder
    if (parentId !== '-1') {
      parentFolder = this.tree
    } else {
      parentFolder = this.tree.findFolder(parentId)
      if (!parentFolder) {
        throw new Error(browser.i18n.getMessage('Error005'))
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
    if (typeof json.item !== 'object') {
      throw new Error(browser.i18n.getMessage('Error015'))
    }

    parentFolder.children.push(
      new Folder({ id: json.item.id, title, parentId })
    )
    this.tree.createIndex()
    return json.item.id
  }

  async bulkImportFolder(parentId, folder) {
    if (this.hasFeatureBulkImport === false) {
      throw new Error('Current server does not support bulk import')
    }
    if (folder.count() > 300) {
      throw new Error('Refusing to bulk import more than 1000 bookmarks')
    }
    Logger.log('(nextcloud-folders)BULKIMPORT', { parentId, folder })
    const blob = new Blob(
      [
        '<!DOCTYPE NETSCAPE-Bookmark-file-1>\n',
        '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">\n',
        HtmlSerializer.serialize(folder)
      ],
      {
        type: 'text/html'
      }
    )
    const body = new FormData()
    body.append('bm_import', blob)
    let json
    try {
      json = await this.sendRequest(
        'POST',
        `index.php/apps/bookmarks/public/rest/v2/folder/${parentId}/import`,
        null,
        body
      )
    } catch (e) {
      this.hasFeatureBulkImport = false
    }

    const recurseChildren = (children, id, title, parentId) => {
      return new Folder({
        id,
        title,
        parentId,
        children: children.map(item => {
          if (item.type === 'bookmark') {
            return new Bookmark({
              id: item.id + ';' + id,
              title: item.title,
              url: item.url,
              parentId: id
            })
          } else if (item.type === 'folder') {
            return recurseChildren(item.children, item.id, item.title, id)
          } else {
            console.log('PEBCAK', item)
            throw new Error('PEBKAC')
          }
        })
      })
    }
    return recurseChildren(json.data, parentId, folder.title)
  }

  async updateFolder(id, title) {
    Logger.log('(nextcloud-folders)UPDATEFOLDER', { id, title })
    let folder = this.tree.findFolder(id)
    if (!folder) {
      throw new Error(browser.i18n.getMessage('Error006'))
    }
    let body = JSON.stringify({
      parent_folder: folder.parentId,
      title: title
    })
    await this.sendRequest(
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
      throw new Error(browser.i18n.getMessage('Error007'))
    }
    let body = JSON.stringify({
      parent_folder: parentId,
      title: folder.title
    })
    await this.sendRequest(
      'PUT',
      `index.php/apps/bookmarks/public/rest/v2/folder/${id}`,
      'application/json',
      body
    )
    let oldParentFolder = this.tree.findFolder(folder.parentId)
    oldParentFolder.children = oldParentFolder.children.filter(
      child => parseInt(child.id) !== parseInt(id)
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
    await this.sendRequest(
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
    await this.sendRequest(
      'DELETE',
      `index.php/apps/bookmarks/public/rest/v2/folder/${id}`
    )
    let parent = this.tree.findFolder(folder.parentId)
    parent.children = parent.children.filter(
      child => parseInt(child.id) !== parseInt(id)
    )

    this.tree.createIndex()
  }

  async _getBookmark(id) {
    Logger.log('Fetching single bookmark')

    const json = await this.sendRequest(
      'GET',
      'index.php/apps/bookmarks/public/rest/v2/bookmark/' + id
    )
    if (typeof json.item !== 'object') {
      throw new Error(browser.i18n.getMessage('Error015'))
    }

    let bm = json.item
    if (!bm.folders.length) {
      bm.folders = [null]
    }
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
    if (this.hasFeatureExistanceCheck) {
      const json = await this.sendRequest(
        'GET',
        `index.php/apps/bookmarks/public/rest/v2/bookmark?url=${encodeURIComponent(
          url
        )}`
      )
      if (json.data.length) {
        return json.data[0].id
      } else {
        return false
      }
    } else {
      await this.getBookmarksList()
      let existing = _.find(this.list, bookmark => bookmark.url === url)
      if (!existing) return false
      return existing.id
    }
  }

  async createBookmark(bm) {
    Logger.log('(nextcloud-folders)CREATE', bm)

    // We need this lock to avoid creating two boomarks with the same url
    // in parallel
    return this.bookmarkLock.acquire(bm.url, async () => {
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
        if (typeof json.item !== 'object') {
          throw new Error(browser.i18n.getMessage('Error015'))
        }
        bm.id = json.item.id + ';' + bm.parentId
      }
      // add bookmark to cached list
      let upstreamMark = bm.clone()
      upstreamMark.id = bm.id.split(';')[0]
      this.list && this.list.push(upstreamMark)

      return bm.id
    })
  }

  async updateBookmark(newBm) {
    Logger.log('(nextcloud-folders)UPDATE', newBm)

    let [upstreamId, oldParentId] = newBm.id.split(';')

    // We need this lock to avoid updating bookmarks which are in two places at Once
    // in parallel
    return this.bookmarkLock.acquire(upstreamId, async () => {
      let bms = await this._getBookmark(upstreamId)

      let body = JSON.stringify({
        url: newBm.url,
        title: newBm.title,
        folders: bms
          .map(bm => bm.parentId)
          .filter(
            parentId => parentId && parseInt(parentId) !== parseInt(oldParentId)
          )
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
    return this.bookmarkLock.acquire(upstreamId, async () => {
      await this.sendRequest(
        'DELETE',
        `index.php/apps/bookmarks/public/rest/v2/folder/${parentId}/bookmarks/${upstreamId}`
      )

      // remove bookmark from the cached list
      const list = await this.getBookmarksList()
      let listIndex = _.findIndex(
        list,
        bookmark => parseInt(bookmark.id) === parseInt(upstreamId)
      )
      list.splice(listIndex, 1)
    })
  }

  async sendRequest(verb, relUrl, type, body, returnRawResponse) {
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
            ...(body && { body })
          }),
          new Promise((resolve, reject) =>
            setTimeout(() => {
              const e = new Error(browser.i18n.getMessage('Error016'))
              e.pass = true
              reject(e)
            }, TIMEOUT)
          )
        ])
      )
    } catch (e) {
      if (e.pass) throw e
      throw new Error(browser.i18n.getMessage('Error017'))
    }

    if (returnRawResponse) {
      return res
    }

    if (res.status === 401) {
      throw new Error(browser.i18n.getMessage('Error018'))
    }
    if (res.status !== 200) {
      throw new Error(browser.i18n.getMessage('Error019', [res.status, verb]))
    }
    let json
    try {
      json = await res.json()
    } catch (e) {
      throw new Error(browser.i18n.getMessage('Error020') + '\n' + e.message)
    }
    if (json.status !== 'success') {
      throw new Error('Nextcloud API error: \n' + JSON.stringify(json))
    }

    return json
  }
}
