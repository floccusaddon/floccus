import Crypto from './Crypto'
import Logger from './Logger'
import TResource from './interfaces/Resource'
import * as Parallel from 'async-parallel'
import cache from 'webext-storage-cache'

const STRANGE_PROTOCOLS = ['data:', 'javascript:', 'about:', 'chrome:']

export const ItemLocation = {
  LOCAL: 'Local',
  SERVER: 'Server'
} as const

export type TItemLocation = (typeof ItemLocation)[keyof typeof ItemLocation];

export const ItemType = {
  FOLDER: 'folder',
  BOOKMARK: 'bookmark'
} as const

export type TItemType = (typeof ItemType)[keyof typeof ItemType];

interface IItemIndex {
  // eslint-disable-next-line no-use-before-define
  [ItemType.BOOKMARK]: Record<string|number,Bookmark>,
  // eslint-disable-next-line no-use-before-define
  [ItemType.FOLDER]: Record<string|number,Folder>,
}

export class Bookmark {
  public type = ItemType.BOOKMARK
  public id: string | number
  public parentId: string | number |null
  public title: string
  public url: string
  public tags: string[]
  public location: TItemLocation
  public lastModified: number
  private hashValue: string

  constructor({ id, parentId, url, title, tags, location, lastModified }: { id:string|number, parentId:string|number, url:string, title:string, tags?: string[], lastModified?: number, location: TItemLocation }) {
    this.id = id
    this.parentId = parentId
    this.title = title
    this.tags = tags
    this.location = location
    this.lastModified = lastModified ?? 0

    // not a regular bookmark
    if (STRANGE_PROTOCOLS.some(proto => url.indexOf(proto) === 0)) {
      this.url = url
      return
    }

    try {
      const urlObj = new URL(url)
      this.url = urlObj.href
    } catch (e) {
      Logger.log('Failed to normalize', url)
      this.url = url
    }
  }

  canMergeWith(otherItem: TItem): boolean {
    if (otherItem instanceof Bookmark) {
      return this.url === otherItem.url
    }
    return false
  }

  async hash():Promise<string> {
    if (!this.hashValue) {
      this.hashValue = await Crypto.sha256(
        JSON.stringify({ title: this.title, url: this.url })
      )
    }
    return this.hashValue
  }

  clone(withHash?: boolean, location?: TItemLocation):Bookmark {
    return new Bookmark({...this, location: location ?? this.location})
  }

  withLocation<T extends TItemLocation>(location: T): Bookmark {
    return new Bookmark({
      ...this,
      location,
    })
  }

  createIndex():any {
    return { [this.id]: this }
  }

  findItem(type:TItemType, id:string|number):TItem {
    if (type === 'bookmark' && String(id) === String(this.id)) {
      return this
    }
  }

  findItemFilter(type:TItemType, fn:(Item)=>boolean):TItem|null {
    if (type === ItemType.BOOKMARK && fn(this)) {
      return this
    }
    return null
  }

  inspect(depth = 0):string {
    return (
      Array(depth < 0 ? 0 : depth)
        .fill('  ')
        .join('') +
      `- #${this.id}[${this.title}](${this.url}) parentId: ${this.parentId}`
    )
  }

  visitCreate(resource: TResource):Promise<number | string> {
    return resource.createBookmark(this)
  }

  visitUpdate(resource: TResource): Promise<void> {
    return resource.updateBookmark(this)
  }

  visitRemove(resource: TResource): Promise<void> {
    return resource.removeBookmark(this)
  }

  static hydrate(obj: any):Bookmark {
    return new Bookmark(obj)
  }
}

export class Folder {
  public type = ItemType.FOLDER
  public id: number | string
  public title?: string
  public parentId: number | string
  public children: TItem[]
  public hashValue: Record<string,string>
  public isRoot = false
  public loaded = true
  public lastModified: number
  public location: TItemLocation
  private index: IItemIndex

  constructor({ id, parentId, title, children, hashValue, loaded, location, lastModified }
  :{
    id:number|string,
    parentId?:number|string,
    title?:string,
    // eslint-disable-next-line no-use-before-define
    children?: TItem[],
    hashValue?:Record<'true'|'false',string>,
    loaded?: boolean,
    lastModified?: number
    location: TItemLocation
  }) {
    this.id = id
    this.parentId = parentId
    this.title = title
    this.children = children || []
    this.hashValue = {...hashValue} || {}
    this.loaded = typeof loaded !== 'undefined' ? loaded : true
    this.location = location
    this.lastModified = lastModified ?? 0
  }

  // eslint-disable-next-line no-use-before-define
  findItemFilter(type:TItemType, fn:(Item)=>boolean):TItem|null {
    if (!this.index) {
      this.createIndex()
    }
    return Object.values(this.index[type]).find(fn)
  }

  findFolder(id:string|number): Folder {
    if (String(this.id) === String(id)) {
      return this
    }

    if (this.index) {
      return this.index.folder[id]
    }

    // traverse sub folders
    return this.children
      .filter(child => child instanceof Folder)
      .map(folder => folder as Folder)
      .map(folder => folder.findFolder(id))
      .filter(folder => !!folder)[0]
  }

