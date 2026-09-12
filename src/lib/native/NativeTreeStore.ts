import { Preferences as Storage } from '@capacitor/preferences'
import { Bookmark, Folder, ItemLocation, TItem } from '../Tree'
import Logger from '../Logger'
import NativeDatabase, { TStatement } from './NativeDatabase'

type TLocalItem = TItem<typeof ItemLocation.LOCAL>
type TLocalFolder = Folder<typeof ItemLocation.LOCAL>
type TLocalBookmark = Bookmark<typeof ItemLocation.LOCAL>

export interface ILoadedTree {
  root: TLocalFolder
  highestId: number
}

const INSERT_FOLDER =
  'INSERT OR REPLACE INTO folders (account_id, id, parent_id, title, position) VALUES (?,?,?,?,?)'
const INSERT_BOOKMARK =
  'INSERT OR REPLACE INTO bookmarks (account_id, id, parent_id, title, url, tags, position) VALUES (?,?,?,?,?,?,?)'

const DELETE_CHUNK_SIZE = 200

const migrations: Record<string, Promise<void>> = {}

function serializeTags(tags?: string[]): string | null {
  return typeof tags === 'undefined' ? null : JSON.stringify(tags)
}

function parseTags(tags?: string | null): string[] | undefined {
  if (typeof tags !== 'string') {
    return undefined
  }
  try {
    return JSON.parse(tags)
  } catch (e) {
    Logger.log('Failed to parse stored bookmark tags: ' + e.message)
    return undefined
  }
}

/**
 * Row storage for one account's local bookmark tree.
 *
 * The tree itself still lives in memory in NativeTree -- this class only keeps
 * the rows in lockstep with it, so that a change costs one row write instead of
 * a re-serialization of the whole tree.
 *
 * Sibling order is kept in the `position` column. Since CachingAdapter only
 * ever appends to a folder's children, new rows get an ever increasing position
 * within their parent (see #takePosition); only orderFolder and bulk imports
 * renumber a folder's children.
 */
export default class NativeTreeStore {
  private readonly accountId: string
  private queue: TStatement[] = []
  private scheduled: Promise<void> | null = null
  private tail: Promise<void> = Promise.resolve()
  private nextPosition = new Map<string, number>()

  constructor(accountId: string) {
    this.accountId = accountId
  }

  /**
   * Returns null if this account has no tree stored yet -- the caller is then
   * expected to seed one via #initialize.
   */
  async load(): Promise<ILoadedTree | null> {
    await this.migrateFromPreferences()
    // Anything we haven't written yet would be missing from what we read here
    await this.flush()

    const [meta] = await NativeDatabase.query(
      'SELECT highest_id, tree_initialized FROM account_meta WHERE account_id = ?',
      [this.accountId]
    )
    if (!meta || !meta.tree_initialized) {
      return null
    }

    const folderRows = await NativeDatabase.query(
      'SELECT id, parent_id, title, position FROM folders WHERE account_id = ? ORDER BY position ASC, rowid ASC',
      [this.accountId]
    )
    const bookmarkRows = await NativeDatabase.query(
      'SELECT id, parent_id, title, url, tags, position FROM bookmarks WHERE account_id = ? ORDER BY position ASC, rowid ASC',
      [this.accountId]
    )

    return {
      root: this.buildTree(folderRows, bookmarkRows),
      highestId: meta.highest_id || 0,
    }
  }

  /**
   * Replace whatever is stored for this account with the given tree.
   */
  async initialize(root: TLocalFolder, highestId: number): Promise<void> {
    await this.migrateFromPreferences()
    this.nextPosition.clear()
    await this.enqueue([
      ...this.deleteAllStatements(),
      ...this.subtreeStatements(root, true),
      ...this.highestIdStatements(highestId),
      {
        statement: 'UPDATE account_meta SET tree_initialized = 1 WHERE account_id = ?',
        values: [this.accountId],
      },
    ])
  }

  createFolder(folder: TLocalFolder, highestId: number): Promise<void> {
    return this.enqueue([
      {
        statement: INSERT_FOLDER,
        values: [
          this.accountId,
          folder.id,
          folder.parentId ?? null,
          folder.title ?? null,
          this.takePosition(folder.parentId),
        ],
      },
      ...this.highestIdStatements(highestId),
    ])
  }

