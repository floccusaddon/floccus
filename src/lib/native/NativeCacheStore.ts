import { Preferences as Storage } from '@capacitor/preferences'
import { Bookmark, Folder, ItemLocation, TItem } from '../Tree'
import Logger from '../Logger'
import ICacheStore from '../interfaces/CacheStore'
import NativeDatabase, { TStatement } from './NativeDatabase'
import { parseTags, serializeTags } from './NativeTreeStore'

type TLocalItem = TItem<typeof ItemLocation.LOCAL>
type TLocalFolder = Folder<typeof ItemLocation.LOCAL>
type TLocalBookmark = Bookmark<typeof ItemLocation.LOCAL>

const INSERT_FOLDER =
  'INSERT OR REPLACE INTO cache_folders (account_id, id, parent_id, title, position, hash_value, is_root, loaded) VALUES (?,?,?,?,?,?,?,?)'
const INSERT_BOOKMARK =
  'INSERT OR REPLACE INTO cache_bookmarks (account_id, id, parent_id, title, url, tags, position) VALUES (?,?,?,?,?,?,?)'

/** Where `position` and `hash_value` sit in the value tuples below */
const FOLDER_POSITION = 2
const FOLDER_HASH = 3
const BOOKMARK_POSITION = 4

const ID_CHUNK_SIZE = 200

/** One row as it will be once the queue has been flushed */
interface IRow {
  /** The id as the column holds it, for the DELETEs -- the map key is a string */
  id: string | number
  /** Everything but account_id and id, in the order the INSERTs bind them */
  values: any[]
}

const migrations: Record<string, Promise<void>> = {}

function sameValues(a: any[], b: any[]): boolean {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      return false
    }
  }
  return true
}

/**
 * A folder's hashes go into a single column as they are.
 *
 * The local tree splits them into a hash and the settings it was computed with
 * (see NativeTreeStore), which can only ever hold one of them. That is fine
 * there, because that tree hashes itself and would just recompute a dropped
 * one -- the cache never hashes anything, it only carries the hashes the local
 * tree handed it, and what it hasn't got the next sync has to compute again.
 */
function serializeHashValue(hashValue?: Record<string, string>): string | null {
  if (!hashValue) {
    return null
  }
  const keys = Object.keys(hashValue)
  if (!keys.length) {
    return null
  }
  return JSON.stringify(hashValue)
}

function parseHashValue(value?: string | null): Record<string, string> | undefined {
  if (typeof value !== 'string') {
    return undefined
  }
  try {
    return JSON.parse(value)
  } catch (e) {
    Logger.log('Failed to parse stored cache hashes: ' + e.message)
    return undefined
  }
}

/**
 * Row storage for one account's sync cache -- the tree the last sync agreed on.
 *
 * The cache used to be one JSON blob in the preferences, rewritten in full
 * whenever the sync reported progress. On Android that is a SharedPreferences
 * write, i.e. the whole preferences file, several times a minute, and for a
 * large account it was megabytes a time -- the same thing that made the debug
 * log so expensive before it moved here (see NativeLogStore).
 *
 * So the rows are kept in lockstep with the tree instead: CacheTree says what
 * changed as it changes, and a persist writes that and nothing else.
 *
 * Nothing is written until #save, though. The cache has to land together with
 * the mappings and the continuation, which are persisted on the progress tick
 * as well: a cache that ran ahead of them would, after an interrupt, claim
 * items that the mappings know nothing about, and the next sync would take
 * them for already-synced and never create them on the server.
 *
 * `position` keeps sibling order, the way it does for the local tree.
 *
 * The ids are the local tree's (CachingTreeWrapper stamps the cache with the
 * very ids the local tree allocated), so INTEGER affinity round-trips them --
 * see the id note in NativeDatabase.
 */
export default class NativeCacheStore implements ICacheStore {
  private readonly accountId: string
  private queue: TStatement[] = []
  /** What the rows will hold once the queue has been flushed, by id */
  private folders = new Map<string, IRow>()
  private bookmarks = new Map<string, IRow>()
  private nextPosition = new Map<string, number>()
  /** Whether the two maps above describe what is actually stored */
  private indexed = false

