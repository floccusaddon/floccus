import Crypto from './Crypto'
import Logger from './Logger'
import TResource from './interfaces/Resource'
import * as Parallel from 'async-parallel'

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

export class Bookmark<L extends TItemLocation> {
  public type = ItemType.BOOKMARK
  public id: string | number
  public parentId: string | number |null
  public title: string
  public url: string
  public tags: string[]
  public location: L
  public isRoot = false
  private hashValue: string

  constructor({ id, parentId, url, title, tags, location }: { id:string|number, parentId:string|number, url:string, title:string, tags?: string[], location: L }) {
    this.id = id
    this.parentId = parentId
    this.title = title
    this.tags = tags
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    this.location = location || ItemLocation.LOCAL

    if (this.location !== ItemLocation.LOCAL && this.location !== ItemLocation.SERVER) {
      throw new Error('Location failed validation')
    }

    try {
      // not a regular bookmark
      if (STRANGE_PROTOCOLS.some(proto => url.indexOf(proto) === 0)) {
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

  async hash():Promise<string> {
    if (!this.hashValue) {
      this.hashValue = await Crypto.sha256(
        JSON.stringify({ title: this.title, url: this.url })
      )
    }
    return this.hashValue
  }

  clone(withHash?: boolean):Bookmark<L> {
    return new Bookmark(this)
  }

  cloneWithLocation<L2 extends TItemLocation>(withHash:boolean, location: L2): Bookmark<L2> {
    return new Bookmark({
      ...this,
      location,
    })
  }

  createIndex():any {
    return { [this.id]: this }
  }

  // TODO: Make this return the correct type based on the type param
  findItem(type:TItemType, id:string|number):TItem<L>|null {
    if (type === 'bookmark' && String(id) === String(this.id)) {
      return this
    }
    return null
  }

  // TODO: Make this return the correct type based on the type param
  findItemFilter(type:TItemType, fn:(item:TItem<L>)=>boolean, prefer:(item: TItem<L>)=>number = () => 1):TItem<L>|null {
    if (type === ItemType.BOOKMARK && fn(this)) {
      return this
    }
    return null
  }

  count():number {
    return 1
  }

  inspect(depth = 0):string {
    return (
      Array(depth < 0 ? 0 : depth)
        .fill('  ')
        .join('') +
      `- #${this.id}[${this.title}](${this.url}) parentId: ${this.parentId}`
    )
  }

  visitCreate(resource: TResource<L>):Promise<number | string> {
    return resource.createBookmark(this)
  }

  visitUpdate(resource: TResource<L>): Promise<void> {
    return resource.updateBookmark(this)
  }

  visitRemove(resource: TResource<L>): Promise<void> {
    return resource.removeBookmark(this)
  }

  static hydrate<L2 extends TItemLocation>(obj: any):Bookmark<L2> {
    return new Bookmark(obj)
  }
}

export class Folder<L extends TItemLocation> {
  public type = ItemType.FOLDER
  public id: number | string
  public title?: string
  public parentId: number | string
  public children: TItem<L>[]
  public hashValue: Record<string,string>
  public isRoot = false
  public loaded = true
  public location: L
  private index: IItemIndex<L>

  constructor({ id, parentId, title, children, hashValue, loaded, location, isRoot }
  :{
    id:number|string,
    parentId?:number|string,
    title?:string,
    // eslint-disable-next-line no-use-before-define
    children?: TItem<L>[],
    hashValue?:Record<'true'|'false',string>,
    loaded?: boolean,
    location: L,
    isRoot?: boolean,
  }) {
    this.id = id
    this.parentId = parentId
    this.title = title
    this.children = children || []
    this.hashValue = {...hashValue} || {}
    this.loaded = loaded !== false
    this.isRoot = isRoot
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    this.location = location || ItemLocation.LOCAL

    if (this.location !== ItemLocation.LOCAL && this.location !== ItemLocation.SERVER) {
      throw new Error('Location failed validation')
    }
  }

  // eslint-disable-next-line no-use-before-define
  findItemFilter(type:TItemType, fn:(Item)=>boolean, prefer:(Item)=>number = () => 1):TItem<L>|null {
    if (!this.index) {
      this.createIndex()
    }
    const candidates = Object.values(this.index[type]).filter(fn)
    // return the preferred match based on a preference measure
    return candidates.sort((a,b) => prefer(a) - prefer(b)).pop()
  }

  findFolder(id:string|number): Folder<L> {
    if (String(this.id) === String(id)) {
      return this
    }

    if (this.index) {
      return this.index.folder[id]
    }

    // traverse sub folders
    return this.children
      .filter(child => child instanceof Folder)
      .map(folder => folder as Folder<L>)
      .map(folder => folder.findFolder(id))
      .filter(folder => !!folder)[0]
  }

  findBookmark(id:string|number):Bookmark<L> {
    if (this.index) {
      return this.index.bookmark[id]
    }
    const bookmarkFound = this.children
      .filter(child => child instanceof Bookmark)
      .map(child => child as Bookmark<L>)
      .find(bm => String(bm.id) === String(id))
    if (bookmarkFound) {
      return bookmarkFound
    }
    // traverse sub folders
    return this.children
      .filter(child => child instanceof Folder)
      .map(folder => folder as Folder<L>)
      .map(folder => folder.findBookmark(id))
      .filter(bookmark => !!bookmark)[0]
  }

  // eslint-disable-next-line no-use-before-define
  findItem(type:TItemType, id:string|number):TItem<L>|null {
    if (type === ItemType.FOLDER) {
      return this.findFolder(id)
    } else {
      return this.findBookmark(id)
    }
  }

  async traverse(fn: (item:TItem<L>, folder: Folder<L>)=>void): Promise<void> {
    await Parallel.each(this.children, async item => {
      await fn(item, this)
      if (item.type === 'folder') {
        // give the browser time to breathe
        await Promise.resolve()
        await item.traverse(fn)
      }
    }, 10)
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
      return this.children.reduce(
        (count, item) =>
          otherItem.children.find(i => i.title === item.title) ? count + 1 : count,
        0
      ) / Math.max(this.children.length, otherItem.children.length)
    }
    return 0
  }

  async hash(preserveOrder = false): Promise<string> {
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
    return this.hashValue[String(preserveOrder)]
  }

  clone(withHash?:boolean):Folder<L> {
    return new Folder({
      ...this,
      ...(!withHash && { hashValue: {} }),
      children: this.children.map(child => child.clone(withHash))
    })
  }

  cloneWithLocation<L2 extends TItemLocation>(withHash:boolean, location: L2):Folder<L2> {
    return new Folder({
      ...this,
      location,
      ...(!withHash && { hashValue: {} }),
      children: this.children.map(child => child.cloneWithLocation(withHash, location))
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

  createIndex():IItemIndex<L> {
    this.index = {
      folder: { [this.id]: this },
      bookmark: this.children
        .filter(child => child instanceof Bookmark)
        .reduce((obj, child) => {
          obj[child.id] = child
          return obj
        }, {})
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

  visitCreate(resource: TResource<L>):Promise<number | string> {
    return resource.createFolder(this)
  }

  visitUpdate(resource: TResource<L>): Promise<void> {
    return resource.updateFolder(this)
  }

  visitRemove(resource: TResource<L>): Promise<void> {
    return resource.removeFolder(this)
  }

  static hydrate<L2 extends TItemLocation>(obj: {id: string|number, parentId?: string|number, title?: string, location: L2, children: any[], isRoot: boolean}): Folder<L2> {
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

  static getAncestorsOf<L2 extends TItemLocation>(item: TItem<L2>, tree: Folder<L2>): TItem<L2>[] {
    const ancestors = [item]
    let parent = item
    while (String(parent.id) !== String(tree.id)) {
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