  createBookmark(bookmark: TLocalBookmark, highestId: number): Promise<void> {
    return this.enqueue([
      {
        statement: INSERT_BOOKMARK,
        values: [
          this.accountId,
          bookmark.id,
          bookmark.parentId ?? null,
          bookmark.title ?? null,
          bookmark.url ?? null,
          serializeTags(bookmark.tags),
          this.takePosition(bookmark.parentId),
        ],
      },
      ...this.highestIdStatements(highestId),
    ])
  }

  updateBookmark(bookmark: TLocalBookmark, moved: boolean): Promise<void> {
    if (moved) {
      return this.enqueue([{
        statement: 'UPDATE bookmarks SET parent_id = ?, title = ?, url = ?, tags = ?, position = ? WHERE account_id = ? AND id = ?',
        values: [
          bookmark.parentId ?? null,
          bookmark.title ?? null,
          bookmark.url ?? null,
          serializeTags(bookmark.tags),
          this.takePosition(bookmark.parentId),
          this.accountId,
          bookmark.id,
        ],
      }])
    }
    return this.enqueue([{
      statement: 'UPDATE bookmarks SET title = ?, url = ?, tags = ? WHERE account_id = ? AND id = ?',
      values: [
        bookmark.title ?? null,
        bookmark.url ?? null,
        serializeTags(bookmark.tags),
        this.accountId,
        bookmark.id,
      ],
    }])
  }

  updateFolder(folder: TLocalFolder, moved: boolean): Promise<void> {
    if (moved) {
      return this.enqueue([{
        statement: 'UPDATE folders SET parent_id = ?, title = ?, position = ? WHERE account_id = ? AND id = ?',
        values: [
          folder.parentId ?? null,
          folder.title ?? null,
          this.takePosition(folder.parentId),
          this.accountId,
          folder.id,
        ],
      }])
    }
    return this.enqueue([{
      statement: 'UPDATE folders SET title = ? WHERE account_id = ? AND id = ?',
      values: [folder.title ?? null, this.accountId, folder.id],
    }])
  }

  removeBookmark(bookmark: TLocalBookmark): Promise<void> {
    return this.enqueue([{
      statement: 'DELETE FROM bookmarks WHERE account_id = ? AND id = ?',
      values: [this.accountId, bookmark.id],
    }])
  }

  /**
   * Takes the folder as it still is in the in-memory tree, so that its
   * descendants can be collected before the caller drops them.
   */
  removeFolder(folder: TLocalFolder): Promise<void> {
    return this.enqueue([
      ...this.subtreeDeleteStatements(folder),
      {
        statement: 'DELETE FROM folders WHERE account_id = ? AND id = ?',
        values: [this.accountId, folder.id],
      },
    ])
  }

  /**
   * Renumber a folder's children after their order changed.
   */
  orderFolder(folder: TLocalFolder): Promise<void> {
    const statements = folder.children.map((child, index) => ({
      statement: child instanceof Folder
        ? 'UPDATE folders SET position = ? WHERE account_id = ? AND id = ?'
        : 'UPDATE bookmarks SET position = ? WHERE account_id = ? AND id = ?',
      values: [index, this.accountId, child.id],
    }))
    this.nextPosition.set(String(folder.id), folder.children.length)
    return this.enqueue(statements)
  }

  /**
   * A bulk import replaces a folder's children wholesale: `oldChildren` are the
   * children it had before, `folder` is the folder as it is now.
   */
  bulkImport(oldChildren: TLocalItem[], folder: TLocalFolder, highestId: number): Promise<void> {
    return this.enqueue([
      ...oldChildren.flatMap((child) => this.itemDeleteStatements(child)),
      ...this.subtreeStatements(folder, false),
      ...this.highestIdStatements(highestId),
    ])
  }

  async clear(): Promise<void> {
    await this.migrateFromPreferences()
    this.nextPosition.clear()
    await this.enqueue([
      ...this.deleteAllStatements(),
      {
        statement: 'UPDATE account_meta SET tree_initialized = 0, highest_id = 0 WHERE account_id = ?',
        values: [this.accountId],
      },
    ])
  }

