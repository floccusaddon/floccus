import Crypto from './Crypto'
import Logger from './Logger'
import TResource, { IHashSettings } from './interfaces/Resource'
import * as Parallel from 'async-parallel'
import { yieldToEventLoop } from './yieldToEventLoop'
import { isTest } from './isTest'

const STRANGE_PROTOCOLS = ['data:', 'javascript:', 'about:', 'chrome:', 'file:']

export const ItemLocation = {
  LOCAL: 'Local',
  SERVER: 'Server'
} as const

export type TItemLocation = (typeof ItemLocation)[keyof typeof ItemLocation];

export type TOppositeLocation<L extends TItemLocation> = L extends typeof ItemLocation.LOCAL ? typeof ItemLocation.SERVER : L extends typeof ItemLocation.SERVER ? typeof ItemLocation.LOCAL : never

export const ItemType = {
  FOLDER: 'folder',
  BOOKMARK: 'bookmark'
} as const

export type TItemType = (typeof ItemType)[keyof typeof ItemType];

interface IItemIndex<L extends TItemLocation> {
  // eslint-disable-next-line no-use-before-define
  [ItemType.BOOKMARK]: Record<string|number,Bookmark<L>>,
  // eslint-disable-next-line no-use-before-define
  [ItemType.FOLDER]: Record<string|number,Folder<L>>,
}

let HASH_ITERATIONS = 0

/**
 * Bring a bookmark's tags into canonical form: strings only, trimmed, no empty
 * entries, no duplicates -- but *order preserving*.
 *
 * Order is deliberately not normalized: Nextcloud Bookmarks computes its
 * server-side folder hashes over `{title, url, tags}` with the tags in database
 * order, and we read them from the very same source, so keeping that order lets
 * our locally computed hashes agree with the server's. Sorting here would make
 * every bookmark tagged outside floccus hash differently from the server's idea
 * of it, and that folder would be re-fetched on every single sync.
 *
 * The flip side is that a pure reordering counts as a change and gets written
 * back once -- which is what makes the two sides agree again.
 *
 * `undefined` means "this resource didn't tell us anything about tags" and is
 * preserved as such, so we never mistake a silent adapter for "all tags removed".
 */
export function normalizeTags(tags?: string[]): string[] | undefined {
  if (!Array.isArray(tags)) {
    return undefined
  }
  const seen = new Set<string>()
  const normalized = []
  for (const tag of tags) {
    if (typeof tag !== 'string') {
      continue
    }
    const trimmed = tag.trim()
    if (!trimmed || seen.has(trimmed)) {
      continue
    }
    seen.add(trimmed)
    normalized.push(trimmed)
  }
  return normalized
}

/**
 * Cache slot for a memoized hash. Every setting that changes the hashed bytes
 * has to be part of it, or a sync that negotiated different settings would read
 * back a stale value.
 */
function hashCacheKey({ preserveOrder, hashFn, syncTags }: IHashSettings): string {
  return `${preserveOrder}-${hashFn}-${Boolean(syncTags)}`
}

/**
 * Compare two tag lists as sets: tags are unordered by nature, so a mere
 * reordering must not count as a change.
 */
export function tagsEqual(tags1?: string[], tags2?: string[]): boolean {
  const set1 = new Set(tags1 || [])
  const set2 = new Set(tags2 || [])
  if (set1.size !== set2.size) {
    return false
  }
  for (const tag of set1) {
    if (!set2.has(tag)) {
      return false
    }
  }
  return true
}

export class Bookmark<L extends TItemLocation> {
  public type = ItemType.BOOKMARK
  public id: string | number
  public parentId: string | number | null
  public title: string
  public url: string
  public tags: string[]
  public location: L
  public isRoot = false
  private hashValue: Record<string, string>
  public index: IItemIndex<L>

  constructor({
    id,
    parentId,
    url,
    title,
    tags,
    location,
  }: {
    id: string | number
    parentId: string | number
    url: string
    title: string
    tags?: string[]
    location: L
  }) {
    this.id = id
    this.parentId = parentId
    this.title = title
    this.tags = normalizeTags(tags)
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    this.location = location || ItemLocation.LOCAL

    if (
      this.location !== ItemLocation.LOCAL &&
      this.location !== ItemLocation.SERVER
    ) {
      throw new Error('Location failed validation')
    }

    try {
      // not a regular bookmark
      if (STRANGE_PROTOCOLS.some((proto) => url.indexOf(proto) === 0)) {
        this.url = url
        return
      }

      const urlObj = new URL(url)
      this.url = urlObj.href
    } catch (e) {
      Logger.log('Failed to normalize', url)
      this.url = url
    }
  }

