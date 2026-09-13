import { Bookmark, Folder, ItemLocation, TItem } from '../Tree'
import Logger from '../Logger'
import NativeDatabase, { TStatement } from './NativeDatabase'
import { bookmarkSearchText, folderSearchText, parseTags } from './NativeTreeStore'

type TLocalItem = TItem<typeof ItemLocation.LOCAL>
type TLocalFolder = Folder<typeof ItemLocation.LOCAL>
type TLocalBookmark = Bookmark<typeof ItemLocation.LOCAL>

export interface ISearchResults {
  folders: TLocalFolder[]
  bookmarks: TLocalBookmark[]
}

/**
 * How many rows one search may pull out of each table. A phone can't render
 * thousands of list items anyway, and the ranking below puts what the user is
 * actually looking for at the top.
 */
const SEARCH_LIMIT = 500

const backfills: Record<string, Promise<void>> = {}

/**
 * Read-only access to one account's stored bookmark tree.
 *
 * This is what the native UI browses: it answers "the children of this folder",
 * "the folders of this account", "everything matching this query" with a query
 * each, instead of materializing the whole tree in memory and searching that.
 * Nothing here goes through NativeTree, so none of it hydrates the tree.
 *
 * The flip side is that writes still in NativeTreeStore's microtask queue are
 * invisible here -- callers that just changed something have to await
 * NativeTree#save() (which flushes the queue) before they read again.
 */
export default class NativeTreeQuery {
  private readonly accountId: string

  constructor(accountId: string) {
    this.accountId = accountId
  }

  /**
   * The account's folders as a tree, without any bookmarks in it. Folders are
   * a small fraction of a collection, and the UI needs the hierarchy while it
   * renders (breadcrumbs, the folder picker, the path below a search result).
   *
   * Returns null if this account has no tree stored yet.
   */
  async getFolderTree(): Promise<TLocalFolder | null> {
    const rows = await NativeDatabase.query(
      'SELECT id, parent_id, title, position FROM folders WHERE account_id = ? ORDER BY position ASC, rowid ASC',
      [this.accountId]
    )
    if (!rows.length) {
      return null
    }

    const folders = new Map<string, TLocalFolder>()
    const childrenByParent = new Map<string, { position: number, folder: TLocalFolder }[]>()
    let root: TLocalFolder | null = null

    for (const row of rows) {
      const folder = this.hydrateFolder(row)
      folders.set(String(row.id), folder)
      if (row.parent_id === null || typeof row.parent_id === 'undefined') {
        root = folder
      } else {
        const key = String(row.parent_id)
        const siblings = childrenByParent.get(key) || []
        siblings.push({ position: row.position, folder })
        childrenByParent.set(key, siblings)
      }
    }

    if (!root) {
      Logger.log('Native tree of account ' + this.accountId + ' has no root folder row')
      return null
    }

    for (const [parentId, siblings] of childrenByParent) {
      const parent = folders.get(parentId)
      if (!parent) {
        Logger.log('Dropping ' + siblings.length + ' folders below unknown folder ' + parentId)
        continue
      }
      siblings.sort((a, b) => a.position - b.position)
      parent.children = siblings.map(({ folder }) => folder)
      // Keep the parentId identical to the parent's own id, including its type
      parent.children.forEach((child) => { child.parentId = parent.id })
    }

    // findFolder() walks the whole tree without one, and the UI looks folders
    // up on every render
    root.createIndex()
    return root
  }

  /**
   * One folder's direct children, folders and bookmarks interleaved in the
   * order they are stored in.
   */
  async getChildren(folderId: string | number): Promise<TLocalItem[]> {
    const [folderRows, bookmarkRows] = await Promise.all([
      NativeDatabase.query(
        'SELECT id, parent_id, title, position FROM folders WHERE account_id = ? AND parent_id = ? ORDER BY position ASC, rowid ASC',
        [this.accountId, folderId]
      ),
      NativeDatabase.query(
        'SELECT id, parent_id, title, url, tags, position FROM bookmarks WHERE account_id = ? AND parent_id = ? ORDER BY position ASC, rowid ASC',
        [this.accountId, folderId]
      ),
    ])
    // Positions are handed out per parent across both tables, so they order the
    // two result sets into one list of siblings
    return [
      ...folderRows.map((row) => ({ position: row.position, item: this.hydrateFolder(row) as TLocalItem })),
      ...bookmarkRows.map((row) => ({ position: row.position, item: this.hydrateBookmark(row) as TLocalItem })),
    ]
      .sort((a, b) => a.position - b.position)
      .map(({ item }) => item)
  }