  constructor(accountId: string) {
    this.accountId = accountId
  }

  /**
   * Returns null if this account has no cache stored.
   */
  async load(): Promise<TLocalFolder | null> {
    await this.migrateFromPreferences()
    // Anything recorded but never saved belongs to a sync that didn't get to
    // persist it, so it is no part of the cache
    this.queue = []
    const { folderRows, bookmarkRows } = await this.readIndex()
    return this.buildTree(folderRows, bookmarkRows)
  }

  /**
   * Replace the stored cache with this tree.
   *
   * Which is a diff rather than a rewrite: this runs at the start of every
   * sync, with the local tree as it is now, and most of it is usually what the
   * last sync already stored.
   */
  async setTree(root: TLocalFolder): Promise<void> {
    await this.ensureIndexed()
    this.nextPosition.clear()
    const seenFolders = new Set<string>()
    const seenBookmarks = new Set<string>()

    seenFolders.add(String(root.id))
    this.putFolder(root, 0)
    const stack: TLocalFolder[] = [root]
    while (stack.length) {
      const folder = stack.pop()
      folder.children.forEach((child, index) => {
        if (child instanceof Folder) {
          seenFolders.add(String(child.id))
          this.putFolder(child, index)
          stack.push(child)
        } else {
          seenBookmarks.add(String(child.id))
          this.putBookmark(child, index)
        }
      })
      this.nextPosition.set(String(folder.id), folder.children.length)
    }

    this.dropRows('cache_folders', this.folders, (key) => !seenFolders.has(key))
    this.dropRows('cache_bookmarks', this.bookmarks, (key) => !seenBookmarks.has(key))
  }

  createFolder(folder: TLocalFolder): void {
    this.putFolder(folder, this.takePosition(folder.parentId))
  }

  createBookmark(bookmark: TLocalBookmark): void {
    this.putBookmark(bookmark, this.takePosition(bookmark.parentId))
  }

  updateFolder(folder: TLocalFolder, moved: boolean): void {
    this.putFolder(folder, this.positionFor(this.folders, folder, moved, FOLDER_POSITION))
  }

  updateBookmark(bookmark: TLocalBookmark, moved: boolean): void {
    this.putBookmark(bookmark, this.positionFor(this.bookmarks, bookmark, moved, BOOKMARK_POSITION))
  }

  removeBookmark(bookmark: TLocalBookmark): void {
    this.bookmarks.delete(String(bookmark.id))
    this.queue.push({
      statement: 'DELETE FROM cache_bookmarks WHERE account_id = ? AND id = ?',
      values: [this.accountId, bookmark.id],
    })
  }

  /**
   * Takes the folder as it still is in the tree, so that its descendants can be
   * collected before the caller drops them.
   */
  removeFolder(folder: TLocalFolder): void {
    this.removeSubtree(folder)
    this.folders.delete(String(folder.id))
    this.queue.push({
      statement: 'DELETE FROM cache_folders WHERE account_id = ? AND id = ?',
      values: [this.accountId, folder.id],
    })
  }

  orderFolder(folder: TLocalFolder): void {
    folder.children.forEach((child, index) => {
      if (child instanceof Folder) {
        this.putFolder(child, index)
      } else {
        this.putBookmark(child, index)
      }
    })
    this.nextPosition.set(String(folder.id), folder.children.length)
  }

  /**
   * A subtree was spliced in wholesale: `oldChildren` are the children the
   * folder had before, `folder` is the folder as it is now.
   */
  importSubtree(oldChildren: TLocalItem[], folder: TLocalFolder): void {
    for (const child of oldChildren) {
      this.removeItem(child)
    }
    const stack: TLocalFolder[] = [folder]
    while (stack.length) {
      const current = stack.pop()
      current.children.forEach((child, index) => {
        if (child instanceof Folder) {
          this.putFolder(child, index)
          stack.push(child)
        } else {
          this.putBookmark(child, index)
        }
      })
      this.nextPosition.set(String(current.id), current.children.length)
    }
  }