  canMergeWith<L2 extends TItemLocation>(otherItem: TItem<L2>): boolean {
    if (otherItem instanceof Bookmark) {
      return this.url === otherItem.url
    }
    return false
  }

  childrenSimilarity<L2 extends TItemLocation>(otherItem: TItem<L2>): number {
    return 0
  }

  setHashCacheValue(hashSettings: IHashSettings, value: string): void {
    const cacheKey = hashCacheKey(hashSettings)
    if (!this.hashValue) this.hashValue = {}
    this.hashValue[cacheKey] = value
  }

  async hash(
    { preserveOrder = false, hashFn = 'sha256', syncTags = false }: IHashSettings = {
      preserveOrder: false,
      hashFn: 'sha256',
    }
  ): Promise<string> {
    const cacheKey = hashCacheKey({ preserveOrder, hashFn, syncTags })
    if (!this.hashValue) {
      this.hashValue = {}
    }
    if (typeof this.hashValue[cacheKey] === 'undefined' || this.hashValue[cacheKey] === null) {
      // Nextcloud Bookmarks hashes the very same JSON server-side, with the
      // fields in exactly this order (`fields[]=title&fields[]=url&fields[]=tags`),
      // so don't reorder or add keys here lightly.
      const json = syncTags
        ? JSON.stringify({ title: this.title, url: this.url, tags: this.tags || [] })
        : JSON.stringify({ title: this.title, url: this.url })
      if (hashFn === 'sha256') {
        this.hashValue[cacheKey] = await Crypto.sha256(json)
      } else if (hashFn === 'xxhash3') {
        this.hashValue[cacheKey] = await Crypto.xxhash32(json)
      } else if (hashFn === 'murmur3') {
        this.hashValue[cacheKey] = await Crypto.murmurHash3(json)
      } else {
        throw new Error('Unsupported hash function specified')
      }
    }
    return this.hashValue[cacheKey]
  }

  clone(withHash?: boolean): Bookmark<L> {
    const bookmark = Object.create(this)
    if (!withHash) {
      bookmark.hashValue = null
    }
    return bookmark
  }

  cloneWithLocation<L2 extends TItemLocation>(
    withHash: boolean,
    location: L2
  ): Bookmark<L2> {
    const newBookmark = Object.create(this)
    newBookmark.location = location
    return newBookmark
  }

  copy(withHash?: boolean): Bookmark<L> {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    return new Bookmark(this.toJSON())
  }

  restampTree<L2 extends TItemLocation>(
    withHash: boolean,
    location: L2
  ): Bookmark<L2> {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    return new Bookmark({
      ...this.toJSON(),
      location,
    })
  }

  // For Bookmark this is equivalent to restampTree — no children to consider.
  restampRoot<L2 extends TItemLocation>(
    withHash: boolean,
    location: L2
  ): Bookmark<L2> {
    return this.restampTree(withHash, location)
  }

  toJSON() {
    // Flatten inherited properties for serialization
    const result = {}
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    let obj = this
    while (obj instanceof Bookmark) {
      Object.entries(obj).forEach(([key, value]) => {
        if (key === 'index') return
        if (!(key in result)) {
          result[key] = value
        }
      })
      obj = Object.getPrototypeOf(obj)
    }
    return result
  }

  async toJSONAsync(): Promise<any> {
    // Flatten inherited properties for serialization
    const result = {}
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    let obj = this
    let iterations = 1
    while (obj instanceof Bookmark) {
      if (++iterations % 1000 === 0) {
        await yieldToEventLoop()
      }
      Object.entries(obj).forEach(([key, value]) => {
        if (key === 'index') return
        if (!(key in result)) {
          result[key] = value
        }
      })
      obj = Object.getPrototypeOf(obj)
    }
    return result
  }

  createIndex(): IItemIndex<L> {
    this.index = { bookmark: {[this.id]: this}, folder: {} }
    return this.index
  }

  // TODO: Make this return the correct type based on the type param
  findItem(type: TItemType, id: string | number): TItem<L> | null {
    if (type === 'bookmark' && String(id) === String(this.id)) {
      return this
    }
    return null
  }

  // TODO: Make this return the correct type based on the type param
  findItemFilter(
    type: TItemType,
    fn: (item: TItem<L>) => boolean,
    prefer: (item: TItem<L>) => number = () => 1
  ): TItem<L> | null {
    if (type === ItemType.BOOKMARK && fn(this)) {
      return this
    }
    return null
  }

