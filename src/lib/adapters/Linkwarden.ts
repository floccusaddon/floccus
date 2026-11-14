import Adapter from '../interfaces/Adapter'
import { Bookmark, Folder, ItemLocation, TItem, TItemLocation } from '../Tree'
import PQueue from 'p-queue'
import { ICapabilities, IHashSettings, IResource } from '../interfaces/Resource'
import Logger from '../Logger'
import {
  AuthenticationError,
  CancelledSyncError, HttpError, MissingPermissionsError,
  NetworkError, ParseResponseError,
  RedirectError,
  RequestTimeoutError, UnexpectedServerFolder
} from '../../errors/Error'
import { CapacitorHttp as Http } from '@capacitor/core'
import Ordering from '../interfaces/Ordering'
import AsyncLock from 'async-lock'

declare const IS_BROWSER: boolean

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
  /**
   * Sync the order of the links in a collection (Linkwarden >= 2.17). Off for
   * profiles from before this option existed -- the first sync would impose
   * Linkwarden's seeded order (newest first) on the local bookmarks -- so
   * getDefaultValues says false and only new profiles are created with true.
   */
  syncOrder?: boolean
}

const TIMEOUT = 300000
const SERVER_ERROR_RETRIES = 3
const SERVER_ERROR_RETRY_DELAY = 1000
// Retrying is only safe for verbs that have no side effects when repeated:
// A 5xx response doesn't tell us whether the server applied the request or not.
const RETRIABLE_VERBS = ['GET', 'HEAD', 'OPTIONS', 'PUT', 'DELETE']
// The first release with a custom order of the links in a collection
const CUSTOM_ORDER_VERSION = [2, 17, 0]

function parseVersion(version: unknown): number[]|null {
  const match = typeof version === 'string' && version.trim().match(/^v?(\d+)\.(\d+)(?:\.(\d+))?/)
  return match ? [Number(match[1]), Number(match[2]), Number(match[3] || 0)] : null
}

function isAtLeast(version: number[], minimum: number[]): boolean {
  for (let i = 0; i < minimum.length; i++) {
    if (version[i] !== minimum[i]) {
      return version[i] > minimum[i]
    }
  }
  return true
}

/**
 * Linkwarden's own order of collections, as its sidebar and `GET /api/v1/collections`
 * apply it: the ones in the user's `collectionOrder` by their (first) position there,
 * then the rest, oldest first.
 */
function compareCollections(positions: Map<number, number>, a, b): number {
  const aIndex = positions.get(Number(a.id))
  const bIndex = positions.get(Number(b.id))
  if (aIndex !== undefined && bIndex !== undefined) return aIndex - bIndex
  if (aIndex !== undefined) return -1
  if (bIndex !== undefined) return 1
  return (Date.parse(a.createdAt) - Date.parse(b.createdAt)) || (Number(a.id) - Number(b.id))
}

/**
 * `collectionOrder` with `siblings` put in this order, everything else left where it
 * is: the siblings take over the positions they already hold (only their order among
 * each other matters to Linkwarden), and those missing from it are added at the end.
 */
function reorderCollections(collectionOrder: number[], siblings: number[]): number[] {
  // Linkwarden only ever looks at an id's first position, and drops later ones when saving
  const result = collectionOrder.filter((id, i) => collectionOrder.indexOf(id) === i)
  const siblingIds = new Set(siblings)
  const slots = []
  result.forEach((id, i) => {
    if (siblingIds.has(id)) slots.push(i)
  })
  const missing = siblings.filter(id => !result.includes(id))
  for (const id of missing) {
    slots.push(result.length)
    result.push(id)
  }
  siblings.forEach((id, i) => {
    result[slots[i]] = id
  })
  return result
}

export default class LinkwardenAdapter implements Adapter, IResource<typeof ItemLocation.SERVER> {
  private server: LinkwardenConfig
  private fetchQueue: PQueue
  private abortController: AbortController
  private abortSignal: AbortSignal
  private canceled: boolean
  /**
   * Linkwarden >= 2.17 keeps a custom order of the links in a collection. The
   * collections have an order of their own (the user's `collectionOrder`), but no
   * place among the links, so they're kept above them. The strategies detect ordering support with
   * `'orderFolder' in server`, so this is only defined once onSyncStart has
   * found a server that has one (see detectCustomOrder).
   */
  orderFolder?: (id: string|number, order: Ordering<typeof ItemLocation.SERVER>) => Promise<void>
  /** Link ids per collection id, top to bottom, as the server has them */
  private linkOrder: Map<string, (string|number)[]> = new Map()
  /**
   * Links created in or moved into a collection since the tree was loaded.
   * Linkwarden puts each of them on top, but the strategies send these requests
   * concurrently, so the order in which the server handled them -- and thus
   * where they ended up among each other -- is unknown. orderLinks therefore
   * never counts them as already in place.
   */
  private unplacedLinks: Set<string> = new Set()
  /**
   * Whether the server keeps a link order, while that is still unknown: true or
   * false once a link created in this sync has told us, null before. See
   * detectCustomOrder.
   */
  private customOrderConfirmed: boolean|null = true
  /** Serializes the read-modify-write cycles of the user's collectionOrder */
  private collectionOrderLock = new AsyncLock()

