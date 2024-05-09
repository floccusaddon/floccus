// Nextcloud ADAPTER
// All owncloud specifc stuff goes in here
import { Capacitor, CapacitorHttp as Http } from '@capacitor/core'
import Adapter from '../interfaces/Adapter'
import HtmlSerializer from '../serializers/Html'
import Logger from '../Logger'
import { Bookmark, Folder, ItemLocation, TItem } from '../Tree'
import { Base64 } from 'js-base64'
import AsyncLock from 'async-lock'
import * as Parallel from 'async-parallel'
import PQueue from 'p-queue'
import flatten from 'lodash/flatten'
import { BulkImportResource, LoadFolderChildrenResource, OrderFolderResource } from '../interfaces/Resource'
import Ordering from '../interfaces/Ordering'
import {
  AuthenticationError, CreateBookmarkError,
  HttpError,
  InconsistentBookmarksExistenceError,
  InconsistentServerStateError,
  InterruptedSyncError, MissingPermissionsError,
  NetworkError,
  ParseResponseError,
  RedirectError,
  RequestTimeoutError, ResourceLockedError,
  UnexpectedServerResponseError,
  UnknownCreateTargetError,
  UnknownFolderParentUpdateError,
  UnknownFolderUpdateError,
  UnknownMoveTargetError
} from '../../errors/Error'

const PAGE_SIZE = 300
const TIMEOUT = 180000

export interface NextcloudBookmarksConfig {
  type: 'nextcloud-folders'|'nextcloud-bookmarks'
  url: string
  username: string
  password: string
  serverRoot?: string
  includeCredentials?: boolean
  allowRedirects?: boolean
  allowNetwork?: boolean
}

interface IChildFolder {
  id: string|number
  title: string
  parentId?: string|number
  children?: IChildFolder[]
}

interface IChildOrderItem {
  type: 'bookmark' | 'folder'
  id: string|number
  children?: IChildOrderItem[]
}

const LOCK_INTERVAL = 2 * 60 * 1000 // Set lock every two minutes while syncing

export default class NextcloudBookmarksAdapter implements Adapter, BulkImportResource, LoadFolderChildrenResource, OrderFolderResource {
  private server: NextcloudBookmarksConfig
  private fetchQueue: PQueue<{ concurrency: 12 }>
  private bookmarkLock: AsyncLock
  public hasFeatureHashing:boolean = null
  public hasFeatureExistenceCheck:boolean = null
  public hasFeatureChildren:boolean = null
  public hasFeatureBulkImport:boolean = null
  private list: Bookmark[]
  private tree: Folder
  private lockId: string | number
  private canceled = false
  private cancelCallback: () => void = null
  private lockingInterval: any
  private lockingPromise: Promise<boolean>
  private ended = false

  constructor(server: NextcloudBookmarksConfig) {
    this.server = server
    this.fetchQueue = new PQueue({ concurrency: 12 })
    this.bookmarkLock = new AsyncLock()
    this.hasFeatureHashing = false
    this.hasFeatureExistenceCheck = false
  }

  static getDefaultValues(): NextcloudBookmarksConfig {
    return {
      type: 'nextcloud-bookmarks',
      url: 'https://example.org',
      username: 'bob',
      password: 's3cret',
      serverRoot: '',
      includeCredentials: false,
      allowRedirects: false,
      allowNetwork: false,
    }
  }

  setData(data:NextcloudBookmarksConfig):void {
    this.server = { ...data }
  }

  getData():NextcloudBookmarksConfig {
    return { ...NextcloudBookmarksAdapter.getDefaultValues(), ...this.server }
  }

  getLabel():string {
    const data = this.getData()
    return data.username.includes('@') ? data.username + ' on ' + new URL(data.url).hostname : data.username + '@' + new URL(data.url).hostname
  }

  acceptsBookmark(bm: Bookmark):boolean {
    try {
      return Boolean(~['https:', 'http:', 'ftp:'].indexOf(new URL(bm.url).protocol))
    } catch (e) {
      return false
    }
  }

  normalizeServerURL(input:string):string {
    const serverURL = new URL(input)
    const indexLoc = serverURL.pathname.indexOf('index.php')
    if (!serverURL.pathname) serverURL.pathname = ''
    serverURL.search = ''
    serverURL.hash = ''
    serverURL.pathname = serverURL.pathname.substring(0, ~indexLoc ? indexLoc : undefined)
    const output = serverURL.toString()
    return output + (output[output.length - 1] !== '/' ? '/' : '')
  }