  invalidateHashes(folderIds: (string | number)[]): void {
    const ids: (string | number)[] = []
    for (const folderId of folderIds) {
      const row = this.folders.get(String(folderId))
      if (!row || row.values[FOLDER_HASH] === null) {
        continue
      }
      row.values[FOLDER_HASH] = null
      ids.push(row.id)
    }
    for (const chunk of chunked(ids)) {
      this.queue.push({
        statement: `UPDATE cache_folders SET hash_value = NULL WHERE account_id = ? AND id IN (${chunk.map(() => '?').join(',')})`,
        values: [this.accountId, ...chunk],
      })
    }
  }

  /**
   * Everything recorded since the last save, in one transaction.
   *
   * The tree isn't needed here -- the rows already describe it -- and neither
   * is the bookmark filter: the rows hold the tree as it is, and the bookmarks
   * the server wouldn't take are dropped when the cache is loaded (see
   * Account#sync), which comes to the same thing and keeps the filter out of
   * every single write.
   */
  async save(): Promise<void> {
    const statements = this.queue
    this.queue = []
    if (!statements.length) {
      return
    }
    try {
      await NativeDatabase.batch(statements)
    } catch (e) {
      // The transaction rolled back, so put its statements back in front of
      // whatever was recorded since: the next save writes them again. Dropping
      // them instead would leave the rows behind for good -- later saves only
      // write what is queued, and the next sync reads the rows back before
      // setTree gets to fix them. The maps describe the rows as they will be
      // once the queue is flushed, which the queue still gets them to.
      this.queue = statements.concat(this.queue)
      throw e
    }
  }

  async clear(): Promise<void> {
    await this.migrateFromPreferences()
    this.queue = []
    this.folders.clear()
    this.bookmarks.clear()
    this.nextPosition.clear()
    // An empty cache is a state we know as well as any other
    this.indexed = true
    await NativeDatabase.batch(this.deleteAllStatements())
  }

  private putFolder(folder: TLocalFolder, position: number): void {
    this.put(this.folders, INSERT_FOLDER, folder.id, [
      folder.parentId ?? null,
      folder.title ?? null,
      position,
      serializeHashValue(folder.hashValue),
      folder.isRoot ? 1 : 0,
      folder.loaded === false ? 0 : 1,
    ])
  }

  private putBookmark(bookmark: TLocalBookmark, position: number): void {
    this.put(this.bookmarks, INSERT_BOOKMARK, bookmark.id, [
      bookmark.parentId ?? null,
      bookmark.title ?? null,
      bookmark.url ?? null,
      serializeTags(bookmark.tags),
      position,
    ])
  }

  /**
   * Queue the row unless it is already what we last wrote -- most of the tree
   * is untouched by any given sync, and setTree walks all of it.
   */
  private put(map: Map<string, IRow>, statement: string, id: string | number, values: any[]): void {
    const key = String(id)
    const stored = map.get(key)
    if (stored && sameValues(stored.values, values)) {
      return
    }
    map.set(key, { id, values })
    this.queue.push({ statement, values: [this.accountId, id, ...values] })
  }

  /**
   * An item that hasn't moved keeps the position it is stored with; one that
   * has is appended to its new parent, the way CachingAdapter appends it to the
   * children in memory.
   */
  private positionFor(map: Map<string, IRow>, item: TLocalItem, moved: boolean, positionIndex: number): number {
    if (!moved) {
      const stored = map.get(String(item.id))
      if (stored) {
        return stored.values[positionIndex]
      }
    }
    return this.takePosition(item.parentId)
  }

  private takePosition(parentId: string | number | null): number {
    const key = String(parentId)
    const position = this.nextPosition.get(key) ?? 0
    this.nextPosition.set(key, position + 1)
    return position
  }

  private notePosition(parentId: any, position: number): void {
    const key = String(parentId)
    this.nextPosition.set(key, Math.max(this.nextPosition.get(key) ?? 0, position + 1))
  }

  private removeItem(item: TLocalItem): void {
    if (item instanceof Folder) {
      this.removeFolder(item)
    } else {
      this.removeBookmark(item)
    }
  }

