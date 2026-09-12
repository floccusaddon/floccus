import initSqlJs from 'sql.js'

/**
 * Stand-in for @capacitor-community/sqlite in the node test suite: the plugin
 * needs a native platform (or jeep-sqlite in a browser), so here we back the
 * handful of methods NativeDatabase uses with an in-memory sql.js database.
 *
 * Like the preferences shim, the data lives for as long as the process does.
 */

let databasePromise

async function getDatabase() {
  if (!databasePromise) {
    databasePromise = initSqlJs().then((SQL) => new SQL.Database())
  }
  return databasePromise
}

class SQLiteDBConnection {
  async open() {
    await getDatabase()
  }

  async close() {
    // noop
  }

  async isDBOpen() {
    return { result: true }
  }

  async execute(statements) {
    const db = await getDatabase()
    db.exec(statements)
    return { changes: { changes: 0 } }
  }

  async query(statement, values = []) {
    const db = await getDatabase()
    const stmt = db.prepare(statement)
    try {
      stmt.bind(values)
      const rows = []
      while (stmt.step()) {
        rows.push(stmt.getAsObject())
      }
      return { values: rows }
    } finally {
      stmt.free()
    }
  }

  async run(statement, values = []) {
    const db = await getDatabase()
    db.run(statement, values)
    return { changes: { changes: db.getRowsModified() } }
  }

  async executeSet(set) {
    const db = await getDatabase()
    db.exec('BEGIN')
    try {
      for (const { statement, values } of set) {
        db.run(statement, values || [])
      }
      db.exec('COMMIT')
    } catch (e) {
      db.exec('ROLLBACK')
      throw e
    }
    return { changes: { changes: db.getRowsModified() } }
  }
}

const connection = new SQLiteDBConnection()

class SQLiteConnection {
  async checkConnectionsConsistency() {
    return { result: true }
  }

  async isConnection() {
    return { result: true }
  }

  async createConnection() {
    return connection
  }

  async retrieveConnection() {
    return connection
  }

  async closeConnection() {
    // noop
  }
}

const CapacitorSQLite = {}

export { CapacitorSQLite, SQLiteConnection, SQLiteDBConnection }