  /**
   * The tags of the bookmarks below the given folder (or of the whole account,
   * if none is given), most used first.
   */
  async getTags(folderId: string | number | null = null): Promise<string[]> {
    const rows = folderId === null
      ? await NativeDatabase.query(
        'SELECT tags FROM bookmarks WHERE account_id = ? AND tags IS NOT NULL AND tags <> \'[]\'',
        [this.accountId]
      )
      : await NativeDatabase.query(
        `${subtreeCTE()} SELECT tags FROM bookmarks WHERE account_id = ? AND parent_id IN (SELECT id FROM subtree) AND tags IS NOT NULL AND tags <> '[]'`,
        [folderId, this.accountId, this.accountId]
      )
    const counts = new Map<string, number>()
    for (const row of rows) {
      for (const tag of parseTags(row.tags) || []) {
        counts.set(tag, (counts.get(tag) || 0) + 1)
      }
    }
    return [...counts.entries()]
      .sort(([tag1, count1], [tag2, count2]) => count2 - count1 || tag1.localeCompare(tag2))
      .map(([tag]) => tag)
  }

  /**
   * Whether this account already holds a bookmark with the given url.
   */
  async findBookmarkByUrl(url: string): Promise<TLocalBookmark | null> {
    const [row] = await NativeDatabase.query(
      'SELECT id, parent_id, title, url, tags FROM bookmarks WHERE account_id = ? AND url = ? LIMIT 1',
      [this.accountId, url]
    )
    return row ? this.hydrateBookmark(row) : null
  }

  /**
   * Everything matching the query, ranked with the better title matches first.
   *
   * A query starting with '#' looks for a tag and only ever returns bookmarks.
   * Otherwise SQL narrows the rows down to those containing every term
   * somewhere, and the exact per-field predicates are applied to those.
   */
  async search(query: string, limit: number = SEARCH_LIMIT): Promise<ISearchResults> {
    const trimmed = (query || '').trim()
    if (!trimmed) {
      return { folders: [], bookmarks: [] }
    }
    await this.backfillSearchText()

    if (trimmed.startsWith('#')) {
      return { folders: [], bookmarks: await this.searchByTag(trimmed.slice(1).trim().toLowerCase(), limit) }
    }

    const query_ = trimmed.toLowerCase()
    // Same splitting as the predicates below use, so that a doubled space
    // behaves the way it always did
    const terms = query_.split(' ')
    const patterns = terms.filter(Boolean).map(likePattern)
    if (!patterns.length) {
      return { folders: [], bookmarks: [] }
    }
    const condition = patterns.map(() => 'search_text LIKE ? ESCAPE \'\\\'').join(' AND ')

    const [folderRows, bookmarkRows] = await Promise.all([
      NativeDatabase.query(
        `SELECT id, parent_id, title FROM folders WHERE account_id = ? AND ${condition} LIMIT ?`,
        [this.accountId, ...patterns, limit]
      ),
      NativeDatabase.query(
        `SELECT id, parent_id, title, url, tags FROM bookmarks WHERE account_id = ? AND ${condition} LIMIT ?`,
        [this.accountId, ...patterns, limit]
      ),
    ])

    const folders = folderRows
      .map((row) => this.hydrateFolder(row))
      .filter((folder) => matchesTitleFully(folder, terms) || matchesTitlePartially(folder, terms))
    const bookmarks = bookmarkRows
      .map((row) => this.hydrateBookmark(row))
      .filter((bookmark) =>
        matchesUrl(bookmark, terms) ||
        matchesTitleFully(bookmark, terms) ||
        matchesTitlePartially(bookmark, terms) ||
        matchesTags(bookmark, terms)
      )

    return {
      folders: rankByTitle(folders, terms),
      bookmarks: rankByTitle(bookmarks, terms),
    }
  }

  /**
   * Bookmarks carrying the tag, the ones tagged with it exactly before the ones
   * that merely contain it.
   */
  private async searchByTag(tag: string, limit: number): Promise<TLocalBookmark[]> {
    if (!tag) {
      return []
    }
    const rows = await NativeDatabase.query(
      'SELECT id, parent_id, title, url, tags FROM bookmarks WHERE account_id = ? AND tags IS NOT NULL AND tags <> \'[]\' AND search_text LIKE ? ESCAPE \'\\\' LIMIT ?',
      [this.accountId, likePattern(tag), limit]
    )
    const exact: TLocalBookmark[] = []
    const partial: TLocalBookmark[] = []
    for (const row of rows) {
      const bookmark = this.hydrateBookmark(row)
      const tags = (bookmark.tags || []).map((t) => t.toLowerCase())
      if (tags.includes(tag)) {
        exact.push(bookmark)
      } else if (tags.some((t) => t.includes(tag))) {
        partial.push(bookmark)
      }
    }
    return exact.concat(partial)
  }

