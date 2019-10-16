// Nextcloud ADAPTER
// All owncloud specifc stuff goes in here
import Adapter from '../interfaces/Adapter'
import HtmlSerializer from '../serializers/Html'
import Logger from '../Logger'
import { Folder, Bookmark } from '../Tree'
import * as Basics from '../components/basics'
import { Base64 } from 'js-base64'
const Parallel = require('async-parallel')
const { h } = require('hyperapp')
const url = require('url')
const PQueue = require('p-queue')
import AsyncLock from 'async-lock'
import browser from '../browser-api'
const _ = require('lodash')

const PAGE_SIZE = 300

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

  static renderOptions(state, actions) {
    let data = state.account
    let onchange = (prop, e) => {
      actions.options.update({ [prop]: e.target.value })
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
      if (!Array.isArray(json.data)) {
        throw new Error(browser.i18n.getMessage('Error015'))
      }
      data = data.concat(json.data)
      i++
    } while (json.data.length === PAGE_SIZE)

    let bookmarks = data.reduce((array, bm) => {
      let bookmark = new Bookmark({
        id: bm.id,
        url: bm.url,
        title: bm.title
      })

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

  async getBookmarksTree(loadAll) {
    this.list = null // clear cache before starting a new sync

    // feature detection: Check if the server offers hashes
    const hashResponse = await this.sendRequest(
      'GET',
      'index.php/apps/bookmarks/public/rest/v2/folder/-1/hash',
      null,
      null,
      /* returnRawResponse: */ true
    )
    let json
    try {
      json = await hashResponse.json()
    } catch (e) {
      // noop
    }

    if (
      !loadAll &&
      hashResponse.status === 200 &&
      json &&
      json.status === 'success'
    ) {
      return this.getSparseBookmarksTree()
    } else {
      return this.getCompleteBookmarksTree()
    }
  }

  async getCompleteBookmarksTree() {
    let list = await this.getBookmarksList()

    const childFoldersJson = await this.sendRequest(
      'GET',
      'index.php/apps/bookmarks/public/rest/v2/folder'
    )
    if (!Array.isArray(childFoldersJson.data)) {
      throw new Error(browser.i18n.getMessage('Error015'))
    }
    let childFolders = childFoldersJson.data
    Logger.log('Received folders from server', childFolders)
    // retrieve folder order
    const childrenOrderJson = await this.sendRequest(
      'GET',
      `index.php/apps/bookmarks/public/rest/v2/folder/-1/childorder?layers=-1`
    )
    if (!Array.isArray(childrenOrderJson.data)) {
      throw new Error(browser.i18n.getMessage('Error015'))
    }
    let childrenOrder = childrenOrderJson.data
    Logger.log('Received children order from server', childrenOrder)

    let tree = new Folder({ id: '-1' })
    if (this.server.serverRoot) {
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
          childFolders = currentChild.children
          let child = _.find(
            childrenOrder,
            child =>
              parseInt(child.id) === parseInt(currentChild.id) &&
              child.type === 'folder'
          )
          if (!child || !child.children) {
            const childrenOrderJson = await this.sendRequest(
              'GET',
              `index.php/apps/bookmarks/public/rest/v2/folder/${currentChild.id}/childorder`
            )
            if (!Array.isArray(childrenOrderJson.data)) {
              throw new Error(browser.i18n.getMessage('Error015'))
            }
            childrenOrder = childrenOrderJson.data
          } else {
            childrenOrder = _.find(
              childrenOrder,
              child =>
                parseInt(child.id) === parseInt(currentChild.id) &&
                child.type === 'folder'
            ).children
          }
        },
        1
      )
    }
    const recurseChildFolders = async(tree, childFolders, childrenOrder) => {
      await Parallel.each(
        childrenOrder,
        async child => {
          if (child.type === 'folder') {
            // get the folder from the tree we've fetched above
            let folder = childFolders.filter(
              folder => folder.id === child.id
            )[0]
            if (!folder) throw new Error(browser.i18n.getMessage('Error021'))
            let newFolder = new Folder({
              id: child.id,
              title: folder.title,
              parentId: tree.id
            })
            tree.children.push(newFolder)

            let subChildrenOrder
            if (typeof child.children === 'undefined') {
              // This is only necessary for bookmarks <=0.14.3
              const childrenOrderJson = await this.sendRequest(
                'GET',
                `index.php/apps/bookmarks/public/rest/v2/folder/${child.id}/childorder`
              )
              if (!Array.isArray(childrenOrderJson.data)) {
                throw new Error(browser.i18n.getMessage('Error015'))
              }
              subChildrenOrder = childrenOrderJson.data
            }

            // ... and recurse
            return recurseChildFolders(
              newFolder,
              folder.children,
              child.children || subChildrenOrder
            )
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
            return Promise.resolve()
          }
        },
        1
      )
    }
    await recurseChildFolders(tree, childFolders, childrenOrder)

    this.tree = tree
    return tree.clone()
  }

  async getSparseBookmarksTree() {
    this.hasFeatureHashing = true
    this.hasFeatureExistanceCheck = true
    const childFoldersJson = await this.sendRequest(
      'GET',
      'index.php/apps/bookmarks/public/rest/v2/folder'
    )
    if (!Array.isArray(childFoldersJson.data)) {
      throw new Error(browser.i18n.getMessage('Error015'))
    }
    let childFolders = childFoldersJson.data
    let tree = new Folder({ id: '-1' })
    if (this.server.serverRoot) {
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
          childFolders = currentChild.children
        },
        1
      )
    }
    Logger.log('Received folders from server', childFolders)
    const recurseChildFolders = (tree, childFolders) => {
      childFolders.forEach(child => {
        let newFolder = new Folder({
          id: child.id,
          title: child.title,
          parentId: tree.id
        })
        tree.children.push(newFolder)
        // ... and recurse
        return recurseChildFolders(newFolder, child.children)
      })
    }
    const hashJson = await this.sendRequest(
      'GET',
      'index.php/apps/bookmarks/public/rest/v2/folder/-1/hash'
    )
    this.list = null
    this.tree = tree.clone() // we clone, so we can mess with our own version
    recurseChildFolders(this.tree, childFoldersJson.data)
    tree.hashValue = { true: hashJson.data }
    recurseChildFolders(tree, childFoldersJson.data)
    return tree
  }

  async loadFolderChildren(folderId) {
    if (!this.hasFeatureHashing) {
      return
    }
    const [childrenOrderJson, childBookmarks] = await Promise.all([
      this.sendRequest(
        'GET',
        `index.php/apps/bookmarks/public/rest/v2/folder/${folderId}/childorder`
      ),
      Promise.resolve().then(
        () =>
          this.list ||
          this.sendRequest(
            'GET',
            `index.php/apps/bookmarks/public/rest/v2/bookmark?folder=${folderId}&page=-1`
          ).then(json => json.data)
      )
    ])
    if (
      !Array.isArray(childrenOrderJson.data) ||
      !Array.isArray(childBookmarks)
    ) {
      throw new Error(browser.i18n.getMessage('Error015'))
    }
    return Promise.all(
      childrenOrderJson.data.map(async item => {
        if (item.type === 'bookmark') {
          const bm = _.find(childBookmarks, child => child.id === item.id)
          if (bm instanceof Bookmark) return bm // in case we've got this from the cached list
          return new Bookmark({
            id: bm.id + ';' + folderId,
            title: bm.title,
            parentId: folderId,
            url: bm.url
          })
        } else if (item.type === 'folder') {
          const [folderHashJson, childFolder] = await Promise.all([
            this.sendRequest(
              'GET',
              `index.php/apps/bookmarks/public/rest/v2/folder/${item.id}/hash`
            ),
            Promise.resolve().then(
              () =>
                this.tree.findFolder(item.id) ||
                this.sendRequest(
                  'GET',
                  `index.php/apps/bookmarks/public/rest/v2/folder/${item.id}`
                ).then(
                  childFolderJson =>
                    new Folder({
                      id: childFolderJson.item.id,
                      parentId: childFolderJson.item.parent_id,
                      title: childFolderJson.item.title
                    })
                )
            )
          ])
          childFolder.hashValue = { true: folderHashJson.data }
          return childFolder
        }
      })
    )
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
    parent.children = parent.children.filter(child => child.id !== id)

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
    return this.bookmarkLock.acquire(bm.url, async() => {
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
    return this.bookmarkLock.acquire(upstreamId, async() => {
      let bms = await this._getBookmark(upstreamId)

      let body = JSON.stringify({
        url: newBm.url,
        title: newBm.title,
        folders: bms
          .map(bm => bm.parentId)
          .filter(parentId => parentId !== oldParentId && parentId)
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
    return this.bookmarkLock.acquire(upstreamId, async() => {
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
            }, 60000)
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
