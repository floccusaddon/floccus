import { CapacitorSQLite, SQLiteConnection, SQLiteDBConnection } from '@capacitor-community/sqlite'
import AsyncLock from 'async-lock'

const DB_NAME = 'floccus'
const DB_VERSION = 1

/**
 * The native bookmark tree and the sync mappings live in here as rows, one row
 * per folder, bookmark and mapping.
 *
 * A note on id columns: all ids of the local tree are allocated by
 * CachingAdapter as ascending integers, so INTEGER affinity round-trips them
 * without changing their JS type. Mapping rows are different -- the remote id
 * comes from whatever the server uses, so those columns are TEXT and carry a
 * flag that remembers whether the id was a JS number, see NativeMappingsStore.
 *
 * Folders carry their subtree hash, so a sync only has to hash what changed
 * since the last one. `hash_settings` is the IHashSettings it was computed
 * with -- they are negotiated per sync, and a hash computed with different
 * settings is simply ignored.
 *
 * A pending sync continuation lives in here as well: one row per action of the
 * sync plan (continuation_actions), plus a single row holding the rest of it
 * (continuations), so that a progress tick only writes the actions that were
 * executed since the last one -- see Continuation.ts.
 *
 * `search_text` is what the native UI's search runs its LIKE against. It holds
 * the item's title (and, for bookmarks, its url and tags) lowercased in JS:
 * SQLite's own lower()/LIKE only fold ASCII, so searching for 'apfel' would
 * otherwise miss a bookmark titled 'Apfel' as soon as any letter is non-ASCII.
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS account_meta (
  account_id TEXT PRIMARY KEY NOT NULL,
  highest_id INTEGER NOT NULL DEFAULT 0,
  tree_initialized INTEGER NOT NULL DEFAULT 0,
  mappings_initialized INTEGER NOT NULL DEFAULT 0,
  tree_migrated INTEGER NOT NULL DEFAULT 0,
  mappings_migrated INTEGER NOT NULL DEFAULT 0,
  search_backfilled INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS folders (
  account_id TEXT NOT NULL,
  id INTEGER NOT NULL,
  parent_id INTEGER,
  title TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  hash TEXT,
  hash_settings TEXT,
  search_text TEXT,
  PRIMARY KEY (account_id, id)
);
CREATE INDEX IF NOT EXISTS folders_by_parent ON folders (account_id, parent_id, position);
CREATE TABLE IF NOT EXISTS bookmarks (
  account_id TEXT NOT NULL,
  id INTEGER NOT NULL,
  parent_id INTEGER,
  title TEXT,
  url TEXT,
  tags TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  search_text TEXT,
  PRIMARY KEY (account_id, id)
);
CREATE INDEX IF NOT EXISTS bookmarks_by_parent ON bookmarks (account_id, parent_id, position);
CREATE TABLE IF NOT EXISTS continuations (
  account_id TEXT PRIMARY KEY NOT NULL,
  strategy TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  structure TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS continuation_actions (
  account_id TEXT NOT NULL,
  diff_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  action TEXT NOT NULL,
  PRIMARY KEY (account_id, diff_id, seq)
);
CREATE TABLE IF NOT EXISTS mappings (
  account_id TEXT NOT NULL,
  type TEXT NOT NULL,
  local_id TEXT NOT NULL,
  remote_id TEXT NOT NULL,
  local_id_numeric INTEGER NOT NULL DEFAULT 0,
  remote_id_numeric INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (account_id, type, local_id)
);
`

/** One statement plus its bound values, the shape the plugin's executeSet takes */
export type TStatement = { statement: string, values?: any[] }

const connection = new SQLiteConnection(CapacitorSQLite)
const lock = new AsyncLock()
let dbPromise: Promise<SQLiteDBConnection> | null = null

async function connect(): Promise<SQLiteDBConnection> {
  // After a webview reload the native side may still hold the connection of
  // the previous run, so pick it up instead of creating a second one.
  const consistent = await connection.checkConnectionsConsistency()
  const isConn = (await connection.isConnection(DB_NAME, false)).result
  const db = consistent.result && isConn
    ? await connection.retrieveConnection(DB_NAME, false)
    : await connection.createConnection(DB_NAME, false, 'no-encryption', DB_VERSION, false)
  if (!(await db.isDBOpen()).result) {
    await db.open()
  }
  await db.execute(SCHEMA)
  await addMissingColumns(db, 'folders', { hash: 'TEXT', hash_settings: 'TEXT', search_text: 'TEXT' })
  await addMissingColumns(db, 'bookmarks', { search_text: 'TEXT' })
  await addMissingColumns(db, 'account_meta', { search_backfilled: 'INTEGER NOT NULL DEFAULT 0' })
  return db
}

/**
 * CREATE TABLE IF NOT EXISTS leaves a table that was created by an earlier
 * version of this schema as it is, so columns added later have to be filled in.
 */
async function addMissingColumns(db: SQLiteDBConnection, table: string, columns: Record<string, string>): Promise<void> {
  const info = await db.query(`PRAGMA table_info(${table})`)
  const existing = (info.values || []).map((column) => column.name)
  for (const [name, type] of Object.entries(columns)) {
    if (!existing.includes(name)) {
      await db.execute(`ALTER TABLE ${table} ADD COLUMN ${name} ${type};`)
    }
  }
}

function getDb(): Promise<SQLiteDBConnection> {
  if (!dbPromise) {
    dbPromise = connect().catch((e) => {
      // Don't cache a failed connection attempt
      dbPromise = null
      throw e
    })
  }
  return dbPromise
}

async function unlockedQuery(db: SQLiteDBConnection, statement: string, values?: any[]): Promise<any[]> {
  const result = await db.query(statement, values)
  return result.values || []
}

async function unlockedBatch(db: SQLiteDBConnection, statements: TStatement[]): Promise<void> {
  await db.executeSet(statements, true)
}

/**
 * All access goes through a single lock: the plugin happily accepts concurrent
 * calls, but they would interleave with each other's transactions. The lock is
 * FIFO, so statements are applied in the order they were submitted.
 */
export default class NativeDatabase {
  static async query(statement: string, values?: any[]): Promise<any[]> {
    const db = await getDb()
    return lock.acquire('db', () => unlockedQuery(db, statement, values))
  }

  /**
   * Applies all statements in one transaction, in the given order.
   */
  static async batch(statements: TStatement[]): Promise<void> {
    if (!statements.length) {
      return
    }
    const db = await getDb()
    return lock.acquire('db', () => unlockedBatch(db, statements))
  }
}