  count(): number {
    return 1
  }

  countFolders(): number {
    return 0
  }

  inspect(depth = 0): string {
    return (
      Array(depth < 0 ? 0 : depth)
        .fill('  ')
        .join('') +
      `- #${this.id}[${this.title}](${this.url}) parentId: ${this.parentId}`
    )
  }

  // Honored by node.js' util.inspect (e.g. console.log) without requiring 'util'
  [Symbol.for('nodejs.util.inspect.custom')](): string {
    return this.inspect(0)
  }

  visitCreate(resource: TResource<L>): Promise<number | string> {
    return resource.createBookmark(this)
  }

  visitUpdate(resource: TResource<L>): Promise<void> {
    return resource.updateBookmark(this)
  }

  visitRemove(resource: TResource<L>): Promise<void> {
    return resource.removeBookmark(this)
  }

  static hydrate<L2 extends TItemLocation>(obj: any): Bookmark<L2> {
    return new Bookmark(obj)
  }
}

export class Folder<L extends TItemLocation> {
  public type = ItemType.FOLDER
  public id: number | string
  public title?: string
  public parentId: number | string
  public children: TItem<L>[]
  public hashValue: Record<string, string>
  public isRoot = false
  public loaded = true
  public location: L
  public index: IItemIndex<L>

  constructor({
    id,
    parentId,
    title,
    children,
    hashValue,
    loaded,
    location,
    isRoot,
  }: {
    id: number | string
    parentId?: number | string
    title?: string
    // eslint-disable-next-line no-use-before-define
    children?: TItem<L>[]
    hashValue?: Record<'true' | 'false', string>
    loaded?: boolean
    location: L
    isRoot?: boolean
  }) {
    this.id = id
    this.parentId = parentId
    this.title = title
    this.children = children || []
    this.hashValue = { ...hashValue }
    this.loaded = loaded !== false
    this.isRoot = isRoot
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    this.location = location || ItemLocation.LOCAL

    if (
      this.location !== ItemLocation.LOCAL &&
      this.location !== ItemLocation.SERVER
    ) {
      throw new Error('Location failed validation')
    }
  }

  // eslint-disable-next-line no-use-before-define
  findItemFilter(
    type: TItemType,
    fn: (Item) => boolean,
    prefer: (Item) => number = () => 1
  ): TItem<L> | null {
    if (!this.index) {
      this.createIndex()
    }
    const candidates = Object.values(this.index[type]).filter(fn)
    // return the preferred match based on a preference measure
    return candidates.sort((a, b) => prefer(a) - prefer(b)).pop()
  }

  findFolder(id: string | number): Folder<L> {
    if (String(this.id) === String(id)) {
      return this
    }

    if (this.index) {
      return this.index.folder[id]
    }

    // traverse sub folders
    return this.children
      .filter((child) => child instanceof Folder)
      .map((folder) => folder as Folder<L>)
      .map((folder) => folder.findFolder(id))
      .filter((folder) => !!folder)[0]
  }

  findBookmark(id: string | number): Bookmark<L> {
    if (this.index) {
      return this.index.bookmark[id]
    }
    const bookmarkFound = this.children
      .filter((child) => child instanceof Bookmark)
      .map((child) => child as Bookmark<L>)
      .find((bm) => String(bm.id) === String(id))
    if (bookmarkFound) {
      return bookmarkFound
    }
    // traverse sub folders
    return this.children
      .filter((child) => child instanceof Folder)
      .map((folder) => folder as Folder<L>)
      .map((folder) => folder.findBookmark(id))
      .filter((bookmark) => !!bookmark)[0]
  }

  // eslint-disable-next-line no-use-before-define
  findItem(type: TItemType, id: string | number): TItem<L> | null {
    if (type === ItemType.FOLDER) {
      return this.findFolder(id)
    } else {
      return this.findBookmark(id)
    }
  }

  async traverse(
    fn: (item: TItem<L>, folder: Folder<L>) => void
  ): Promise<void> {
    let iterations = 0
    await Parallel.each(
      this.children,
      async(item) => {
        await fn(item, this)
        if (item.type === 'folder') {
          // give the browser time to breathe
          if (++iterations % 1000 === 0) {
            await yieldToEventLoop()
          }
          await item.traverse(fn)
        }
      },
      isTest ? 1 : 10
    )
  }

  // eslint-disable-next-line no-use-before-define
  canMergeWith<L2 extends TItemLocation>(otherItem: TItem<L2>): boolean {
    if (otherItem instanceof Folder) {
      return this.title === otherItem.title
    }
    return false
  }

