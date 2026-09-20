import { Preferences as Storage } from '@capacitor/preferences'
import NativeDatabase, { TStatement } from './NativeDatabase'
import { LOG_RETENTION } from '../Logger'

/**
 * How many lines go into one INSERT. Every line binds one value, and SQLite
 * caps the number of bound values per statement.
 */
const INSERT_CHUNK_SIZE = 200

let migration: Promise<void> | null = null

/**
 * Drop the log the preferences used to hold.
 *
 * Nothing is carried over: NativeController empties the log on every start
 * anyway, so the blob we find here is either from the run that was interrupted
 * by the upgrade or already empty. Getting rid of it is the point -- Android
 * rewrites the whole preferences file on every single write, so a multi-megabyte
 * log entry sitting in there slows down every other preference, too.
 */
function migrateFromPreferences(): Promise<void> {
  if (!migration) {
    migration = Storage.remove({ key: 'logs' }).catch((e) => {
      migration = null
      throw e
    })
  }
  return migration
}

/**
 * The debug log, one row per line.
 *
 * Unlike everything else in the database this isn't tied to an account: the log
 * is a single stream, the way it was when it lived in the preferences.
 *
 * Appending is the whole point. The log used to be stored as one JSON blob,
 * which meant serializing and rewriting all of it every few seconds -- on
 * Android a SharedPreferences write of the entire file, which for a sync of a
 * large account took about seven seconds a time and ate most of that sync's
 * wall clock. A persist now costs what has been logged since the last one.
 */
export default class NativeLogStore {
  static async append(messages: string[]): Promise<void> {
    if (!messages.length) {
      return
    }
    await migrateFromPreferences()
    // Anything beyond the newest LOG_RETENTION lines would be deleted by the
    // trim below in the very same transaction, so don't send it over the bridge
    const kept = messages.length > LOG_RETENTION ? messages.slice(-LOG_RETENTION) : messages
    const statements: TStatement[] = []
    for (let i = 0; i < kept.length; i += INSERT_CHUNK_SIZE) {
      const chunk = kept.slice(i, i + INSERT_CHUNK_SIZE)
      statements.push({
        statement: `INSERT INTO logs (message) VALUES ${chunk.map(() => '(?)').join(',')}`,
        values: chunk.map((message) => String(message)),
      })
    }
    // Trim in the same transaction that appends. The subselect names the newest
    // line that has to go; while there are fewer lines than we keep it yields
    // NULL, and the DELETE matches nothing. LOG_RETENTION is a constant of
    // ours, so it goes into the statement rather than through a binding.
    statements.push({
      statement: `DELETE FROM logs WHERE seq <= (SELECT seq FROM logs ORDER BY seq DESC LIMIT 1 OFFSET ${LOG_RETENTION})`,
      values: [],
    })
    await NativeDatabase.batch(statements)
  }

  static async read(): Promise<string[]> {
    await migrateFromPreferences()
    const rows = await NativeDatabase.query('SELECT message FROM logs ORDER BY seq ASC')
    return rows.map((row) => row.message)
  }

  static async clear(): Promise<void> {
    await migrateFromPreferences()
    await NativeDatabase.batch([{ statement: 'DELETE FROM logs', values: [] }])
  }
}
