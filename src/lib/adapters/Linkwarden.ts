import Adapter from '../interfaces/Adapter'
import { Bookmark, Folder, ItemLocation } from '../Tree'
import PQueue from 'p-queue'
import { IResource } from '../interfaces/Resource'
import Logger from '../Logger'
import {
  AuthenticationError,
  CancelledSyncError, HttpError,
  NetworkError, ParseResponseError,
  RedirectError,
  RequestTimeoutError
} from '../../errors/Error'
import { Capacitor, CapacitorHttp as Http } from '@capacitor/core'

export interface LinkwardenConfig {
  type: 'linkwarden'
  url: string
  username: string
  password: string
  serverFolder: string,
  includeCredentials?: boolean
  allowRedirects?: boolean
  allowNetwork?: boolean
  label?: string
}

const TIMEOUT = 300000

export default class LinkwardenAdapter implements Adapter, IResource<typeof ItemLocation.SERVER> {
  private server: LinkwardenConfig
  private fetchQueue: PQueue
  private abortController: AbortController
  private abortSignal: AbortSignal
  private canceled: boolean

  constructor(server: LinkwardenConfig) {
    this.server = server
    this.fetchQueue = new PQueue({ concurrency: 12 })
    this.abortController = new AbortController()
    this.abortSignal = this.abortController.signal
  }

  static getDefaultValues(): LinkwardenConfig {
    return {
      type: 'linkwarden',
      url: 'https://example.org',
      username: 'bob',
      password: 's3cret',
      serverFolder: 'Floccus',
      includeCredentials: false,
      allowRedirects: false,
      allowNetwork: false,
    }
  }

  acceptsBookmark(bm: Bookmark<typeof ItemLocation.SERVER>):boolean {
    try {
      return ['https:', 'http:', 'ftp:', 'javascript:'].includes(new URL(bm.url).protocol)
    } catch (e) {
      return false
    }
  }

  cancel(): void {
    this.canceled = true
    this.abortController.abort()
  }

  setData(data:LinkwardenConfig):void {
    this.server = { ...data }
  }

  getData(): LinkwardenConfig {
    return { ...LinkwardenAdapter.getDefaultValues(), ...this.server }
  }

  getLabel(): string {
    const data = this.getData()
    return data.label || (data.username.includes('@') ? data.username + ' on ' + new URL(data.url).hostname : data.username + '@' + new URL(data.url).hostname)
  }

  onSyncComplete(): Promise<void> {
    return Promise.resolve(undefined)
  }

  onSyncFail(): Promise<void> {
    return Promise.resolve(undefined)
  }

  onSyncStart(needLock?: boolean, forceLock?: boolean): Promise<void | boolean> {
    this.canceled = false
    return Promise.resolve(undefined)
  }

  async createBookmark(bookmark: Bookmark<typeof ItemLocation.SERVER>): Promise<string | number> {
    Logger.log('(linkwarden)CREATE', {bookmark})
    const {response} = await this.sendRequest(
      'POST', '/api/v1/links',
      'application/json',
      {
        url: bookmark.url,
        name: bookmark.title,
        collection: {
          id: bookmark.parentId,
        },
      })
    return response.id
  }

  async updateBookmark(bookmark: Bookmark<typeof ItemLocation.SERVER>): Promise<void> {
    Logger.log('(linkwarden)UPDATE', {bookmark})
    const {response: collection} = await this.sendRequest('GET', `/api/v1/collections/${bookmark.parentId}`)
    await this.sendRequest(
      'PUT', `/api/v1/links/${bookmark.id}`,
      'application/json',
      {
        id: bookmark.id,
        url: bookmark.url,
        name: bookmark.title,
        tags: [],
        collection: {
          id: bookmark.parentId,
          name: collection.name,
          ownerId: collection.ownerId,
        },
      })
  }

  async removeBookmark(bookmark: Bookmark<typeof ItemLocation.SERVER>): Promise<void> {
    Logger.log('(linkwarden)DELETE', {bookmark})
    await this.sendRequest('DELETE', `/api/v1/links/${bookmark.id}`)
  }

  async createFolder(folder: Folder<typeof ItemLocation.SERVER>): Promise<string | number> {
    Logger.log('(linkwarden)CREATEFOLDER', {folder})
    const {response} = await this.sendRequest(
      'POST', '/api/v1/collections',
      'application/json',
      {
        name: folder.title,
        parentId: folder.parentId,
      })
    return response.id
  }

  async updateFolder(folder: Folder<typeof ItemLocation.SERVER>): Promise<void> {
    Logger.log('(linkwarden)UPDATEFOLDER', {folder})
    const {response: collection} = await this.sendRequest('GET', `/api/v1/collections/${folder.id}`)
    await this.sendRequest(
      'PUT', `/api/v1/collections/${folder.id}`,
      'application/json',
      {
        ...collection,
        name: folder.title,
        parentId: folder.parentId,
      })
  }

  async removeFolder(folder: Folder<typeof ItemLocation.SERVER>): Promise<void> {
    Logger.log('(linkwarden)DELETEFOLDER', {folder})
    let success = false
    let count = 0
    do {
      try {
        count++
        await this.sendRequest('DELETE', `/api/v1/collections/${folder.id}`)
        success = true
      } catch (e) {
        if (e instanceof HttpError && e.status === 401) {
          success = true
        } else if (count > 3) {
          throw e
        }
        // noop
      }
    } while (!success)
  }

  async getBookmarksTree(loadAll?: boolean): Promise<Folder<typeof ItemLocation.SERVER>> {
    const links = []
    let response
    do {
      ({ response } = await this.sendRequest('GET', `/api/v1/links?cursor=${links.length ? links[links.length - 1].id : ''}`))
      links.push(...response)
    } while (response.length !== 0)

    const { response: collections } = await this.sendRequest('GET', `/api/v1/collections`)

    let rootCollection = collections.find(collection => collection.name === this.server.serverFolder && collection.parentId === null)
    if (!rootCollection) {
      ({response: rootCollection} = await this.sendRequest(
        'POST', '/api/v1/collections',
        'application/json',
        {
          name: this.server.serverFolder,
        }))
    }

    const buildTree = (collection, isRoot = false) => {
      return new Folder({
        id: collection.id,
        title: collection.name,
        parentId: collection.parentId,
        location: ItemLocation.SERVER,
        isRoot,
        children: collections
          .filter(col => col.parentId === collection.id)
          .map(buildTree).concat(
            links
              .filter(link => link.collectionId === collection.id)
              .map(link => new Bookmark({
                id: link.id,
                title: link.name,
                parentId: link.collectionId,
                url: link.url,
                location: ItemLocation.SERVER,
              }))
          ),
      })
    }

    return buildTree(rootCollection, true)
  }

  async isAvailable(): Promise<boolean> {
    return true
  }

  async sendRequest(verb:string, relUrl:string, type:string = null, body:any = null, returnRawResponse = false):Promise<any> {
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
              ...(type && type !== 'multipart/form-data' && { 'Content-type': type }),
              Authorization: 'Bearer ' + this.server.password,
            },
            signal: this.abortSignal,
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

  private async sendRequestNative(verb: string, url: string, type: string, body: any, returnRawResponse: boolean) {
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
              ...(type && type !== 'multipart/form-data' && { 'Content-type': type }),
              Authorization: 'Bearer ' + this.server.password,
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
    if (res.status === 503 || res.status >= 400) {
      throw new HttpError(res.status, verb)
    }
    const json = res.data

    return json
  }
}