  timeout(ms) {
    return new Promise((resolve, reject) => {
      setTimeout(resolve, ms)
      this.cancelCallback = () => reject(new InterruptedSyncError())
    })
  }

  async onSyncStart(needLock = true): Promise<void> {
    if (Capacitor.getPlatform() === 'web') {
      const browser = (await import('../browser-api')).default
      let hasPermissions
      try {
        hasPermissions = await browser.permissions.contains({ origins: [this.server.url + '/'] })
      } catch (e) {
        console.warn(e)
      }
      if (!hasPermissions) {
        throw new MissingPermissionsError()
      }
    }

    if (needLock) {
      if (!(await this.acquireLock())) {
        throw new ResourceLockedError()
      }
    }

    this.canceled = false
    this.ended = false
    this.lockingInterval = setInterval(() => !this.ended && this.acquireLock(), LOCK_INTERVAL)
  }

  async onSyncComplete(): Promise<void> {
    this.ended = true
    clearInterval(this.lockingInterval)
    await this.releaseLock()
  }

  async onSyncFail(): Promise<void> {
    this.ended = true
    clearInterval(this.lockingInterval)
    await this.releaseLock()
  }

  cancel() {
    this.canceled = true
    this.fetchQueue.clear()
    this.cancelCallback && this.cancelCallback()
  }

