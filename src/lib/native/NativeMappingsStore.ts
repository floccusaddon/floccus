import { Preferences as Storage } from '@capacitor/preferences'
import { ItemType } from '../Tree'
import Logger from '../Logger'
import NativeDatabase, { TStatement } from './NativeDatabase'

type TIdMap = Record<string, string | number>

export interface IItemTypeMapping {
  LocalToServer: TIdMap
  ServerToLocal: TIdMap
}

export interface IMappingsData {
  folders: IItemTypeMapping
  bookmarks: IItemTypeMapping
}

interface IMappingRow {
  type: string
  localId: string
  remoteId: string
  localIdNumeric: boolean
  remoteIdNumeric: boolean
}

const TYPES: { key: keyof IMappingsData, type: string }[] = [
  { key: 'folders', type: ItemType.FOLDER },
  { key: 'bookmarks', type: ItemType.BOOKMARK },
]

const UPSERT_MAPPING =
  'INSERT OR REPLACE INTO mappings (account_id, type, local_id, remote_id, local_id_numeric, remote_id_numeric) VALUES (?,?,?,?,?,?)'

// What we last saw in the database, per account, so that persisting mappings
// only writes the rows that actually changed.
const persisted: Record<string, Map<string, IMappingRow>> = {}
const migrations: Record<string, Promise<void>> = {}

function emptyMappings(): IMappingsData {
  return {
    folders: { LocalToServer: {}, ServerToLocal: {} },
    bookmarks: { LocalToServer: {}, ServerToLocal: {} },
  }
}

function rowKey(row: IMappingRow): string {
  return row.type + '|' + row.localId
}

function rowsEqual(a: IMappingRow, b: IMappingRow): boolean {
  return a.remoteId === b.remoteId &&
    a.localIdNumeric === b.localIdNumeric &&
    a.remoteIdNumeric === b.remoteIdNumeric
}

function restoreId(id: string, numeric: boolean): string | number {
  return numeric ? Number(id) : id
}

/**
 * Row storage for one account's local<->server id mappings.
 *
 * Mappings are held in memory as two mirrored objects (see Mappings.ts) and
 * handed to us in full on every persist, so we diff them against what we know
 * to be in the database and only write the difference.
 *
 * `LocalToServer` is taken as the authoritative direction -- the two maps are
 * kept as exact inverses of each other by Mappings#add/#remove, and ServerToLocal
 * is rebuilt from the rows on load.
 *
 * Both ids are stored as TEXT: a local id is always a number, but a remote id is
 * whatever the server uses, and an id like '007' must not come back as 7. The
 * `*_numeric` columns remember which side was a number so that the maps are
 * restored with the very same types they were persisted with.
 */
export default class NativeMappingsStore {
  private readonly accountId: string

  constructor(accountId: string) {
    this.accountId = accountId
  }

  async isInitialized(): Promise<boolean> {
    await this.migrateFromPreferences()
    const [meta] = await NativeDatabase.query(
      'SELECT mappings_initialized FROM account_meta WHERE account_id = ?',
      [this.accountId]
    )
    return Boolean(meta && meta.mappings_initialized)
  }

  async init(): Promise<void> {
    await this.migrateFromPreferences()
    persisted[this.accountId] = new Map()
    await NativeDatabase.batch([
      { statement: 'DELETE FROM mappings WHERE account_id = ?', values: [this.accountId] },
      { statement: 'INSERT OR IGNORE INTO account_meta (account_id) VALUES (?)', values: [this.accountId] },
      {
        statement: 'UPDATE account_meta SET mappings_initialized = 1 WHERE account_id = ?',
        values: [this.accountId],
      },
    ])
  }

  async load(): Promise<IMappingsData> {
    await this.migrateFromPreferences()
    const rows = await NativeDatabase.query(
      'SELECT type, local_id, remote_id, local_id_numeric, remote_id_numeric FROM mappings WHERE account_id = ?',
      [this.accountId]
    )

    const mappings = emptyMappings()
    const snapshot = new Map<string, IMappingRow>()
    for (const row of rows) {
      const mappingRow: IMappingRow = {
        type: row.type,
        localId: String(row.local_id),
        remoteId: String(row.remote_id),
        localIdNumeric: Boolean(row.local_id_numeric),
        remoteIdNumeric: Boolean(row.remote_id_numeric),
      }
      const entry = TYPES.find(({ type }) => type === mappingRow.type)
      if (!entry) {
        Logger.log('Ignoring mapping row of unknown type ' + mappingRow.type)
        continue
      }
      const localId = restoreId(mappingRow.localId, mappingRow.localIdNumeric)
      const remoteId = restoreId(mappingRow.remoteId, mappingRow.remoteIdNumeric)
      mappings[entry.key].LocalToServer[mappingRow.localId] = remoteId
      mappings[entry.key].ServerToLocal[mappingRow.remoteId] = localId
      snapshot.set(rowKey(mappingRow), mappingRow)
    }
    persisted[this.accountId] = snapshot
    return mappings
  }