  constructor(server: LinkwardenConfig) {
    this.server = server
    this.fetchQueue = new PQueue({ concurrency: 5 })
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
      syncOrder: false,
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

  async onSyncStart(needLock?: boolean, forceLock?: boolean): Promise<void | boolean> {
    this.canceled = false
    if (IS_BROWSER) {
      const browser = (await import('../browser-api')).default
      let hasPermissions, error = false
      try {
        hasPermissions = await browser.permissions.contains({ origins: [this.server.url + '/'] })
      } catch (e) {
        error = true
        console.warn(e)
      }
      const {isOrion} = await browser.storage.local.get({'isOrion': false})
      if (!error && !hasPermissions && !isOrion) {
        throw new MissingPermissionsError()
      }
    }

    const customOrder = this.server.syncOrder ? await this.detectCustomOrder() : false
    this.customOrderConfirmed = customOrder === 'unknown' ? null : customOrder
    if (customOrder) {
      Logger.log(customOrder === 'unknown'
        ? '(linkwarden) Server has no links to tell whether it keeps a custom link order, assuming it does'
        : '(linkwarden) Server keeps a custom link order, syncing it')
      this.orderFolder = async(id, order) => {
        await this.orderCollections(order)
        await this.orderLinks(id, order)
      }
    } else {
      delete this.orderFolder
    }
  }

  /**
   * 'unknown' for a server that neither names its version nor has a link to show
   * whether it keeps the order. Ordering is synced there anyway: if it turned on
   * only once the server has links, at a later sync, the order Linkwarden gave
   * them would replace the local one. Turning it off later is harmless, so the
   * first link created settles it (see createBookmark) -- every link on such a
   * server is one this sync created, and reorders run after the creations.
   */
  private async detectCustomOrder(): Promise<boolean|'unknown'> {
    try {
      const { response } = await this.sendRequest('GET', '/api/v1/config')
      const version = parseVersion(response?.INSTANCE_VERSION)
      if (version) {
        return isAtLeast(version, CUSTOM_ORDER_VERSION)
      }
    } catch (e) {
      if (!(e instanceof HttpError || e instanceof ParseResponseError)) {
        throw e
      }
      Logger.log('(linkwarden) Could not read the server version', e)
    }
    // INSTANCE_VERSION is a build-time value that not every deployment sets.
    // Links come with their position from 2.17 on.
    const { data } = await this.sendRequest('GET', '/api/v1/search?searchQueryString=')
    if (!data?.links?.length) {
      return 'unknown'
    }
    return typeof data.links[0].collectionOrder === 'number'
  }

  /**
   * Linkwarden moves one link per request (`PUT /api/v1/links/:id/order`, below
   * the link given as `beforeId`, or to the top without one), so only the links
   * outside the longest run already in the right order are moved -- a run that
   * only counts links whose place we know (see unplacedLinks). Collections
   * are always listed above the links (getBookmarksTree), see orderCollections.
   */
  private async orderLinks(id: string|number, order: Ordering<typeof ItemLocation.SERVER>): Promise<void> {
    Logger.log('(linkwarden)ORDERFOLDER', { id, order })
    if (this.customOrderConfirmed === false) {
      // An older server: it has no endpoint to move links. Collections can still be
      // ordered, and the next sync turns ordering off (detectCustomOrder).
      Logger.log('(linkwarden) Server keeps no custom link order, not ordering collection ' + id)
      return
    }
    const current = this.linkOrder.get(String(id))
    if (!current) {
      Logger.log('(linkwarden) Collection ' + id + ' is unknown, not ordering it')
      return
    }
    const currentIds = new Set(current.map(String))
    const wanted = order
      .filter(item => item.type === 'bookmark' && currentIds.has(String(item.id)))
      .map(item => String(item.id))
    const wantedIds = new Set(wanted)
    // Links the order doesn't mention (ones floccus doesn't accept) go below the rest
    const target = wanted.concat(current.map(String).filter(linkId => !wantedIds.has(linkId)))

    const placed = current.map(String).filter(linkId => !this.unplacedLinks.has(linkId))
    const keep = longestOrderedRun(placed, target)
    const top = current.slice()
    for (let i = 0; i < target.length; i++) {
      if (keep.has(target[i])) {
        continue
      }
      await this.sendRequest(
        'PUT', `/api/v1/links/${target[i]}/order`,
        'application/json',
        i === 0 ? {} : { beforeId: Number(target[i - 1]) },
      )
      const from = top.findIndex(linkId => String(linkId) === target[i])
      const [moved] = top.splice(from, 1)
      const to = i === 0 ? 0 : top.findIndex(linkId => String(linkId) === target[i - 1]) + 1
      top.splice(to, 0, moved)
      this.unplacedLinks.delete(target[i])
    }
    this.linkOrder.set(String(id), top)
  }

  /**
   * Collections are ordered by the user's `collectionOrder`, one list of ids for
   * all of them, which only the user profile endpoint can write -- and that one
   * stores the whole profile. So each write reads the profile right before, under
   * a lock (orderFolder runs for several folders at once), and sends it back with
   * only collectionOrder changed.
   */
  private async orderCollections(order: Ordering<typeof ItemLocation.SERVER>): Promise<void> {
    const siblings = order
      .filter(item => item.type === 'folder')
      .map(item => Number(item.id))
    if (siblings.length < 2) {
      return
    }
    await this.collectionOrderLock.acquire('collectionOrder', async() => {
      const { response: user } = await this.sendRequest('GET', '/api/v1/users/me')
      const current = (user.collectionOrder || []).map(Number)
      const collectionOrder = reorderCollections(current, siblings)
      if (collectionOrder.length === current.length && collectionOrder.every((id, i) => id === current[i])) {
        return
      }
      Logger.log('(linkwarden) Updating collection order', { siblings })
      await this.sendRequest(
        'PUT', `/api/v1/users/${user.id}`,
        'application/json',
        { ...user, collectionOrder },
      )
    })
  }

  private addToLinkOrder(collectionId: string|number, linkId: string|number) {
    const links = this.linkOrder.get(String(collectionId))
    if (links) {
      // Linkwarden puts new links, and links moved into a collection, at the top
      links.unshift(linkId)
      this.unplacedLinks.add(String(linkId))
    }
  }

  private removeFromLinkOrder(linkId: string|number) {
    this.unplacedLinks.delete(String(linkId))
    for (const links of this.linkOrder.values()) {
      const index = links.findIndex(id => String(id) === String(linkId))
      if (index !== -1) {
        links.splice(index, 1)
        return
      }
    }
  }

  async createBookmark(bookmark: Bookmark<typeof ItemLocation.SERVER>): Promise<string | number> {
    Logger.log('(linkwarden)CREATE', {bookmark})
    const {response} = await this.sendRequest(
      'POST', '/api/v1/links',
      'application/json',
      {
        url: bookmark.url,
        name: bookmark.title,
        tags: (bookmark.tags || []).map(name => ({ name })),
        collection: {
          id: bookmark.parentId,
        },
      },
      false,
      bookmark,
    )
    if (this.customOrderConfirmed === null) {
      this.customOrderConfirmed = typeof response.collectionOrder === 'number'
      Logger.log('(linkwarden) Server ' + (this.customOrderConfirmed ? 'keeps' : 'keeps no') + ' custom link order')
    }
    this.addToLinkOrder(bookmark.parentId, response.id)
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
        // This endpoint replaces the link's tags wholesale, so when we're not
        // syncing tags we have to read back and re-send what's already there --
        // otherwise every sync would strip tags set in Linkwarden's own UI.
        tags: (bookmark.tags ?? await this.getBookmarkTags(bookmark.id)).map(name => ({ name })),
        collection: {
          id: bookmark.parentId,
          name: collection.name,
          ownerId: collection.ownerId,
        },
      },
      false,
      bookmark,
    )
    const siblings = this.linkOrder.get(String(bookmark.parentId))
    if (siblings && !siblings.some(id => String(id) === String(bookmark.id))) {
      this.removeFromLinkOrder(bookmark.id)
      this.addToLinkOrder(bookmark.parentId, bookmark.id)
    }
  }

  async getBookmarkTags(id: string | number): Promise<string[]> {
    try {
      const { response: link } = await this.sendRequest('GET', `/api/v1/links/${id}`)
      return (link?.tags || []).map(tag => tag.name)
    } catch (e) {
      Logger.log('(linkwarden) Failed to read existing tags of link ' + id, e)
      return []
    }
  }

  async removeBookmark(bookmark: Bookmark<typeof ItemLocation.SERVER>): Promise<void> {
    Logger.log('(linkwarden)DELETE', {bookmark})
    try {
      await this.sendRequest('DELETE', `/api/v1/links/${bookmark.id}`, undefined, undefined, false, bookmark)
      this.removeFromLinkOrder(bookmark.id)
    } catch (e) {
      if (e instanceof HttpError) {
        if (e.status === 404 || e.status === 401 || e.status === 403) {
          return
        }
      }
      if (e instanceof AuthenticationError) {
        return
      }
      throw e
    }
  }

  async createFolder(folder: Folder<typeof ItemLocation.SERVER>): Promise<string | number> {
    Logger.log('(linkwarden)CREATEFOLDER', {folder})
    const {response} = await this.sendRequest(
      'POST', '/api/v1/collections',
      'application/json',
      {
        name: folder.title,
        parentId: folder.parentId,
      },
      false,
      folder
    )
    this.linkOrder.set(String(response.id), [])
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
      },
      false,
      folder,
    )
  }

  async removeFolder(folder: Folder<typeof ItemLocation.SERVER>): Promise<void> {
    Logger.log('(linkwarden)DELETEFOLDER', {folder})
    let success = false
    let count = 0
    do {
      try {
        count++
        await this.sendRequest('DELETE', `/api/v1/collections/${folder.id}`, undefined, undefined, false, folder)
        success = true
      } catch (e) {
        if (e instanceof HttpError && e.status === 401) {
          success = true
        } else if (e instanceof AuthenticationError) {
          return
        } else if (count > 3) {
          throw e
        }
        // noop
      }
    } while (!success)
  }

  async getBookmarksTree(loadAll?: boolean): Promise<Folder<typeof ItemLocation.SERVER>> {
    const links = []
    let nextCursor = null
    while (true) {
      const params = new URLSearchParams({ searchQueryString: '' })
      if (nextCursor) {
        params.set('cursor', nextCursor)
      }
      const { data } = await this.sendRequest('GET', `/api/v1/search?${params.toString()}`)
      links.push(...data.links)

      nextCursor = data.nextCursor
        ? data.nextCursor
        : null

      if (!nextCursor) {
        break
      }
    }

    const { response: collections } = await this.sendRequest('GET', `/api/v1/collections`)

    let rootCollection = collections.find(collection => collection.name === this.server.serverFolder && collection.parentId == null)

    if (!rootCollection) {
      const segments = this.server.serverFolder.split('/').filter(seg => seg.length > 0)

      if (segments.length === 0) {
        throw new UnexpectedServerFolder(this.server.serverFolder)
      }
      let currentParentId = null
      let current = null

      for (const segment of segments) {
        const expectedParent = currentParentId == null ? null : String(currentParentId)
        current = collections.find(collection => {
          const actualParent = collection.parentId == null ? null : String(collection.parentId)
          return collection.name === segment && actualParent === expectedParent
        })
        if (!current) {
          const body: { name: string; parentId?: string | number } = { name: segment }
          if (currentParentId != null) {
            body.parentId = currentParentId
          }
          ({ response: current } = await this.sendRequest(
            'POST', '/api/v1/collections',
            'application/json',
            body
          ))
          collections.push(current)
        }
        currentParentId = current.id
      }
      if (current) {
        rootCollection = current
      }
    }

    const ordered = Boolean(this.orderFolder)
    const collectionPositions = new Map<number, number>()
    if (ordered) {
      const { response: user } = await this.sendRequest('GET', '/api/v1/users/me')
      const collectionOrder = (user?.collectionOrder || []).map(Number)
      collectionOrder.forEach((id, index) => {
        if (!collectionPositions.has(id)) collectionPositions.set(id, index)
      })
    }
    this.linkOrder = new Map()
    this.unplacedLinks = new Set()
    const buildTree = (collection, isRoot = false) => {
      const collectionId = String(collection.id)
      const subCollections = collections.filter(col => String(col.parentId) === collectionId)
      const collectionLinks = links.filter(link => String(link.collectionId) === collectionId)
      if (ordered) {
        // Collections have no place among the links: keep them first, in Linkwarden's order
        subCollections.sort((a, b) => compareCollections(collectionPositions, a, b))
        // As Linkwarden lists them
        collectionLinks.sort((a, b) => (b.collectionOrder - a.collectionOrder) || (b.id - a.id))
      }
      this.linkOrder.set(collectionId, collectionLinks.map(link => link.id))
      return new Folder({
        id: collection.id,
        title: collection.name,
        parentId: collection.parentId ?? null,
        location: ItemLocation.SERVER,
        isRoot,
        children: subCollections
          // Not .map(buildTree): map's index would land in isRoot
          .map((col) => buildTree(col)).concat(
            collectionLinks
              .map(link => new Bookmark({
                id: link.id,
                title: link.name,
                parentId: link.collectionId,
                url: link.url,
                tags: (link.tags || []).map(tag => tag.name),
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

  async sendRequest(verb:string, relUrl:string, type:string = null, body:any = null, returnRawResponse = false, item: TItem<TItemLocation> = null):Promise<any> {
    const url = this.server.url + relUrl

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

    const retriable = RETRIABLE_VERBS.includes(verb.toUpperCase())

    for (let attempt = 0; ; attempt++) {
      try {
        if (!IS_BROWSER) {
          return await this.sendRequestNative(verb, url, type, body, returnRawResponse, item)
        }
        return await this.sendRequestWeb(verb, url, type, body, returnRawResponse, item)
      } catch (e) {
        const isLastAttempt = attempt === SERVER_ERROR_RETRIES
        const isServerError = e instanceof HttpError && e.status >= 500
        if (!retriable || !isServerError || isLastAttempt || this.canceled) {
          throw e
        }
        Logger.log(
          `${verb} ${url}: Server responded with ${e.status}. Retrying (` +
            (attempt + 2) + '/' + (SERVER_ERROR_RETRIES + 1) + ')'
        )
        await this.delay(SERVER_ERROR_RETRY_DELAY * Math.pow(2, attempt))
      }
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.abortSignal.aborted) {
        reject(new CancelledSyncError())
        return
      }
      const timer = setTimeout(resolve, ms)
      this.abortSignal.addEventListener('abort', () => {
        clearTimeout(timer)
        reject(new CancelledSyncError())
      }, { once: true })
    })
  }

  private async sendRequestWeb(verb:string, url:string, type:string, body:any, returnRawResponse: boolean, item: TItem<TItemLocation> = null):Promise<any> {
    let res
    let timedOut = false

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
      Logger.log(
        `${verb} ${url}: Server responded with ${res.status}: ` +
          (await res.text()).substring(0, 250)
      )
      throw new HttpError(res.status, verb, item)
    }
    let json
    try {
      json = await res.json()
    } catch (e) {
      throw new ParseResponseError(e.message)
    }

    return json
  }

  private async sendRequestNative(verb: string, url: string, type: string, body: any, returnRawResponse: boolean, item: TItem<TItemLocation> = null) {
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
      let responseData: string
      try {
        responseData =
          typeof res.data === 'string' ? res.data : JSON.stringify(res.data)
      } catch (e) {
        responseData = String(res.data)
      }
      Logger.log(
        `${verb} ${url}: Server responded with ${res.status}: ` +
          responseData.substring(0, 250)
      )
      throw new HttpError(res.status, verb, item)
    }
    const json = res.data

    return json
  }

  async getCapabilities(): Promise<ICapabilities> {
    return {
      preserveOrder: Boolean(this.orderFolder),
      hashFn: ['xxhash3', 'murmur3', 'sha256'],
      supportsTags: true,
    }
  }

  isAtomic(): boolean {
    return false
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  setHashSettings(hashSettings: IHashSettings): void {
    // noop
  }
}

/**
 * The items of `current` that can stay where they are on the way to `target`:
 * the longest subsequence of `current` that `target` has in the same order.
 * Both hold the same ids.
 */
function longestOrderedRun(current: string[], target: string[]): Set<string> {
  const position = new Map(target.map((id, i) => [id, i]))
  const positions = current.map(id => position.get(id))
  // Patience sorting: tails[k] is the index into `positions` ending the best run of length k + 1
  const tails: number[] = []
  const previous: number[] = new Array(positions.length)
  for (let i = 0; i < positions.length; i++) {
    let lo = 0
    let hi = tails.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (positions[tails[mid]] < positions[i]) {
        lo = mid + 1
      } else {
        hi = mid
      }
    }
    previous[i] = lo > 0 ? tails[lo - 1] : -1
    tails[lo] = i
  }
  const run = new Set<string>()
  for (let i = tails.length ? tails[tails.length - 1] : -1; i !== -1; i = previous[i]) {
    run.add(current[i])
  }
  return run
}