  async getBookmarksList():Promise<Bookmark[]> {
    return this.bookmarkLock.acquire('list', async() => {
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
          throw new UnexpectedServerResponseError()
        }
        data = data.concat(json.data)
        i++
      } while (json.data.length === PAGE_SIZE)

      const bookmarks = flatten(
        data.map((bm) => {
          const bookmark = {
            id: bm.id as number | string,
            url: bm.url as string,
            title: bm.title as string,
            parentId: null,
            location: ItemLocation.SERVER,
          }

          return bm.folders.map((parentId) => {
            const b = { ...bookmark }
            b.parentId = parentId
            return new Bookmark(b)
          })
        })
      )

      Logger.log('Received bookmarks from server', bookmarks)
      this.list = bookmarks
      return bookmarks
    })
  }

  async getBookmarksTree(loadAll = false):Promise<Folder> {
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
      json = hashResponse.data
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

  async _getChildOrder(folderId:string|number, layers:number):Promise<IChildOrderItem[]> {
    const childrenOrderJson = await this.sendRequest(
      'GET',
      `index.php/apps/bookmarks/public/rest/v2/folder/${folderId}/childorder` +
        (layers ? `?layers=${layers}` : '')
    )
    if (!Array.isArray(childrenOrderJson.data)) {
      throw new UnexpectedServerResponseError()
    }
    return childrenOrderJson.data
  }

  async _getChildFolders(folderId:string|number, layers = 0):Promise<IChildFolder[]> {
    const folderJson = await this.sendRequest(
      'GET',
      `index.php/apps/bookmarks/public/rest/v2/folder?root=${folderId}&layers=${layers}`
    )
    if (!Array.isArray(folderJson.data)) {
      throw new UnexpectedServerResponseError()
    }
    return folderJson.data
  }

  async _findServerRoot():Promise<Folder> {
    let tree = new Folder({ id: -1, location: ItemLocation.SERVER })
    let childFolders
    await Parallel.each(
      this.server.serverRoot.split('/').slice(1),
      async(segment) => {
        childFolders = (tree.children && tree.children.length) ? tree.children : (await this._getChildFolders(tree.id))
        let currentChild = childFolders.find(
          (folder) => folder.title === segment
        )
        if (!currentChild) {
          // create folder
          const body = {
            parent_folder: tree.id,
            title: segment,
          }
          const json = await this.sendRequest(
            'POST',
            'index.php/apps/bookmarks/public/rest/v2/folder',
            'application/json',
            body
          )
          if (typeof json.item !== 'object') {
            throw new UnexpectedServerResponseError()
          }
          currentChild = { id: json.item.id, children: [], title: json.item.title }
        }
        tree = new Folder({ id: currentChild.id, title: currentChild.title, location: ItemLocation.SERVER })
      },
      1
    )
    return tree
  }

  async getCompleteBookmarksTree():Promise<Folder> {
    let tree = new Folder({ id: -1, location: ItemLocation.SERVER })
    if (this.server.serverRoot) {
      tree = await this._findServerRoot()
    }

    tree.children = await this._getChildren(tree.id, -1)
    this.tree = tree
    return tree.clone()
  }

  async getSparseBookmarksTree() :Promise<Folder> {
    this.hasFeatureHashing = true
    this.hasFeatureExistenceCheck = true

    let tree = new Folder({ id: -1, location: ItemLocation.SERVER })

    if (this.server.serverRoot) {
      tree = await this._findServerRoot()
    }

    this.list = null
    tree.loaded = false
    tree.hashValue = { true: await this._getFolderHash(tree.id) }
    this.tree = tree.clone(true) // we clone (withHash), so we can mess with our own version
    return tree
  }

  async _getFolderHash(folderId:string|number):Promise<string> {
    return this.sendRequest(
      'GET',
      `index.php/apps/bookmarks/public/rest/v2/folder/${folderId}/hash`
    )
      .catch(() => {
        return { data: '0' } // fallback
      })
      .then((json) => {
        return json.data
      })
  }

  async _getChildren(folderId:string|number, layers:number):Promise<TItem[]> {
    let childrenJson
    if (
      this.hasFeatureChildren === null ||
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
        return children.map((item) => {
          if (item.type === 'bookmark') {
            return new Bookmark({
              id: item.id + ';' + folderId,
              title: item.title,
              parentId: folderId,
              url: item.url,
              location: ItemLocation.SERVER,
            })
          } else if (item.type === 'folder') {
            const childFolder = new Folder({
              id: item.id,
              parentId: folderId,
              title: item.title,
              location: ItemLocation.SERVER,
            })
            childFolder.loaded = Boolean(item.children) // not children.length but whether the whole children field exists
            childFolder.children = recurseChildren(item.id, item.children || [])
            return childFolder
          }
        })
      }
      return recurseChildren(folderId, children).filter(item => String(item.id) !== String(this.lockId))
    } else {
      // We don't have the children endpoint available, so we have to query all bookmarks that exist :(
      await this.getBookmarksList()

      const tree = new Folder({id: folderId, location: ItemLocation.SERVER})
      const [childrenOrder, childFolders, childBookmarks] = await Promise.all([
        this._getChildOrder(folderId, layers),
        this._getChildFolders(folderId, layers),
        Promise.resolve().then(
          () =>
            this.list ||
            this.sendRequest(
              'GET',
              `index.php/apps/bookmarks/public/rest/v2/bookmark?folder=${folderId}&page=-1`
            ).then((json) => json.data)
        ),
      ])
      const recurseChildFolders = async(tree:Folder, childFolders:IChildFolder[], childrenOrder:IChildOrderItem[], childBookmarks:any[], layers:number) => {
        const folders = await Parallel.map(
          childrenOrder,
          async(child) => {
            if (child.type === 'folder') {
              // get the folder from the tree we've fetched above
              const folder = childFolders.find((folder) => String(folder.id) === String(child.id))
              if (!folder) throw new InconsistentServerStateError()
              const newFolder = new Folder({
                id: child.id,
                title: folder.title,
                parentId: tree.id,
                loaded: false,
                location: ItemLocation.SERVER,
              })
              tree.children.push(newFolder)
              return { newFolder, child, folder}
            } else {
              // get the bookmark from the list we've fetched above
              // which might either be Bookmark[] or a raw bookmark list response with no parentId but a folders array
              let childBookmark = childBookmarks.find(
                (bookmark) =>
                  String(bookmark.id) === String(child.id) &&
                  (!bookmark.parentId || String(bookmark.parentId) === String(tree.id))
              )
              if (!childBookmark) {
                throw new InconsistentBookmarksExistenceError(
                  `#${tree.id}[${tree.title}]`,
                  String(child.id)
                )
              }
              if (!(childBookmark instanceof Bookmark)) {
                childBookmark = new Bookmark(childBookmark)
              }
              childBookmark = childBookmark.clone()
              childBookmark.id = childBookmark.id + ';' + tree.id
              childBookmark.parentId = tree.id
              tree.children.push(childBookmark)
            }
          },
          1
        )
        tree.loaded = true
        if (layers === 0) {
          return
        }

        const nextLayer = layers < 0 ? -1 : layers - 1
        await Parallel.each(
          folders.filter(Boolean),
          async({ newFolder, child, folder}) => {
            if (typeof child.children === 'undefined') {
              child.children = await this._getChildOrder(child.id, nextLayer)
            }
            if (typeof folder.children === 'undefined') {
              folder.children = await this._getChildFolders(folder.id, nextLayer)
            }
            const childBookmarks = this.list ||
            await this.sendRequest(
              'GET',
              `index.php/apps/bookmarks/public/rest/v2/bookmark?folder=${newFolder.id}&page=-1`
            ).then((json) => json.data)

            // ... and recurse
            return recurseChildFolders(newFolder, folder.children, child.children, childBookmarks, nextLayer)
          },
          3
        )
      }
      await recurseChildFolders(tree, childFolders, childrenOrder, childBookmarks, layers)
      return tree.children.filter(item => String(item.id) !== String(this.lockId))
    }
  }

  async loadFolderChildren(folderId:string|number, all?: boolean): Promise<TItem[]> {
    if (!this.hasFeatureHashing) {
      return
    }
    const folder = this.tree.findFolder(folderId)
    if (!folder) {
      throw new Error('Could not find folder for loadFolderChildren')
    }
    if (folder.loaded) {
      return folder.clone(true).children
    }
    let children
    if (all) {
      children = await this._getChildren(folderId, -1)
    } else {
      children = await this._getChildren(folderId, 1)
      const recurse = async(children) => {
        return Parallel.each(children, async(child) => {
          if (!(child instanceof Folder)) {
            return
          }
          if (!child.loaded) {
            const folderHash = await this._getFolderHash(child.id)
            child.hashValue = { true: folderHash }
          }
          await recurse(child.children)
        })
      }
      await recurse(children)
    }
    folder.children = children
    folder.loaded = true
    this.tree.createIndex()
    return folder.clone(true).children
  }

  async createFolder(folder:Folder):Promise<string|number> {
    Logger.log('(nextcloud-folders)CREATEFOLDER', {folder})
    const parentId = folder.parentId
    const title = folder.title

    const parentFolder = this.tree.findFolder(parentId)
    if (!parentFolder) {
      throw new UnknownCreateTargetError()
    }
    const body = {
      parent_folder: parentId,
      title: title,
    }
    const json = await this.sendRequest(
      'POST',
      'index.php/apps/bookmarks/public/rest/v2/folder',
      'application/json',
      body
    )
    if (typeof json.item !== 'object') {
      throw new UnexpectedServerResponseError()
    }

    parentFolder.children.push(
      new Folder({ id: json.item.id, title, parentId, location: ItemLocation.SERVER })
    )
    this.tree.createIndex()
    return json.item.id
  }

  async bulkImportFolder(parentId:string|number, folder:Folder):Promise<Folder> {
    if (this.hasFeatureBulkImport === false) {
      throw new Error('Current server does not support bulk import')
    }
    if (folder.count() > 75) {
      throw new Error('Refusing to bulk import more than 300 bookmarks')
    }
    Logger.log('(nextcloud-folders)BULKIMPORT', { parentId, folder })
    const parentFolder = this.tree.findFolder(parentId)
    if (!parentFolder) {
      throw new UnknownCreateTargetError()
    }
    const blob = new Blob(
      [
        '<!DOCTYPE NETSCAPE-Bookmark-file-1>\n',
        '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">\n',
        HtmlSerializer.serialize(folder),
      ],
      {
        type: 'text/html',
      }
    )

    const body = new FormData()
    body.append('bm_import', blob, 'upload.html')

    let json
    try {
      json = await this.sendRequest(
        'POST',
        `index.php/apps/bookmarks/public/rest/v2/folder/${parentId}/import`,
        'multipart/form-data',
        body
      )
    } catch (e) {
      this.hasFeatureBulkImport = false
      throw e
    }

    const recurseChildren = (children, id, title, parentId) => {
      return new Folder({
        id,
        title,
        parentId,
        location: ItemLocation.SERVER,
        children: children.map((item) => {
          if (item.type === 'bookmark') {
            return new Bookmark({
              id: item.id + ';' + id,
              title: item.title,
              url: item.url,
              parentId: id,
              location: ItemLocation.SERVER,
            })
          } else if (item.type === 'folder') {
            return recurseChildren(item.children, item.id, item.title, id)
          } else {
            console.log('PEBCAK', item)
            throw new Error('PEBKAC')
          }
        }),
      })
    }
    const imported = recurseChildren(json.data, parentId, folder.title, folder.parentId)
    parentFolder.children = imported.clone(true).children
    this.tree.createIndex()
    return imported
  }

  async updateFolder(folder:Folder):Promise<void> {
    Logger.log('(nextcloud-folders)UPDATEFOLDER', { folder })
    const id = folder.id
    const oldFolder = this.tree.findFolder(folder.id)
    if (!oldFolder) {
      throw new UnknownFolderUpdateError()
    }
    if (oldFolder.findFolder(folder.parentId)) {
      throw new Error('Detected folder loop creation')
    }
    const body = {
      parent_folder: folder.parentId,
      title: folder.title,
    }
    await this.sendRequest(
      'PUT',
      `index.php/apps/bookmarks/public/rest/v2/folder/${id}`,
      'application/json',
      body
    )
    const oldParentFolder = this.tree.findFolder(oldFolder.parentId)
    if (!oldParentFolder) {
      throw new UnknownFolderParentUpdateError()
    }
    oldParentFolder.children = oldParentFolder.children.filter(
      (child) => String(child.id) !== String(id)
    )
    const newParentFolder = this.tree.findFolder(folder.parentId)
    if (!newParentFolder) {
      throw new UnknownMoveTargetError()
    }
    newParentFolder.children.push(oldFolder)
    oldFolder.title = folder.title
    oldFolder.parentId = folder.parentId
    this.tree.createIndex()
  }

  async orderFolder(id:string|number, order:Ordering):Promise<void> {
    Logger.log('(nextcloud-folders)ORDERFOLDER', { id, order })
    const body = {
      data: order.map((item) => ({
        id: String(item.id).split(';')[0],
        type: item.type,
      })),
    }
    await this.sendRequest(
      'PATCH',
      `index.php/apps/bookmarks/public/rest/v2/folder/${id}/childorder`,
      'application/json',
      body
    )
  }

  async removeFolder(folder:Folder):Promise<void> {
    Logger.log('(nextcloud-folders)REMOVEFOLDER', { folder })
    const id = folder.id
    const oldFolder = this.tree.findFolder(id)
    if (!oldFolder) {
      return
    }
    await this.sendRequest(
      'DELETE',
      `index.php/apps/bookmarks/public/rest/v2/folder/${id}`
    )
    const parent = this.tree.findFolder(oldFolder.parentId)
    if (parent) {
      parent.children = parent.children.filter(
        (child) => String(child.id) !== String(id)
      )
      this.tree.createIndex()
    }
  }

  async _getBookmark(id:string|number):Promise<Bookmark[]> {
    Logger.log('Fetching single bookmark')

    const json = await this.sendRequest(
      'GET',
      'index.php/apps/bookmarks/public/rest/v2/bookmark/' + id
    )
    if (typeof json.item !== 'object') {
      throw new UnexpectedServerResponseError()
    }

    const bm = json.item
    if (!bm.folders.length) {
      bm.folders = [null]
    }
    return bm.folders.map((parentId) => {
      return new Bookmark({
        id: bm.id + ';' + parentId,
        url: bm.url,
        title: bm.title,
        parentId: parentId,
        tags: bm.tags,
        location: ItemLocation.SERVER,
      })
    })
  }

  /*
   * This is pretty expensive! We need to wait until NcBookmarks has support for
   * querying urls directly
   */
  async getExistingBookmark(url:string):Promise<false|Bookmark> {
    if (this.hasFeatureExistenceCheck) {
      const json = await this.sendRequest(
        'GET',
        `index.php/apps/bookmarks/public/rest/v2/bookmark?url=${encodeURIComponent(
          url
        )}`
      )
      if (json.data.length) {
        return {...json.data[0], parentId: json.data[0].folders[0]}
      } else {
        return false
      }
    } else {
      await this.getBookmarksList()
      const existing = this.list.find((bookmark) => bookmark.url === url)
      if (!existing) return false
      return existing
    }
  }

  async createBookmark(bm:Bookmark):Promise<string|number> {
    Logger.log('(nextcloud-folders)CREATE', bm)

    // We need this lock to avoid creating two boomarks with the same url
    // in parallel
    return this.bookmarkLock.acquire(bm.url, async() => {
      const existingBookmark = await this.getExistingBookmark(bm.url)
      if (existingBookmark) {
        bm.id = existingBookmark.id + ';' + bm.parentId // We already use the new parentId here, to avoid moving it away from the old location
        const updatedBookmark = bm.clone()
        updatedBookmark.title = existingBookmark.title
        await this.updateBookmark(updatedBookmark)
      } else {
        const body = {
          url: bm.url,
          title: bm.title,
          folders: [bm.parentId],
        }

        let json
        try {
          json = await this.sendRequest(
            'POST',
            'index.php/apps/bookmarks/public/rest/v2/bookmark',
            'application/json',
            body
          )
        } catch (e) {
          if (e instanceof HttpError) {
            throw new CreateBookmarkError(bm)
          }
          throw e
        }
        if (typeof json.item !== 'object') {
          throw new UnexpectedServerResponseError()
        }
        bm.id = json.item.id + ';' + bm.parentId
      }
      // add bookmark to cached list
      const upstreamMark = bm.clone()
      upstreamMark.id = bm.id.split(';')[0]
      this.list && this.list.push(upstreamMark)
      this.tree.findFolder(bm.parentId).children.push(upstreamMark)
      this.tree.createIndex()

      return bm.id
    })
  }

  async updateBookmark(newBm:Bookmark):Promise<void> {
    Logger.log('(nextcloud-folders)UPDATE', newBm)

    const [upstreamId, oldParentId] = String(newBm.id).split(';')

    // We need this lock to avoid updating bookmarks which are in two places at Once
    // in parallel
    return this.bookmarkLock.acquire(upstreamId, async() => {
      const bms = await this._getBookmark(upstreamId)

      const body = {
        url: newBm.url,
        title: newBm.title,
        folders: bms
          .map((bm) => bm.parentId)
          .filter(
            (parentId) =>
              parentId && String(parentId) !== String(oldParentId) &&
              // make sure this is not an outdated oldParentId (can happen due to canMergeWith in Scanner)
              (!this.tree.findFolder(parentId) || this.tree.findFolder(parentId).findItemFilter('bookmark', i => i.canMergeWith(newBm)) || !this.tree.findFolder(parentId).loaded)
          )
          .concat([newBm.parentId]),
        tags: bms[0].tags,
      }

      await this.sendRequest(
        'PUT',
        `index.php/apps/bookmarks/public/rest/v2/bookmark/${upstreamId}`,
        'application/json',
        body
      )

      const newFolder = this.tree.findFolder(newBm.parentId)
      if (!newFolder.children.find(item => String(item.id) === String(newBm.id) && item.type === 'bookmark')) {
        newFolder.children.push(newBm)
      }
      newBm.id = upstreamId + ';' + newBm.parentId
      this.tree.createIndex()

      return newBm.id
    })
  }

  async removeBookmark(bookmark:Bookmark):Promise<void> {
    Logger.log('(nextcloud-folders)REMOVE', { bookmark })
    const id = bookmark.id
    const [upstreamId, parentId] = String(id).split(';')

    // Just to be safe
    return this.bookmarkLock.acquire(upstreamId, async() => {
      try {
        await this.sendRequest(
          'DELETE',
          `index.php/apps/bookmarks/public/rest/v2/folder/${parentId}/bookmarks/${upstreamId}`
        )
        // remove bookmark from the cached list
        const list = await this.getBookmarksList()
        const listIndex = list.findIndex(
          (bookmark) => String(bookmark.id) === String(upstreamId)
        )
        list.splice(listIndex, 1)
      } catch (e) {
        Logger.log('Error removing bookmark from folder: ' + e.message + '\n Moving on.')
      }
    })
  }

  async sendRequest(verb:string, relUrl:string, type:string = null, body:any = null, returnRawResponse = false):Promise<any> {
    const url = this.normalizeServerURL(this.server.url) + relUrl
    let res
    let timedOut = false

    if (type && type.includes('application/json')) {
      body = JSON.stringify(body)
    } else if (type && type.includes('application/x-www-form-urlencoded')) {
      const params = new URLSearchParams()
      for (const [key, value] of Object.entries(body || {})) {
        params.set(key, value as any)
      }
      body = params.toString()
    }

    Logger.log(`QUEUING ${verb} ${url}`)

    if (Capacitor.getPlatform() !== 'web') {
      return this.sendRequestNative(verb, url, type, body, returnRawResponse)
    }

    const authString = Base64.encode(
      this.server.username + ':' + this.server.password
    )

    try {
      res = await this.fetchQueue.add(() => {
        Logger.log(`FETCHING ${verb} ${url}`)
        return Promise.race([
          fetch(url, {
            method: verb,
            credentials: this.server.includeCredentials ? 'include' : 'omit',
            headers: {
              ...(type && type !== 'multipart/form-data' && { 'Content-type': type }),
              Authorization: 'Basic ' + authString,
            },
            ...(body && !['get', 'head'].includes(verb.toLowerCase()) && { body }),
          }),
          new Promise((resolve, reject) =>
            setTimeout(() => {
              timedOut = true
              reject(new RequestTimeoutError())
            }, TIMEOUT)
          ),
        ])
      })
    } catch (e) {
      if (timedOut) throw e
      console.log(e)
      throw new NetworkError()
    }

    Logger.log(`Receiving response for ${verb} ${url}`)

    if (res.redirected && !this.server.allowRedirects) {
      throw new RedirectError()
    }

    if (returnRawResponse) {
      return res
    }

    if (res.status === 401 || res.status === 403) {
      throw new AuthenticationError()
    }
    if (res.status === 503 || res.status > 400) {
      throw new HttpError(res.status, verb)
    }
    let json
    try {
      json = await res.json()
    } catch (e) {
      throw new ParseResponseError(e.message)
    }
    if (json.status !== 'success') {
      throw new Error('Nextcloud API error: \n' + JSON.stringify(json))
    }

    return json
  }

  private async acquireLock():Promise<boolean> {
    this.lockingPromise = (async() => {
      const res = await this.sendRequest(
        'POST',
        'index.php/apps/bookmarks/public/rest/v2/lock',
        null,
        null,
        true
      )

      if (res.status === 401 || res.status === 403) {
        throw new AuthenticationError()
      }
      if (res.status !== 200 && res.status !== 405 && res.status !== 423) {
        throw new HttpError(res.status, 'POST')
      }

      return res.status === 200 || res.status === 405
    })()
    return this.lockingPromise
  }

  private async releaseLock():Promise<boolean> {
    if (this.lockingPromise) {
      await this.lockingPromise
    }
    const res = await this.sendRequest(
      'DELETE',
      'index.php/apps/bookmarks/public/rest/v2/lock',
      null,
      null,
      true
    )

    return res.status === 200
  }

  private async sendRequestNative(verb: string, url: string, type: string, body: any, returnRawResponse: boolean) {
    let res
    let timedOut = false
    const authString = Base64.encode(
      this.server.username + ':' + this.server.password
    )
    try {
      res = await this.fetchQueue.add(() => {
        Logger.log(`FETCHING ${verb} ${url}`)
        return Promise.race([
          Http.request({
            url,
            method: verb,
            disableRedirects: !this.server.allowRedirects,
            headers: {
              ...(type && type !== 'multipart/form-data' && { 'Content-type': type }),
              Authorization: 'Basic ' + authString,
            },
            responseType: 'json',
            ...(body && !['get', 'head'].includes(verb.toLowerCase()) && { data: body }),
          }),
          new Promise((resolve, reject) =>
            setTimeout(() => {
              timedOut = true
              reject(new RequestTimeoutError())
            }, TIMEOUT)
          ),
        ])
      })
    } catch (e) {
      if (timedOut) throw e
      console.log(e)
      throw new NetworkError()
    }

    Logger.log(`Receiving response for ${verb} ${url}`)

    if (res.status < 400 && res.status >= 300) {
      throw new RedirectError()
    }

    if (returnRawResponse) {
      return res
    }

    if (res.status === 401 || res.status === 403) {
      throw new AuthenticationError()
    }
    if (res.status === 503 || res.status > 400) {
      throw new HttpError(res.status, verb)
    }
    const json = res.data
    if (json.status !== 'success') {
      throw new Error('Nextcloud API error: \n' + JSON.stringify(json))
    }

    return json
  }

  isAvailable(): Promise<boolean> {
    return Promise.resolve(true)
  }
}