  childrenSimilarity<L2 extends TItemLocation>(otherItem: TItem<L2>): number {
    if (otherItem instanceof Folder) {
      const myChildren = Array.isArray(this.children) ? this.children : []
      const otherChildren = Array.isArray(otherItem.children)
        ? otherItem.children
        : []
      const myChildrenTitles = new Set(myChildren.map((child) => child.title))
      const otherChildrenTitles = new Set(
        otherChildren.map((child) => child.title)
      )
      if (!myChildrenTitles.size && !otherChildrenTitles.size) {
        return 1
      }
      const overlappingTitles = new Set([...myChildrenTitles].filter((title) => otherChildrenTitles.has(title)))
      return overlappingTitles.size / Math.max(myChildrenTitles.size, otherChildrenTitles.size)
    }
    return 0
  }

  setHashCacheValue(hashSettings: IHashSettings, value: string): void {
    const cacheKey = hashCacheKey(hashSettings)
    if (!this.hashValue) this.hashValue = {}
    this.hashValue[cacheKey] = value
  }

  async hash(
    { preserveOrder = false, hashFn = 'sha256', syncTags = false }: IHashSettings = {
      preserveOrder: false,
      hashFn: 'sha256',
    }
  ): Promise<string> {
    const cacheKey = hashCacheKey({ preserveOrder, hashFn, syncTags })
    if (this.hashValue && typeof this.hashValue[cacheKey] !== 'undefined') {
      return this.hashValue[cacheKey]
    }

    if (!this.loaded) {
      throw new Error("Trying to calculate hash of a folder that isn't loaded")
    }

    if (++HASH_ITERATIONS % 1000 === 0) {
      await yieldToEventLoop()
    }

    const children = this.children.slice()
    if (!preserveOrder) {
      // only re-sort unless we sync the order of the children as well
      children.sort((c1, c2) => {
        if (c1.title < c2.title) {
          return -1
        }
        if (c2.title < c1.title) {
          return 1
        }
        return 0
      })
    }
    if (!this.hashValue) this.hashValue = {}
    const json = JSON.stringify({
      title: this.title,
      children: await Parallel.map(
        children,
        (child) => child.hash({ preserveOrder, hashFn, syncTags }),
        1
      ),
    })
    if (hashFn === 'sha256') {
      this.hashValue[cacheKey] = await Crypto.sha256(json)
    } else if (hashFn === 'murmur3') {
      this.hashValue[cacheKey] = await Crypto.murmurHash3(json)
    } else if (hashFn === 'xxhash3') {
      this.hashValue[cacheKey] = await Crypto.xxhash32(json)
    } else {
      throw new Error('Unsupported hash function specified')
    }
    return this.hashValue[cacheKey]
  }

  copy(withHash?: boolean): Folder<L> {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    return new Folder({
      ...this.toJSON(),
      ...(!withHash && { hashValue: null }),
      children: this.children.map((child) => child.copy(withHash)),
    })
  }

  restampTree<L2 extends TItemLocation>(
    withHash: boolean,
    location: L2
  ): Folder<L2> {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    return new Folder({
      ...this.toJSON(),
      location,
      ...(!withHash && { hashValue: null }),
      children: this.children.map((child) =>
        child.restampTree(withHash, location)
      ),
    })
  }

  // Relabel the root only; children keep their original .location (and ids).
  // Use this when the resulting folder represents "where to put it" but its
  // descendants still hold identifiers in the source coordinate system that
  // downstream code cross-references against an oldItem snapshot.
  // Note: at the type level children appear as TItem<L2>, but at runtime
  // they retain whatever location they were copied from. That asymmetry is
  // the API's documented lie — see callers in Diff#map.
  restampRoot<L2 extends TItemLocation>(
    withHash: boolean,
    location: L2
  ): Folder<L2> {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    return new Folder({
      ...this.toJSON(),
      location,
      ...(!withHash && { hashValue: null }),
      children: this.children.map((child) => child.copy(withHash)) as unknown as TItem<L2>[],
    })
  }

  clone(withHash?: boolean): Folder<L> {
    const newFolder = Object.create(this)
    newFolder.index = null
    if (!withHash) {
      newFolder.hashValue = {}
    }
    newFolder.children = this.children.map((child) => child.clone(withHash))
    return newFolder
  }