  findBookmark(id:string|number):Bookmark {
    if (this.index) {
      return this.index.bookmark[id]
    }
    const bookmarkFound = this.children
      .filter(child => child instanceof Bookmark)
      .map(child => child as Bookmark)
      .find(bm => String(bm.id) === String(id))
    if (bookmarkFound) {
      return bookmarkFound
    }
    // traverse sub folders
    return this.children
      .filter(child => child instanceof Folder)
      .map(folder => folder as Folder)
      .map(folder => folder.findBookmark(id))
      .filter(bookmark => !!bookmark)[0]
  }

  // eslint-disable-next-line no-use-before-define
  findItem(type:TItemType, id:string|number):TItem|null {
    if (type === ItemType.FOLDER) {
      return this.findFolder(id)
    } else {
      return this.findBookmark(id)
    }
  }

  async traverse(fn: (Item, Folder)=>void): Promise<void> {
    await Parallel.each(this.children, async item => {
      await fn(item, this)
      if (item.type === 'folder') {
        await item.traverse(fn)
      }
    })
  }

  // eslint-disable-next-line no-use-before-define
  canMergeWith(otherItem: TItem): boolean {
    if (otherItem instanceof Folder) {
      return this.title === otherItem.title
    }
    return false
  }

  async hash(preserveOrder = false): Promise<string> {
    const cacheKey = 'hash:' + this.id + ',' + this.lastModified
    if (this.location === ItemLocation.LOCAL && this.lastModified !== 0) {
      if (await cache.has(cacheKey)) {
        this.hashValue = await cache.get(cacheKey)
      }
    }
    if (this.hashValue && this.hashValue[String(preserveOrder)]) {
      return this.hashValue[String(preserveOrder)]
    }

    if (!this.loaded) {
      throw new Error('Trying to calculate hash of a folder that isn\'t loaded')
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
    this.hashValue[String(preserveOrder)] = await Crypto.sha256(
      JSON.stringify({
        title: this.title,
        children: await Parallel.map(
          this.children,
          child => child.hash(preserveOrder),
          1
        )
      })
    )

    if (this.location === ItemLocation.LOCAL && this.lastModified !== 0) {
      await cache.set(cacheKey, this.hashValue)
    }

    return this.hashValue[String(preserveOrder)]
  }

  clone(withHash?:boolean, location?: TItemLocation):Folder {
    return new Folder({
      ...this,
      ...(!withHash && { hashValue: {} }),
      ...(location && {location}),
      children: this.children.map(child => child.clone(withHash, location ?? this.location))
    })
  }

  count():number {
    if (!this.index) {
      this.createIndex()
    }
    return Object.keys(this.index.bookmark).length
  }

  countFolders():number {
    if (!this.index) {
      this.createIndex()
    }
    return Object.keys(this.index.folder).length
  }

  createIndex():IItemIndex {
    this.index = {
      folder: { [this.id]: this },
      bookmark: Object.assign(
        {},
        this.children
          .filter(child => child instanceof Bookmark)
          .reduce((obj, child) => {
            obj[child.id] = child
            return obj
          }, {})
      )
    }

    this.children
      .filter(child => child instanceof Folder)
      .map(child => child.createIndex())
      .forEach(subIndex => {
        Object.assign(this.index.folder, subIndex.folder)
        Object.assign(this.index.bookmark, subIndex.bookmark)
      })
    return this.index
  }

  inspect(depth = 0):string {
    return (
      Array(depth < 0 ? 0 : depth)
        .fill('  ')
        .join('') +
      `+ #${this.id}[${this.title}] parentId: ${this.parentId}, hash: ${this
        .hashValue[String(true)] || this.hashValue[String(false)]}\n` +
      this.children
        .map(child =>
          child && child.inspect ? child.inspect(depth + 1) : String(child)
        )
        .join('\n')
    )
  }

  visitCreate(resource: TResource):Promise<number | string> {
    return resource.createFolder(this)
  }

  visitUpdate(resource: TResource): Promise<void> {
    return resource.updateFolder(this)
  }

  visitRemove(resource: TResource): Promise<void> {
    return resource.removeFolder(this)
  }

  static hydrate(obj: {id: string|number, parentId?: string|number, title?: string, location: TItemLocation, children: any[]}): Folder {
    return new Folder({
      ...obj,
      children: obj.children
        ? obj.children.map(child => {
          // Firefox seems to set 'url' even for folders
          if ('url' in child && typeof child.url === 'string') {
            return Bookmark.hydrate(child)
          } else {
            return Folder.hydrate(child)
          }
        })
        : null
    })
  }

  static getAncestorsOf(item: TItem, tree: Folder): TItem[] {
    const ancestors = [item]
    let parent = item
    while (parent.id !== tree.id) {
      ancestors.push(parent)
      parent = tree.findItem(ItemType.FOLDER, parent.parentId)
      if (!parent) {
        throw new Error('Item is not a descendant of the tree passed')
      }
    }
    ancestors.reverse()
    return ancestors
  }
}

export type TItem = Bookmark | Folder
