import Adapter from '../interfaces/Adapter'
import { Bookmark, Folder, ItemLocation } from '../Tree'
import PQueue from 'p-queue'
import { IResource } from '../interfaces/Resource'
import Logger from '../Logger'
import {
  AuthenticationError,
  CancelledSyncError,
  HttpError,
  NetworkError,
  ParseResponseError,
  RedirectError,
  RequestTimeoutError,
} from '../../errors/Error'
import { Capacitor, CapacitorHttp as Http } from '@capacitor/core'

export interface KarakeepConfig {
  type: 'karakeep'
  url: string
  password: string
  serverFolder: string
  includeCredentials?: boolean
  allowRedirects?: boolean
  allowNetwork?: boolean
  label?: string
}

const TIMEOUT = 300000

export default class KarakeepAdapter
  implements Adapter, IResource<typeof ItemLocation.SERVER>
{
  private server: KarakeepConfig
  private fetchQueue: PQueue
  private abortController: AbortController
  private abortSignal: AbortSignal
  private canceled: boolean

  constructor(server: KarakeepConfig) {
    this.server = server
    this.fetchQueue = new PQueue({ concurrency: 12 })
    this.abortController = new AbortController()
    this.abortSignal = this.abortController.signal
  }

  static getDefaultValues(): KarakeepConfig {
    return {
      type: 'karakeep',
      url: 'https://example.org',
      password: 's3cret',
      serverFolder: 'Floccus',
      includeCredentials: false,
      allowRedirects: false,
      allowNetwork: false,
    }
  }

  parseBookmarkId(id: string | number): [string, string] {
    if (typeof id === 'number') {
      throw new Error('IDs should be strings')
    }
    const s = id.split(';')
    return [s[0], s[1]]
  }

  acceptsBookmark(bm: Bookmark<typeof ItemLocation.SERVER>): boolean {
    try {
      return ['https:', 'http:'].includes(new URL(bm.url).protocol)
    } catch (e) {
      return false
    }
  }

  cancel(): void {
    this.canceled = true
    this.abortController.abort()
  }

  setData(data: KarakeepConfig): void {
    this.server = { ...data }
  }

  getData(): KarakeepConfig {
    return { ...KarakeepAdapter.getDefaultValues(), ...this.server }
  }

  getLabel(): string {
    const data = this.getData()
    return data.label || new URL(data.url).hostname
  }

  onSyncComplete(): Promise<void> {
    return Promise.resolve(undefined)
  }

  onSyncFail(): Promise<void> {
    return Promise.resolve(undefined)
  }

  onSyncStart(
    needLock?: boolean,
    forceLock?: boolean
  ): Promise<void | boolean> {
    this.canceled = false
    return Promise.resolve(undefined)
  }

  async createBookmark(bookmark: {
    id: string | number
    url: string
    title: string
    parentId: string | number
  }): Promise<string | number> {
    Logger.log('(karakeep)CREATE', { bookmark })
    const response = await this.sendRequest(
      'POST',
      '/api/v1/bookmarks',
      'application/json',
      {
        type: 'link',
        url: bookmark.url,
        title: bookmark.title,
      }
    )
    if (response.alreadyExists) {
      await this.sendRequest(
        'PATCH',
        `/api/v1/bookmarks/${response.id}`,
        'application/json',
        {
          title: bookmark.title,
        }
      )
    }
    await this.sendRequest(
      'PUT',
      `/api/v1/lists/${bookmark.parentId}/bookmarks/${response.id}`,
      'application/json',
      undefined,
      /* returnRawResponse */ true
    )
    return `${response.id};${bookmark.parentId}`
  }

  async updateBookmark(bookmark: {
    id: string | number
    url: string
    title: string
    parentId: string | number
  }): Promise<void> {
    Logger.log('(karakeep)UPDATE', { bookmark })
    const [id, oldParentId] = this.parseBookmarkId(bookmark.id)
    await this.sendRequest(
      'PATCH',
      `/api/v1/bookmarks/${id}`,
      'application/json',
      {
        url: bookmark.url,
        title: bookmark.title,
      }
    )

    if (oldParentId !== bookmark.parentId) {
      await Promise.all([
        this.sendRequest(
          'DELETE',
          `/api/v1/lists/${oldParentId}/bookmarks/${id}`,
          'application/json',
          undefined,
          /* returnRawResponse */ true
        ),
        this.sendRequest(
          'PUT',
          `/api/v1/lists/${bookmark.parentId}/bookmarks/${id}`,
          'application/json',
          undefined,
          /* returnRawResponse */ true
        ),
      ])
    }
    bookmark.id = `${id};${bookmark.parentId}`
  }

  async removeBookmark(bookmark: {
    id: string | number
    parentId: string | number
  }): Promise<void> {
    Logger.log('(karakeep)DELETE', { bookmark })

    const [id, parentId] = this.parseBookmarkId(bookmark.id)

    // Remove the bookmark from the list
    await this.sendRequest(
      'DELETE',
      `/api/v1/lists/${parentId}/bookmarks/${id}`,
      'application/json',
      undefined,
      /* returnRawResponse */ true
    )

    // If the bookmark is not in any list, delete it from the server
    const bookmarkLists = await this.getListsOfBookmark(id)
    if (bookmarkLists.size === 0) {
      await this.sendRequest(
        'DELETE',
        `/api/v1/bookmarks/${id}`,
        'application/json',
        undefined,
        /* returnRawResponse */ true
      )
    }
  }

  async createFolder(folder: {
    id: string | number
    title?: string
    parentId: string | number
  }): Promise<string | number> {
    Logger.log('(karakeep)CREATEFOLDER', { folder })
    const response = await this.sendRequest(
      'POST',
      '/api/v1/lists',
      'application/json',
      {
        name: folder.title,
        icon: '📔',
        type: 'manual',
        parentId: folder.parentId,
      }
    )
    return response.id
  }

  async updateFolder(folder: {
    id: string | number
    title?: string
    parentId: string | number
  }): Promise<void> {
    Logger.log('(karakeep)UPDATEFOLDER', { folder })
    await this.sendRequest(
      'PATCH',
      `/api/v1/lists/${folder.id}`,
      'application/json',
      {
        name: folder.title,
        parentId: folder.parentId,
      }
    )
  }

  /**
   * Removes the list from karakeep, but also all its content recursively
   */
  async removeFolder(folder: { id: string | number }): Promise<void> {
    Logger.log('(karakeep)DELETEFOLDER', { folder })

    const deleteListContent = async () => {
      // Get the list of bookmarks in the list
      const bookmarkIds = []
      let nextCursor = null
      do {
        let response = await this.sendRequest(
          'GET',
          `/api/v1/lists/${folder.id}/bookmarks?includeContent=false&${
            nextCursor ? 'cursor=' + nextCursor : ''
          }`
        )
        nextCursor = response.nextCursor
        bookmarkIds.push(...response.bookmarks.map((b) => b.id))
      } while (nextCursor !== null)
      await Promise.all(
        bookmarkIds.map((id) =>
          this.removeBookmark({
            id: `${id};${folder.id}`,
            parentId: folder.id,
          })
        )
      )
    }

    const deleteListFolders = async () => {
      // Get the list of lists in the list
      const { lists } = await this.sendRequest('GET', `/api/v1/lists`)
      let childrenListIds = lists
        .filter((list) => list.parentId === folder.id)
        .map((l) => l.id)

      await Promise.all(
        childrenListIds.map((listId) =>
          this.removeFolder({
            id: listId,
          })
        )
      )
    }

    await Promise.all([deleteListContent(), deleteListFolders()])

    // Delete the list itself "after" deleting all its content in case any failure occurs in the previous steps
    await this.sendRequest(
      'DELETE',
      `/api/v1/lists/${folder.id}`,
      'application/json',
      undefined,
      /* returnRawResponse */ true
    )
  }

  async getBookmarksTree(
    loadAll?: boolean
  ): Promise<Folder<typeof ItemLocation.SERVER>> {
    const fetchBookmarks = async (listId: string) => {
      const links = []
      let nextCursor = null
      do {
        let response = await this.sendRequest(
          'GET',
          `/api/v1/lists/${listId}/bookmarks?includeContent=false&${
            nextCursor ? 'cursor=' + nextCursor : ''
          }`
        )
        nextCursor = response.nextCursor
        links.push(...response.bookmarks)
      } while (nextCursor !== null)
      return links
    }

    const { lists } = await this.sendRequest('GET', `/api/v1/lists`)

    let rootList = lists.find(
      (list) => list.name === this.server.serverFolder && list.parentId === null
    )
    if (!rootList) {
      rootList = await this.sendRequest(
        'POST',
        '/api/v1/lists',
        'application/json',
        {
          name: this.server.serverFolder,
          icon: '📔',
          type: 'manual',
        }
      )
    }
    const rootId = rootList.id

    const listIdtoList = {
      [rootId]: rootList,
    }
    lists.forEach((list) => {
      listIdtoList[list.id] = list
    })

    const listTree: Record<string, string[]> = {
      [rootId]: [],
      ...lists.reduce((acc, list) => {
        acc[list.id] = []
        return acc
      }, {}),
    }
    lists.forEach((list) => {
      if (list.parentId === null) {
        return
      }
      listTree[list.parentId].push(list.id)
    })

    const buildTree = async (listId, isRoot = false) => {
      const list = listIdtoList[listId]

      const childrenBookmarks = (await fetchBookmarks(listId))
        .filter((b) => b.content.type === 'link')
        .map(
          (b) =>
            new Bookmark({
              id: `${b.id};${listId}`,
              title: b.title ?? b.content.title,
              parentId: listId,
              url: b.content.url,
              location: ItemLocation.SERVER,
            })
        )
      const childrenFolders = await Promise.all(
        listTree[listId].map((l) => buildTree(l, false))
      )

      return new Folder({
        id: list.id,
        title: list.name,
        parentId: list.parentId,
        location: ItemLocation.SERVER,
        isRoot,
        children: [...childrenFolders, ...childrenBookmarks],
      })
    }

    return await buildTree(rootId, true)
  }

  async getListsOfBookmark(bookmarkId: string | number): Promise<Set<string>> {
    const { lists } = await this.sendRequest(
      'GET',
      `/api/v1/bookmarks/${bookmarkId}/lists`
    )

    return new Set<string>(lists.map((list) => list.id))
  }

  async isAvailable(): Promise<boolean> {
    return true
  }

  async sendRequest(
    verb: string,
    relUrl: string,
    type: string = null,
    body: any = null,
    returnRawResponse = false
  ): Promise<any> {
    const url = this.server.url + relUrl
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

    try {
      res = await this.fetchQueue.add(() => {
        Logger.log(`FETCHING ${verb} ${url}`)
        return Promise.race([
          fetch(url, {
            method: verb,
            credentials: this.server.includeCredentials ? 'include' : 'omit',
            headers: {
              ...(type &&
                type !== 'multipart/form-data' && { 'Content-type': type }),
              Authorization: 'Bearer ' + this.server.password,
            },
            signal: this.abortSignal,
            ...(body &&
              !['get', 'head'].includes(verb.toLowerCase()) && { body }),
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
      if (this.canceled) throw new CancelledSyncError()
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

    if (res.status === 403) {
      throw new AuthenticationError()
    }
    if (res.status === 503 || res.status >= 400) {
      throw new HttpError(res.status, verb)
    }
    let json
    try {
      json = await res.json()
    } catch (e) {
      throw new ParseResponseError(e.message)
    }

    return json
  }

  private async sendRequestNative(
    verb: string,
    url: string,
    type: string,
    body: any,
    returnRawResponse: boolean
  ) {
    let res
    let timedOut = false
    try {
      res = await this.fetchQueue.add(() => {
        Logger.log(`FETCHING ${verb} ${url}`)
        return Promise.race([
          Http.request({
            url,
            method: verb,
            disableRedirects: !this.server.allowRedirects,
            headers: {
              ...(type &&
                type !== 'multipart/form-data' && { 'Content-type': type }),
              Authorization: 'Bearer ' + this.server.password,
            },
            responseType: 'json',
            ...(body &&
              !['get', 'head'].includes(verb.toLowerCase()) && { data: body }),
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
    if (res.status === 503 || res.status >= 400) {
      throw new HttpError(res.status, verb)
    }
    const json = res.data

    return json
  }
}