  cloneWithLocation<L2 extends TItemLocation>(
    withHash: boolean,
    location: L2
  ): Folder<L2> {
    const newFolder = Object.create(this)
    if (!withHash) {
      newFolder.hashValue = {}
    }
    newFolder.index = null
    newFolder.location = location
    newFolder.children = this.children.map((child) =>
      child.cloneWithLocation(withHash, location)
    )
    return newFolder
  }

  toJSON(): Folder<L> {
    // Flatten inherited properties for serialization
    const result: Folder<L> = {} as any as Folder<L>
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    let obj = this
    while (obj instanceof Folder) {
      Object.entries(obj).forEach(([key, value]) => {
        if (key === 'index') return
        if (!(key in result)) {
          if (key === 'children') {
            value = value.map((child) => child.toJSON())
          }
          result[key] = value
        }
      })
      obj = Object.getPrototypeOf(obj)
    }
    return result
  }

  async toJSONAsync(): Promise<Folder<L>> {
    // Flatten inherited properties for serialization
    const result: Folder<L> = {} as any as Folder<L>
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    let obj = this
    let iterations = 1
    while (obj instanceof Folder) {
      if (++iterations % 1000 === 0) {
        await yieldToEventLoop()
      }
      await Parallel.map(Object.entries(obj), async([key, value]) => {
        if (key === 'index') return
        if (!(key in result)) {
          if (key === 'children') {
            value = await Parallel.map(obj.children, async(child: TItem<L>) => child.toJSONAsync())
          }
          result[key] = value
        }
      }, 1)
      obj = Object.getPrototypeOf(obj)
    }
    return result
  }

  count(): number {
    if (!this.index) {
      this.createIndex()
    }
    return Object.keys(this.index.bookmark).length
  }

  countFolders(): number {
    if (!this.index) {
      this.createIndex()
    }
    return Object.keys(this.index.folder).length
  }

  createIndex(): IItemIndex<L> {
    this.index = {
      folder: { [this.id]: this },
      bookmark: {}
    }

    for (const child of this.children) {
      if (child instanceof Bookmark) {
        this.index.bookmark[child.id] = child
      } else if (child instanceof Folder) {
        const subIndex = child.createIndex()
        Object.assign(this.index.folder, subIndex.folder)
        Object.assign(this.index.bookmark, subIndex.bookmark)
      }
    }

    return this.index
  }

  /**
   * Update the index with the given item (this method should be called on the root folder)
   */
  updateIndex(item: TItem<L>) {
    if (!item) {
      return
    }
    this.createIndex()
  }

  /**
   * Update the index by removing the given item and its children (this method should be called on the root folder)
   */
  removeFromIndex(item: TItem<L>) {
    if (!item) return
    this.createIndex()
  }

  inspect(depth = 0): string {
    return (
      Array(depth < 0 ? 0 : depth)
        .fill('  ')
        .join('') +
      `+ #${this.id}[${this.title}] parentId: ${this.parentId}, hash: ${
        Object.values(this.hashValue)[0]
      }\n` +
      this.children
        .map((child) =>
          child && child.inspect ? child.inspect(depth + 1) : String(child)
        )
        .join('\n')
    )
  }

  // Honored by node.js' util.inspect (e.g. console.log) without requiring 'util'
  [Symbol.for('nodejs.util.inspect.custom')](): string {
    return this.inspect(0)
  }

  visitCreate(resource: TResource<L>): Promise<number | string> {
    return resource.createFolder(this)
  }

  visitUpdate(resource: TResource<L>): Promise<void> {
    return resource.updateFolder(this)
  }

  visitRemove(resource: TResource<L>): Promise<void> {
    return resource.removeFolder(this)
  }

  static hydrate<L2 extends TItemLocation>(obj: {
    id: string | number
    parentId?: string | number
    title?: string
    location: L2
    children: any[]
    isRoot: boolean
  }): Folder<L2> {
    return new Folder({
      ...obj,
      children: obj.children
        ? obj.children.map((child) => {
          // Firefox seems to set 'url' even for folders
          if ('url' in child && typeof child.url === 'string') {
            return Bookmark.hydrate(child)
          } else {
            return Folder.hydrate(child)
          }
        })
        : null,
    })
  }
}

export type TItem<L extends TItemLocation> = Bookmark<L> | Folder<L>

export function hydrate<L extends TItemLocation>(obj: any) {
  if (obj.type === ItemType.FOLDER) {
    return Folder.hydrate<L>(obj)
  }
  if (obj.type === ItemType.BOOKMARK) {
    return Bookmark.hydrate<L>(obj)
  }
  throw new Error(`Cannot hydrate object ${JSON.stringify(obj)}`)
}