  /**
   * Wait for all writes handed to this store so far to have hit the database.
   */
  async flush(): Promise<void> {
    await this.tail
  }

  private buildTree(folderRows: any[], bookmarkRows: any[]): TLocalFolder {
    const folders = new Map<string, TLocalFolder>()
    const childrenByParent = new Map<string, { position: number, item: TLocalItem }[]>()
    let root: TLocalFolder | null = null

    const addChild = (parentId: any, position: number, item: TLocalItem) => {
      const key = String(parentId)
      const siblings = childrenByParent.get(key) || []
      siblings.push({ position, item })
      childrenByParent.set(key, siblings)
      this.nextPosition.set(key, Math.max(this.nextPosition.get(key) ?? 0, position + 1))
    }

    for (const row of folderRows) {
      const folder = new Folder<typeof ItemLocation.LOCAL>({
        id: row.id,
        parentId: row.parent_id ?? undefined,
        title: row.title ?? undefined,
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
      const bookmark = new Bookmark<typeof ItemLocation.LOCAL>({
        id: row.id,
        parentId: row.parent_id,
        // A NULL title is one that was undefined, not an empty one
        title: row.title ?? undefined,
        url: row.url ?? '',
        tags: parseTags(row.tags),
        location: ItemLocation.LOCAL,
      })
      addChild(row.parent_id, row.position, bookmark)
    }

    if (!root) {
      // A stored tree always has its root row; if it doesn't, better to start
      // over than to hand out half a tree.
      Logger.log('Native tree of account ' + this.accountId + ' has no root row, starting from scratch')
      return new Folder({ id: 0, title: 'root', location: ItemLocation.LOCAL })
    }

    for (const [parentId, siblings] of childrenByParent) {
      const parent = folders.get(parentId)
      if (!parent) {
        Logger.log('Dropping ' + siblings.length + ' orphaned items below unknown folder ' + parentId)
        continue
      }
      siblings.sort((a, b) => a.position - b.position)
      parent.children = siblings.map(({ item }) => item)
      // Keep the parentId identical to the parent's own id, including its type
      parent.children.forEach((child) => { child.parentId = parent.id })
    }

    return root
  }

  private takePosition(parentId: string | number | null): number {
    const key = String(parentId)
    const position = this.nextPosition.get(key) ?? 0
    this.nextPosition.set(key, position + 1)
    return position
  }

  private appendItemStatements(statements: TStatement[], item: TLocalItem, position: number): void {
    if (item instanceof Folder) {
      statements.push({
        statement: INSERT_FOLDER,
        values: [this.accountId, item.id, item.parentId ?? null, item.title ?? null, position],
      })
    } else {
      statements.push({
        statement: INSERT_BOOKMARK,
        values: [
          this.accountId,
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

  private subtreeStatements(root: TLocalFolder, includeRoot: boolean): TStatement[] {
    const statements: TStatement[] = []
    if (includeRoot) {
      this.appendItemStatements(statements, root, 0)
    }
    const stack: TLocalFolder[] = [root]
    while (stack.length) {
      const folder = stack.pop()
      folder.children.forEach((child, index) => {
        this.appendItemStatements(statements, child, index)
        if (child instanceof Folder) {
          stack.push(child)
        }
      })
      this.nextPosition.set(String(folder.id), folder.children.length)
    }
    return statements
  }

  private itemDeleteStatements(item: TLocalItem): TStatement[] {
    if (item instanceof Folder) {
      return [
        ...this.subtreeDeleteStatements(item),
        {
          statement: 'DELETE FROM folders WHERE account_id = ? AND id = ?',
          values: [this.accountId, item.id],
        },
      ]
    }
    return [{
      statement: 'DELETE FROM bookmarks WHERE account_id = ? AND id = ?',
      values: [this.accountId, item.id],
    }]
  }

  /**
   * Delete statements for everything below (but not including) the folder.
   */
  private subtreeDeleteStatements(folder: TLocalFolder): TStatement[] {
    const folderIds: (string | number)[] = []
    const bookmarkIds: (string | number)[] = []
    const stack: TLocalFolder[] = [folder]
    while (stack.length) {
      const current = stack.pop()
      for (const child of current.children) {
        if (child instanceof Folder) {
          folderIds.push(child.id)
          stack.push(child)
        } else {
          bookmarkIds.push(child.id)
        }
      }
    }
    return [
      ...this.deleteByIdStatements('folders', folderIds),
      ...this.deleteByIdStatements('bookmarks', bookmarkIds),
    ]
  }

  private deleteByIdStatements(table: string, ids: (string | number)[]): TStatement[] {
    const statements: TStatement[] = []
    for (let i = 0; i < ids.length; i += DELETE_CHUNK_SIZE) {
      const chunk = ids.slice(i, i + DELETE_CHUNK_SIZE)
      statements.push({
        statement: `DELETE FROM ${table} WHERE account_id = ? AND id IN (${chunk.map(() => '?').join(',')})`,
        values: [this.accountId, ...chunk],
      })
    }
    return statements
  }

  private deleteAllStatements(): TStatement[] {
    return [
      { statement: 'DELETE FROM folders WHERE account_id = ?', values: [this.accountId] },
      { statement: 'DELETE FROM bookmarks WHERE account_id = ?', values: [this.accountId] },
    ]
  }

  private highestIdStatements(highestId: number): TStatement[] {
    return [
      {
        statement: 'INSERT OR IGNORE INTO account_meta (account_id) VALUES (?)',
        values: [this.accountId],
      },
      {
        statement: 'UPDATE account_meta SET highest_id = ? WHERE account_id = ?',
        values: [highestId, this.accountId],
      },
    ]
  }

  /**
   * Writes are collected and committed in one transaction per tick: a sync
   * fires off many of them and they would otherwise each pay for their own
   * transaction.
   */
  private enqueue(statements: TStatement[]): Promise<void> {
    if (!statements.length) {
      return this.tail
    }
    this.queue.push(...statements)
    if (!this.scheduled) {
      this.scheduled = new Promise((resolve, reject) => {
        setTimeout(() => {
          this.flushNow().then(resolve, reject)
        }, 0)
      })
      this.tail = this.scheduled.catch((e) => {
        // The error is passed on to whoever enqueued the failing write; this
        // branch only keeps #flush from rejecting a second time for it.
        Logger.log('Failed to persist bookmarks of account ' + this.accountId + ': ' + e.message)
      })
    }
    return this.scheduled
  }

  private flushNow(): Promise<void> {
    const statements = this.queue
    this.queue = []
    this.scheduled = null
    return NativeDatabase.batch(statements)
  }

  /**
   * Import the tree of an installation that still had it as one JSON blob in
   * the preferences. Runs once per account, then the old keys are dropped.
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
      'SELECT tree_migrated FROM account_meta WHERE account_id = ?',
      [this.accountId]
    )
    if (meta && meta.tree_migrated) {
      return
    }

    const treeKey = `bookmarks[${this.accountId}].tree`
    const highestIdKey = `bookmarks[${this.accountId}].highestId`
    const { value: tree } = await Storage.get({ key: treeKey })
    const { value: highestId } = await Storage.get({ key: highestIdKey })

    const statements: TStatement[] = [
      { statement: 'INSERT OR IGNORE INTO account_meta (account_id) VALUES (?)', values: [this.accountId] },
    ]
    if (tree) {
      Logger.log('Migrating stored bookmarks of account ' + this.accountId + ' to SQLite')
      const parsedHighestId = parseInt(highestId ?? '0', 10)
      const root = Folder.hydrate<typeof ItemLocation.LOCAL>(JSON.parse(tree))
      statements.push(
        ...this.deleteAllStatements(),
        ...this.subtreeStatements(root, true),
        {
          statement: 'UPDATE account_meta SET tree_initialized = 1, highest_id = ? WHERE account_id = ?',
          values: [Number.isNaN(parsedHighestId) ? 0 : parsedHighestId, this.accountId],
        }
      )
      // The tree we just wrote defines the positions; don't let the numbering
      // we built up here leak into the freshly loaded tree.
      this.nextPosition.clear()
    }
    statements.push({
      statement: 'UPDATE account_meta SET tree_migrated = 1 WHERE account_id = ?',
      values: [this.accountId],
    })

    await NativeDatabase.batch(statements)

    await Storage.remove({ key: treeKey })
    await Storage.remove({ key: highestIdKey })
  }
}