  async save(data: IMappingsData): Promise<void> {
    await this.migrateFromPreferences()
    const snapshot = await this.getSnapshot()
    const rows = NativeMappingsStore.rowsOf(data)

    const statements: TStatement[] = []
    for (const [key, row] of snapshot) {
      if (!rows.has(key)) {
        statements.push({
          statement: 'DELETE FROM mappings WHERE account_id = ? AND type = ? AND local_id = ?',
          values: [this.accountId, row.type, row.localId],
        })
      }
    }
    for (const [key, row] of rows) {
      const old = snapshot.get(key)
      if (!old || !rowsEqual(old, row)) {
        statements.push({ statement: UPSERT_MAPPING, values: this.upsertValues(row) })
      }
    }

    if (!statements.length) {
      return
    }
    await NativeDatabase.batch(statements)
    persisted[this.accountId] = rows
  }

  async clear(): Promise<void> {
    await this.migrateFromPreferences()
    persisted[this.accountId] = new Map()
    await NativeDatabase.batch([
      { statement: 'DELETE FROM mappings WHERE account_id = ?', values: [this.accountId] },
      {
        statement: 'UPDATE account_meta SET mappings_initialized = 0 WHERE account_id = ?',
        values: [this.accountId],
      },
    ])
  }

  private upsertValues(row: IMappingRow): any[] {
    return [
      this.accountId,
      row.type,
      row.localId,
      row.remoteId,
      row.localIdNumeric ? 1 : 0,
      row.remoteIdNumeric ? 1 : 0,
    ]
  }

  /**
   * The rows currently in the database. Usually known from the last #load, but
   * a fresh storage instance may be asked to persist without having loaded.
   */
  private async getSnapshot(): Promise<Map<string, IMappingRow>> {
    if (!persisted[this.accountId]) {
      await this.load()
    }
    return persisted[this.accountId]
  }

  private static rowsOf(data: IMappingsData): Map<string, IMappingRow> {
    const rows = new Map<string, IMappingRow>()
    for (const { key, type } of TYPES) {
      const mapping = data && data[key]
      if (!mapping || !mapping.LocalToServer) {
        continue
      }
      for (const [localId, remoteId] of Object.entries(mapping.LocalToServer)) {
        if (typeof remoteId === 'undefined' || remoteId === null) {
          continue
        }
        const row: IMappingRow = {
          type,
          localId,
          remoteId: String(remoteId),
          // Object keys are strings, so the local side's original type is the
          // one ServerToLocal kept for it.
          localIdNumeric: typeof mapping.ServerToLocal[String(remoteId)] === 'number',
          remoteIdNumeric: typeof remoteId === 'number',
        }
        rows.set(rowKey(row), row)
      }
    }
    return rows
  }

  /**
   * Import the mappings of an installation that still had them as one JSON blob
   * in the preferences. Runs once per account, then the old key is dropped.
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
      'SELECT mappings_migrated FROM account_meta WHERE account_id = ?',
      [this.accountId]
    )
    if (meta && meta.mappings_migrated) {
      return
    }

    const key = `bookmarks[${this.accountId}].mappings`
    const { value } = await Storage.get({ key })

    const statements: TStatement[] = [
      { statement: 'INSERT OR IGNORE INTO account_meta (account_id) VALUES (?)', values: [this.accountId] },
    ]
    if (value) {
      Logger.log('Migrating stored mappings of account ' + this.accountId + ' to SQLite')
      const data = { ...emptyMappings(), ...JSON.parse(value) }
      for (const row of NativeMappingsStore.rowsOf(data).values()) {
        statements.push({ statement: UPSERT_MAPPING, values: this.upsertValues(row) })
      }
      // The blob being there at all was what marked the account as initialized
      statements.push({
        statement: 'UPDATE account_meta SET mappings_initialized = 1 WHERE account_id = ?',
        values: [this.accountId],
      })
    }
    statements.push({
      statement: 'UPDATE account_meta SET mappings_migrated = 1 WHERE account_id = ?',
      values: [this.accountId],
    })

    await NativeDatabase.batch(statements)
    await Storage.remove({ key })
  }
}