  private hydrateFolder(row: any): TLocalFolder {
    return new Folder<typeof ItemLocation.LOCAL>({
      id: row.id,
      parentId: row.parent_id ?? undefined,
      title: row.title ?? undefined,
      location: ItemLocation.LOCAL,
    })
  }

  private hydrateBookmark(row: any): TLocalBookmark {
    return new Bookmark<typeof ItemLocation.LOCAL>({
      id: row.id,
      parentId: row.parent_id,
      // A NULL title is one that was undefined, not an empty one
      title: row.title ?? undefined,
      url: row.url ?? '',
      tags: parseTags(row.tags),
      location: ItemLocation.LOCAL,
    })
  }

  /**
   * Rows written before this version have no search_text, so they would never
   * match anything. Fill it in once per account, the first time it is searched.
   */
  private backfillSearchText(): Promise<void> {
    if (!backfills[this.accountId]) {
      backfills[this.accountId] = this.doBackfillSearchText().catch((e) => {
        delete backfills[this.accountId]
        throw e
      })
    }
    return backfills[this.accountId]
  }

  private async doBackfillSearchText(): Promise<void> {
    const [meta] = await NativeDatabase.query(
      'SELECT search_backfilled FROM account_meta WHERE account_id = ?',
      [this.accountId]
    )
    // No row at all means nothing has been stored for this account yet, and
    // whatever writes it first fills the column in as it goes
    if (!meta || meta.search_backfilled) {
      return
    }
    Logger.log('Building search index of account ' + this.accountId)

    const folderRows = await NativeDatabase.query(
      'SELECT id, title FROM folders WHERE account_id = ? AND search_text IS NULL',
      [this.accountId]
    )
    const bookmarkRows = await NativeDatabase.query(
      'SELECT id, title, url, tags FROM bookmarks WHERE account_id = ? AND search_text IS NULL',
      [this.accountId]
    )
    const statements: TStatement[] = [
      ...folderRows.map((row) => ({
        statement: 'UPDATE folders SET search_text = ? WHERE account_id = ? AND id = ?',
        values: [folderSearchText(row.title), this.accountId, row.id],
      })),
      ...bookmarkRows.map((row) => ({
        statement: 'UPDATE bookmarks SET search_text = ? WHERE account_id = ? AND id = ?',
        values: [
          bookmarkSearchText({ title: row.title ?? undefined, url: row.url ?? undefined, tags: parseTags(row.tags) }),
          this.accountId,
          row.id,
        ],
      })),
      {
        statement: 'UPDATE account_meta SET search_backfilled = 1 WHERE account_id = ?',
        values: [this.accountId],
      },
    ]
    await NativeDatabase.batch(statements)
  }
}

/**
 * Recursive CTE listing the given folder and every folder below it. Takes the
 * folder id and the account id, in that order.
 */
function subtreeCTE(): string {
  return `WITH RECURSIVE subtree(id) AS (
  SELECT ?
  UNION ALL
  SELECT folders.id FROM folders JOIN subtree ON folders.parent_id = subtree.id WHERE folders.account_id = ?
)`
}

function likePattern(term: string): string {
  return '%' + term.replace(/[\\%_]/g, '\\$&') + '%'
}

function matchesTitleFully(item: TLocalItem, terms: string[]): boolean {
  if (!item.title) {
    return false
  }
  const words = item.title.toLowerCase().split(' ')
  return terms.every((term) => words.some((word) => word === term))
}

function matchesTitlePartially(item: TLocalItem, terms: string[]): boolean {
  if (!item.title) {
    return false
  }
  const title = item.title.toLowerCase()
  return terms.every((term) => title.includes(term))
}

function matchesUrl(bookmark: TLocalBookmark, terms: string[]): boolean {
  if (!bookmark.url) {
    return false
  }
  const url = bookmark.url.toLowerCase()
  return terms.every((term) => url.includes(term))
}

function matchesTags(bookmark: TLocalBookmark, terms: string[]): boolean {
  if (!bookmark.tags || !bookmark.tags.length) {
    return false
  }
  const tags = bookmark.tags.map((tag) => tag.toLowerCase())
  return terms.every((term) => tags.some((tag) => tag.includes(term)))
}

/**
 * Whole-word title matches first, then partial title matches, then whatever
 * only matched on url or tags. Array#sort is stable, so items that rank the
 * same keep the order the database returned them in.
 */
function rankByTitle<T extends TLocalItem>(items: T[], terms: string[]): T[] {
  const rank = (item: T) => matchesTitleFully(item, terms) ? 0 : (matchesTitlePartially(item, terms) ? 1 : 2)
  return items.sort((a, b) => rank(a) - rank(b))
}
