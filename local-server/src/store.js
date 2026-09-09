import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const EMPTY_TREE = {
  type: 'folder',
  id: '0',
  parentId: null,
  title: 'root',
  children: [],
  location: 'Server',
  isRoot: true,
  loaded: true,
}

export class StoreError extends Error {
  constructor(status, code, message, details = null) {
    super(message)
    this.status = status
    this.code = code
    this.details = details
  }
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex')
}

function normalizeNode(node, parentId = null, seen = new Set()) {
  if (!node || typeof node !== 'object') {
    throw new StoreError(400, 'invalid_tree', 'Every tree item must be an object')
  }
  const id = String(node.id)
  if (!id || seen.has(id)) {
    throw new StoreError(400, 'invalid_tree', `Duplicate or missing item id: ${id}`)
  }
  seen.add(id)
  if (node.type === 'bookmark') {
    if (typeof node.url !== 'string' || typeof node.title !== 'string') {
      throw new StoreError(400, 'invalid_tree', `Bookmark ${id} has invalid fields`)
    }
    return {
      type: 'bookmark',
      id,
      parentId: parentId === null ? null : String(parentId),
      title: node.title,
      url: node.url,
      tags: Array.isArray(node.tags) ? node.tags.map(String) : undefined,
      location: 'Server',
      isRoot: false,
    }
  }
  if (node.type !== 'folder' || !Array.isArray(node.children)) {
    throw new StoreError(400, 'invalid_tree', `Folder ${id} has invalid fields`)
  }
  return {
    type: 'folder',
    id,
    parentId: parentId === null ? null : String(parentId),
    title: typeof node.title === 'string' ? node.title : '',
    children: node.children.map(child => normalizeNode(child, id, seen)),
    location: 'Server',
    isRoot: parentId === null,
    loaded: true,
  }
}

function normalizeTree(tree) {
  const normalized = normalizeNode(tree)
  if (!normalized.isRoot) {
    throw new StoreError(400, 'invalid_tree', 'The tree root must be a folder')
  }
  return normalized
}

export class BookmarkStore {
  constructor(databasePath, options = {}) {
    mkdirSync(dirname(databasePath), { recursive: true })
    this.now = options.now || (() => Date.now())
    this.leaseDurationMs = options.leaseDurationMs || 30_000
    this.db = new DatabaseSync(databasePath)
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;')
    this.migrate()
    this.ensureLibrary('default', 'Default')
  }

  migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS libraries (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        version INTEGER NOT NULL,
        tree_json TEXT NOT NULL,
        tree_hash TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        library_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        tree_json TEXT NOT NULL,
        tree_hash TEXT NOT NULL,
        reason TEXT NOT NULL,
        pinned INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        UNIQUE(library_id, version),
        FOREIGN KEY(library_id) REFERENCES libraries(id)
      );
      CREATE TABLE IF NOT EXISTS clients (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL,
        last_seen INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS pair_codes (
        code_hash TEXT PRIMARY KEY,
        expires_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS leases (
        library_id TEXT PRIMARY KEY,
        lease_id TEXT NOT NULL,
        client_id TEXT NOT NULL,
        transaction_id TEXT NOT NULL,
        base_version INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        FOREIGN KEY(library_id) REFERENCES libraries(id),
        FOREIGN KEY(client_id) REFERENCES clients(id)
      );
      CREATE TABLE IF NOT EXISTS transactions (
        transaction_id TEXT PRIMARY KEY,
        library_id TEXT NOT NULL,
        client_id TEXT NOT NULL,
        base_version INTEGER NOT NULL,
        result_version INTEGER NOT NULL,
        tree_hash TEXT NOT NULL,
        changed INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS conflicts (
        id TEXT PRIMARY KEY,
        library_id TEXT NOT NULL,
        client_id TEXT NOT NULL,
        base_version INTEGER NOT NULL,
        local_tree_json TEXT NOT NULL,
        shared_tree_json TEXT NOT NULL,
        details TEXT NOT NULL,
        status TEXT NOT NULL,
        resolution TEXT,
        created_at INTEGER NOT NULL,
        resolved_at INTEGER,
        FOREIGN KEY(library_id) REFERENCES libraries(id),
        FOREIGN KEY(client_id) REFERENCES clients(id)
      );
      CREATE INDEX IF NOT EXISTS idx_snapshots_library_created
        ON snapshots(library_id, created_at DESC);
    `)
  }

  close() {
    this.db.close()
  }

  ensureLibrary(id, name) {
    const json = JSON.stringify(EMPTY_TREE)
    this.db.prepare(`
      INSERT OR IGNORE INTO libraries(id, name, version, tree_json, tree_hash, updated_at)
      VALUES (?, ?, 0, ?, ?, ?)
    `).run(id, name, json, digest(json), this.now())
  }

  createPairCode(ttlMs = 15 * 60 * 1000) {
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0')
    this.db.prepare('DELETE FROM pair_codes WHERE expires_at < ?').run(this.now())
    this.db.prepare('INSERT INTO pair_codes(code_hash, expires_at) VALUES (?, ?)')
      .run(digest(code), this.now() + ttlMs)
    return code
  }

  pair(code, clientName) {
    const row = this.db.prepare('SELECT expires_at FROM pair_codes WHERE code_hash = ?').get(digest(String(code)))
    if (!row || row.expires_at < this.now()) {
      throw new StoreError(401, 'invalid_pair_code', 'Pairing code is invalid or expired')
    }
    this.db.prepare('DELETE FROM pair_codes WHERE code_hash = ?').run(digest(String(code)))
    const token = randomBytes(32).toString('base64url')
    const clientId = randomUUID()
    const now = this.now()
    this.db.prepare('INSERT INTO clients(id, name, token_hash, created_at, last_seen) VALUES (?, ?, ?, ?, ?)')
      .run(clientId, String(clientName || 'Browser'), digest(token), now, now)
    return { clientId, token, libraryId: 'default' }
  }

  authenticate(token) {
    if (!token) throw new StoreError(401, 'unauthorized', 'Missing bearer token')
    const row = this.db.prepare('SELECT id, name FROM clients WHERE token_hash = ?').get(digest(token))
    if (!row) throw new StoreError(401, 'unauthorized', 'Invalid bearer token')
    this.db.prepare('UPDATE clients SET last_seen = ? WHERE id = ?').run(this.now(), row.id)
    return row
  }

  getState(libraryId = 'default') {
    const row = this.db.prepare('SELECT id, name, version, tree_json, tree_hash, updated_at FROM libraries WHERE id = ?').get(libraryId)
    if (!row) throw new StoreError(404, 'library_not_found', 'Bookmark library was not found')
    return {
      libraryId: row.id,
      name: row.name,
      version: row.version,
      tree: JSON.parse(row.tree_json),
      treeHash: row.tree_hash,
      updatedAt: row.updated_at,
    }
  }

  acquireLease(libraryId, clientId, transactionId) {
    if (!transactionId) throw new StoreError(400, 'missing_transaction_id', 'transactionId is required')
    const existingTx = this.db.prepare('SELECT * FROM transactions WHERE transaction_id = ?').get(transactionId)
    if (existingTx) return { alreadyCommitted: true, resultVersion: existingTx.result_version, changed: Boolean(existingTx.changed) }
    const now = this.now()
    const current = this.db.prepare('SELECT * FROM leases WHERE library_id = ?').get(libraryId)
    if (current && current.expires_at >= now) {
      if (current.client_id === clientId && current.transaction_id === transactionId) {
        return { ...this.getState(libraryId), leaseId: current.lease_id, expiresAt: current.expires_at }
      }
      throw new StoreError(423, 'library_locked', 'Another browser is syncing this library')
    }
    if (current) this.db.prepare('DELETE FROM leases WHERE library_id = ?').run(libraryId)
    const state = this.getState(libraryId)
    const leaseId = randomUUID()
    const expiresAt = now + this.leaseDurationMs
    this.db.prepare(`
      INSERT INTO leases(library_id, lease_id, client_id, transaction_id, base_version, expires_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(libraryId, leaseId, clientId, transactionId, state.version, expiresAt)
    return { ...state, leaseId, expiresAt }
  }

  commit({ libraryId, clientId, leaseId, transactionId, baseVersion, tree, reason = 'sync', conflictId = null }) {
    const previous = this.db.prepare('SELECT * FROM transactions WHERE transaction_id = ?').get(transactionId)
    if (previous) {
      return { version: previous.result_version, changed: Boolean(previous.changed), treeHash: previous.tree_hash, idempotent: true }
    }
    const normalized = normalizeTree(tree)
    const treeJson = JSON.stringify(normalized)
    const treeHash = digest(treeJson)
    const now = this.now()
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const lease = this.db.prepare('SELECT * FROM leases WHERE library_id = ?').get(libraryId)
      const state = this.db.prepare('SELECT * FROM libraries WHERE id = ?').get(libraryId)
      if (!lease || lease.lease_id !== leaseId || lease.client_id !== clientId || lease.transaction_id !== transactionId) {
        throw new StoreError(409, 'invalid_lease', 'The sync lease is missing or belongs to another transaction')
      }
      if (lease.expires_at < now) throw new StoreError(409, 'lease_expired', 'The sync lease expired')
      if (Number(baseVersion) !== state.version || lease.base_version !== state.version) {
        throw new StoreError(409, 'version_conflict', 'The shared library changed during this sync', { currentVersion: state.version })
      }
      let conflict = null
      if (conflictId) {
        conflict = this.db.prepare(`
          SELECT * FROM conflicts WHERE id = ? AND library_id = ? AND client_id = ? AND status = 'pending'
        `).get(conflictId, libraryId, clientId)
        if (!conflict) throw new StoreError(409, 'conflict_not_pending', 'The conflict is no longer pending')
        if (conflict.base_version !== state.version) {
          throw new StoreError(409, 'version_conflict', 'The shared library changed after this conflict was detected', { currentVersion: state.version })
        }
      }
      const changed = state.tree_hash !== treeHash
      const resultVersion = changed ? state.version + 1 : state.version
      if (changed) {
        this.saveSnapshotRow(state, 'before-' + reason, 0, now)
        this.db.prepare('UPDATE libraries SET version = ?, tree_json = ?, tree_hash = ?, updated_at = ? WHERE id = ?')
          .run(resultVersion, treeJson, treeHash, now, libraryId)
        this.saveSnapshotRow({ ...state, version: resultVersion, tree_json: treeJson, tree_hash: treeHash }, reason, 0, now)
      }
      this.db.prepare(`
        INSERT INTO transactions(transaction_id, library_id, client_id, base_version, result_version, tree_hash, changed, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(transactionId, libraryId, clientId, baseVersion, resultVersion, treeHash, changed ? 1 : 0, now)
      if (conflict) {
        this.db.prepare(`UPDATE conflicts SET status = 'resolved', resolution = 'local', resolved_at = ? WHERE id = ?`)
          .run(now, conflict.id)
      }
      this.db.prepare('DELETE FROM leases WHERE library_id = ?').run(libraryId)
      this.db.exec('COMMIT')
      if (changed) this.pruneHistory(libraryId)
      return { version: resultVersion, changed, treeHash, idempotent: false }
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  saveSnapshotRow(state, reason, pinned, createdAt) {
    this.db.prepare(`
      INSERT OR IGNORE INTO snapshots(library_id, version, tree_json, tree_hash, reason, pinned, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(state.id, state.version, state.tree_json, state.tree_hash, reason, pinned, createdAt)
    if (pinned) {
      this.db.prepare('UPDATE snapshots SET pinned = 1, reason = ? WHERE library_id = ? AND version = ?')
        .run(reason, state.id, state.version)
    }
  }

  getTransaction(transactionId, clientId) {
    const row = this.db.prepare('SELECT * FROM transactions WHERE transaction_id = ? AND client_id = ?').get(transactionId, clientId)
    if (!row) throw new StoreError(404, 'transaction_not_found', 'Transaction has not been committed')
    return { version: row.result_version, changed: Boolean(row.changed), treeHash: row.tree_hash }
  }

  releaseLease(libraryId, clientId, leaseId) {
    this.db.prepare('DELETE FROM leases WHERE library_id = ? AND client_id = ? AND lease_id = ?').run(libraryId, clientId, leaseId)
  }

  renewLease(libraryId, clientId, leaseId, transactionId) {
    const lease = this.db.prepare('SELECT * FROM leases WHERE library_id = ?').get(libraryId)
    const now = this.now()
    if (!lease || lease.lease_id !== leaseId || lease.client_id !== clientId || lease.transaction_id !== transactionId) {
      throw new StoreError(409, 'invalid_lease', 'The sync lease is missing or belongs to another transaction')
    }
    if (lease.expires_at < now) {
      throw new StoreError(409, 'lease_expired', 'The sync lease expired')
    }
    const expiresAt = now + this.leaseDurationMs
    this.db.prepare('UPDATE leases SET expires_at = ? WHERE library_id = ? AND lease_id = ?')
      .run(expiresAt, libraryId, leaseId)
    return { leaseId, transactionId, baseVersion: lease.base_version, expiresAt }
  }

  saveConflict(libraryId, clientId, baseVersion, localTree, sharedTree, details) {
    const id = randomUUID()
    const localJson = JSON.stringify(normalizeTree(localTree))
    const sharedJson = JSON.stringify(normalizeTree(sharedTree))
    const now = this.now()
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const state = this.db.prepare('SELECT * FROM libraries WHERE id = ?').get(libraryId)
      if (!state) throw new StoreError(404, 'library_not_found', 'Bookmark library was not found')
      if (Number(baseVersion) !== state.version) {
        throw new StoreError(409, 'version_conflict', 'The shared library changed before the conflict snapshot was saved')
      }
      this.db.prepare(`
        UPDATE conflicts SET status = 'superseded', resolved_at = ?
        WHERE library_id = ? AND client_id = ? AND status = 'pending'
      `).run(now, libraryId, clientId)
      this.db.prepare(`
        INSERT INTO conflicts(id, library_id, client_id, base_version, local_tree_json, shared_tree_json, details, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)
      `).run(id, libraryId, clientId, state.version, localJson, sharedJson, String(details || ''), now)
      this.saveSnapshotRow(state, `before-conflict-${id}`, 1, now)
      this.db.exec('COMMIT')
      return { id, libraryId, baseVersion: state.version, details: String(details || ''), status: 'pending', createdAt: now }
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  getPendingConflict(libraryId, clientId) {
    const row = this.db.prepare(`
      SELECT id, library_id AS libraryId, base_version AS baseVersion, local_tree_json AS localTreeJson,
        shared_tree_json AS sharedTreeJson, details, status, created_at AS createdAt
      FROM conflicts WHERE library_id = ? AND client_id = ? AND status = 'pending'
      ORDER BY created_at DESC LIMIT 1
    `).get(libraryId, clientId)
    if (!row) return null
    return { ...row, localTree: JSON.parse(row.localTreeJson), sharedTree: JSON.parse(row.sharedTreeJson), localTreeJson: undefined, sharedTreeJson: undefined }
  }

  resolveConflict(libraryId, clientId, conflictId, resolution, baseVersion, transactionId = null) {
    if (!['local', 'shared'].includes(resolution)) throw new StoreError(400, 'invalid_resolution', 'resolution must be local or shared')
    const now = this.now()
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const conflict = this.db.prepare(`
        SELECT * FROM conflicts WHERE id = ? AND library_id = ? AND client_id = ?
      `).get(conflictId, libraryId, clientId)
      if (!conflict) throw new StoreError(404, 'conflict_not_found', 'Conflict was not found')
      const state = this.db.prepare('SELECT * FROM libraries WHERE id = ?').get(libraryId)
      if (conflict.status === 'resolved') {
        if (conflict.resolution !== resolution) {
          throw new StoreError(409, 'conflict_already_resolved', `The conflict was already resolved using ${conflict.resolution}`)
        }
        this.db.exec('COMMIT')
        return {
          id: conflictId,
          resolution,
          baseVersion: conflict.base_version,
          version: state.version,
          resolved: true,
          changed: false,
          idempotent: true,
        }
      }
      if (conflict.status !== 'pending') throw new StoreError(409, 'conflict_not_pending', 'The conflict is no longer pending')
      if (Number(baseVersion) !== conflict.base_version || state.version !== conflict.base_version) {
        throw new StoreError(409, 'version_conflict', 'The shared library changed after this conflict was detected', { currentVersion: state.version })
      }
      const lease = this.db.prepare('SELECT * FROM leases WHERE library_id = ?').get(libraryId)
      if (lease && lease.expires_at >= now) {
        throw new StoreError(423, 'library_locked', 'Another browser is syncing this library')
      }
      if (lease) this.db.prepare('DELETE FROM leases WHERE library_id = ?').run(libraryId)
      if (resolution === 'shared') {
        this.db.prepare(`UPDATE conflicts SET status = 'resolved', resolution = 'shared', resolved_at = ? WHERE id = ?`)
          .run(now, conflictId)
        this.db.exec('COMMIT')
        return { id: conflictId, resolution, baseVersion: state.version, version: state.version, resolved: true, changed: false }
      }
      if (!transactionId) throw new StoreError(400, 'missing_transaction_id', 'transactionId is required for a local conflict resolution')
      const leaseId = randomUUID()
      const expiresAt = now + this.leaseDurationMs
      this.db.prepare(`
        INSERT INTO leases(library_id, lease_id, client_id, transaction_id, base_version, expires_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(libraryId, leaseId, clientId, transactionId, state.version, expiresAt)
      this.db.exec('COMMIT')
      return {
        id: conflictId,
        resolution,
        baseVersion: state.version,
        version: state.version,
        resolved: false,
        prepared: true,
        transactionId,
        leaseId,
        expiresAt,
      }
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  listHistory(libraryId = 'default', limit = 100) {
    return this.db.prepare(`
      SELECT version, reason, pinned, created_at AS createdAt, tree_hash AS treeHash
      FROM snapshots WHERE library_id = ? ORDER BY version DESC LIMIT ?
    `).all(libraryId, Math.max(1, Math.min(Number(limit) || 100, 500)))
  }

  getSnapshot(libraryId, version) {
    const row = this.db.prepare(`
      SELECT version, reason, pinned, created_at AS createdAt, tree_json AS treeJson, tree_hash AS treeHash
      FROM snapshots WHERE library_id = ? AND version = ?
    `).get(libraryId, Number(version))
    if (!row) throw new StoreError(404, 'snapshot_not_found', 'History version was not found')
    return { ...row, tree: JSON.parse(row.treeJson), treeJson: undefined }
  }

  pinCurrent(libraryId, reason = 'manual-backup') {
    const state = this.db.prepare('SELECT * FROM libraries WHERE id = ?').get(libraryId)
    if (!state) throw new StoreError(404, 'library_not_found', 'Bookmark library was not found')
    this.saveSnapshotRow(state, reason, 1, this.now())
    return { version: state.version, pinned: true }
  }

  restore(libraryId, targetVersion, clientId, baseVersion) {
    const now = this.now()
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const target = this.db.prepare('SELECT * FROM snapshots WHERE library_id = ? AND version = ?').get(libraryId, targetVersion)
      if (!target) throw new StoreError(404, 'snapshot_not_found', 'History version was not found')
      const state = this.db.prepare('SELECT * FROM libraries WHERE id = ?').get(libraryId)
      if (Number(baseVersion) !== state.version) {
        throw new StoreError(409, 'version_conflict', 'The shared library changed after the restore preview', { currentVersion: state.version })
      }
      const lease = this.db.prepare('SELECT * FROM leases WHERE library_id = ?').get(libraryId)
      if (lease && lease.expires_at >= now) {
        throw new StoreError(423, 'library_locked', 'A browser is currently syncing this library')
      }
      if (lease) this.db.prepare('DELETE FROM leases WHERE library_id = ?').run(libraryId)
      const nextVersion = state.version + 1
      this.saveSnapshotRow(state, 'before-restore', 1, now)
      this.db.prepare('UPDATE libraries SET version = ?, tree_json = ?, tree_hash = ?, updated_at = ? WHERE id = ?')
        .run(nextVersion, target.tree_json, target.tree_hash, now, libraryId)
      this.saveSnapshotRow({ ...state, version: nextVersion, tree_json: target.tree_json, tree_hash: target.tree_hash }, `restore-${targetVersion}`, 1, now)
      this.db.exec('COMMIT')
      return { version: nextVersion, restoredFrom: Number(targetVersion), clientId }
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  pruneHistory(libraryId) {
    const cutoff = this.now() - 30 * 24 * 60 * 60 * 1000
    this.db.prepare(`
      DELETE FROM snapshots
      WHERE library_id = ? AND pinned = 0 AND created_at < ?
        AND id NOT IN (SELECT id FROM snapshots WHERE library_id = ? ORDER BY version DESC LIMIT 100)
    `).run(libraryId, cutoff, libraryId)
  }
}

export { EMPTY_TREE, normalizeTree }