  /** Everything below (but not including) the folder */
  private removeSubtree(folder: TLocalFolder): void {
    const folderIds: (string | number)[] = []
    const bookmarkIds: (string | number)[] = []
    const stack: TLocalFolder[] = [folder]
    while (stack.length) {
      const current = stack.pop()
      for (const child of current.children) {
        if (child instanceof Folder) {
          folderIds.push(child.id)
          this.folders.delete(String(child.id))
          stack.push(child)
        } else {
          bookmarkIds.push(child.id)
          this.bookmarks.delete(String(child.id))
        }
      }
    }
    this.queueDeletes('cache_folders', folderIds)
    this.queueDeletes('cache_bookmarks', bookmarkIds)
  }

  private dropRows(table: string, map: Map<string, IRow>, gone: (key: string) => boolean): void {
    const ids: (string | number)[] = []
    for (const [key, row] of map) {
      if (gone(key)) {
        ids.push(row.id)
        map.delete(key)
      }
    }
    this.queueDeletes(table, ids)
  }

  private queueDeletes(table: string, ids: (string | number)[]): void {
    for (const chunk of chunked(ids)) {
      this.queue.push({
        statement: `DELETE FROM ${table} WHERE account_id = ? AND id IN (${chunk.map(() => '?').join(',')})`,
        values: [this.accountId, ...chunk],
      })
    }
  }

  private deleteAllStatements(): TStatement[] {
    return [
      { statement: 'DELETE FROM cache_folders WHERE account_id = ?', values: [this.accountId] },
      { statement: 'DELETE FROM cache_bookmarks WHERE account_id = ?', values: [this.accountId] },
    ]
  }

  private async ensureIndexed(): Promise<void> {
    if (this.indexed) {
      return
    }
    await this.migrateFromPreferences()
    await this.readIndex()
  }

  private async readIndex(): Promise<{ folderRows: any[], bookmarkRows: any[] }> {
    const folderRows = await NativeDatabase.query(
      'SELECT id, parent_id, title, position, hash_value, is_root, loaded FROM cache_folders WHERE account_id = ? ORDER BY position ASC, rowid ASC',
      [this.accountId]
    )
    const bookmarkRows = await NativeDatabase.query(
      'SELECT id, parent_id, title, url, tags, position FROM cache_bookmarks WHERE account_id = ? ORDER BY position ASC, rowid ASC',
      [this.accountId]
    )
    this.folders.clear()
    this.bookmarks.clear()
    this.nextPosition.clear()
    for (const row of folderRows) {
      this.folders.set(String(row.id), {
        id: row.id,
        values: [
          row.parent_id ?? null,
          row.title ?? null,
          row.position,
          row.hash_value ?? null,
          row.is_root ? 1 : 0,
          row.loaded === 0 ? 0 : 1,
        ],
      })
      this.notePosition(row.parent_id, row.position)
    }
    for (const row of bookmarkRows) {
      this.bookmarks.set(String(row.id), {
        id: row.id,
        values: [
          row.parent_id ?? null,
          row.title ?? null,
          row.url ?? null,
          row.tags ?? null,
          row.position,
        ],
      })
      this.notePosition(row.parent_id, row.position)
    }
    this.indexed = true
    return { folderRows, bookmarkRows }
  }

  private buildTree(folderRows: any[], bookmarkRows: any[]): TLocalFolder | null {
    const folders = new Map<string, TLocalFolder>()
    const childrenByParent = new Map<string, { position: number, item: TLocalItem }[]>()
    let root: TLocalFolder | null = null

    const addChild = (parentId: any, position: number, item: TLocalItem) => {
      const key = String(parentId)
      const siblings = childrenByParent.get(key) || []
      siblings.push({ position, item })
      childrenByParent.set(key, siblings)
    }

    for (const row of folderRows) {
      const folder = new Folder<typeof ItemLocation.LOCAL>({
        id: row.id,
        parentId: row.parent_id ?? undefined,
        title: row.title ?? undefined,
        hashValue: parseHashValue(row.hash_value) as any,
        loaded: row.loaded !== 0,
        isRoot: Boolean(row.is_root),
        location: ItemLocation.LOCAL,
      })
      folders.set(String(row.id), folder)
      if (row.parent_id === null || typeof row.parent_id === 'undefined') {
        root = folder
      } else {
        addChild(row.parent_id, row.position, folder)
      }
    }

    for (const row of bookmarkRows) {
      addChild(row.parent_id, row.position, new Bookmark<typeof ItemLocation.LOCAL>({
        id: row.id,
        parentId: row.parent_id,
        // A NULL title is one that was undefined, not an empty one
        title: row.title ?? undefined,
        url: row.url ?? '',
        tags: parseTags(row.tags),
        location: ItemLocation.LOCAL,
      }))
    }

    if (!root) {
      return null
    }

    for (const [parentId, siblings] of childrenByParent) {
      const parent = folders.get(parentId)
      if (!parent) {
        Logger.log('Dropping ' + siblings.length + ' cached items below unknown folder ' + parentId)
        continue
      }
      siblings.sort((a, b) => a.position - b.position)
      parent.children = siblings.map(({ item }) => item)
      // Keep the parentId identical to the parent's own id, including its type
      parent.children.forEach((child) => { child.parentId = parent.id })
    }

    return root
  }

  /**
   * Import the cache of an installation that still had it as one JSON blob in
   * the preferences. Runs once per account, then the old key is dropped.
   */
  private migrateFromPreferences(): Promise<void> {
    if (!migrations[this.accountId]) {
      migrations[this.accountId] = this.doMigrateFromPreferences().catch((e) => {
        delete migrations[this.accountId]
        throw e
      })
    }
    return migrations[this.accountId]
  }

  private async doMigrateFromPreferences(): Promise<void> {
    const [meta] = await NativeDatabase.query(
      'SELECT cache_migrated FROM account_meta WHERE account_id = ?',
      [this.accountId]
    )
    if (meta && meta.cache_migrated) {
      return
    }

    const cacheKey = `bookmarks[${this.accountId}].cache`
    const { value } = await Storage.get({ key: cacheKey })

    const statements: TStatement[] = [
      { statement: 'INSERT OR IGNORE INTO account_meta (account_id) VALUES (?)', values: [this.accountId] },
    ]
    const stored = parseStoredCache(value)
    if (stored) {
      Logger.log('Migrating the sync cache of account ' + this.accountId + ' to SQLite')
      statements.push(...this.deleteAllStatements(), ...subtreeStatements(this.accountId, Folder.hydrate(stored)))
    }
    statements.push({
      statement: 'UPDATE account_meta SET cache_migrated = 1 WHERE account_id = ?',
      values: [this.accountId],
    })

    await NativeDatabase.batch(statements)

    await Storage.remove({ key: cacheKey })
  }
}

function parseStoredCache(value?: string | null): any {
  if (!value) {
    return null
  }
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value
    // An account that was initialized but never synced has `{}` in there
    return parsed && Object.keys(parsed).length ? parsed : null
  } catch (e) {
    Logger.log('Failed to parse the stored sync cache: ' + e.message)
    return null
  }
}

/**
 * The whole tree as INSERTs, for the migration -- which runs before the store
 * has an index of its own, so this touches no state.
 */
function subtreeStatements(accountId: string, root: TLocalFolder): TStatement[] {
  const statements: TStatement[] = []
  const append = (item: TLocalItem, position: number) => {
    if (item instanceof Folder) {
      statements.push({
        statement: INSERT_FOLDER,
        values: [
          accountId,
          item.id,
          item.parentId ?? null,
          item.title ?? null,
          position,
          serializeHashValue(item.hashValue),
          item.isRoot ? 1 : 0,
          item.loaded === false ? 0 : 1,
        ],
      })
    } else {
      statements.push({
        statement: INSERT_BOOKMARK,
        values: [
          accountId,
          item.id,
          item.parentId ?? null,
          item.title ?? null,
          item.url ?? null,
          serializeTags(item.tags),
          position,
        ],
      })
    }
  }
  append(root, 0)
  const stack: TLocalFolder[] = [root]
  while (stack.length) {
    const folder = stack.pop()
    folder.children.forEach((child, index) => {
      append(child, index)
      if (child instanceof Folder) {
        stack.push(child)
      }
    })
  }
  return statements
}

function chunked(ids: (string | number)[]): (string | number)[][] {
  const chunks = []
  for (let i = 0; i < ids.length; i += ID_CHUNK_SIZE) {
    chunks.push(ids.slice(i, i + ID_CHUNK_SIZE))
  }
  return chunks
}
