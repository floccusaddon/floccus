import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { BookmarkStore, StoreError } from '../src/store.js'

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'floccus-local-'))
  let now = 1_700_000_000_000
  const store = new BookmarkStore(join(dir, 'test.sqlite3'), { now: () => now, leaseDurationMs: 1000 })
  const code = store.createPairCode()
  const client = store.pair(code, 'Chrome')
  return { store, client, tick: ms => { now += ms }, cleanup: () => { store.close(); rmSync(dir, { recursive: true, force: true }) } }
}

function tree(title = 'Example') {
  return {
    type: 'folder', id: '0', parentId: null, title: 'root', location: 'Server', isRoot: true, loaded: true,
    children: [{ type: 'bookmark', id: '1', parentId: '0', title, url: 'https://example.com/', location: 'Server', isRoot: false }],
  }
}

function largeTree(size) {
  const result = tree('item-1')
  result.children = Array.from({ length: size }, (_, index) => ({
    type: 'bookmark', id: String(index + 1), parentId: '0', title: `item-${index + 1}`,
    url: `https://example.com/${index + 1}`, location: 'Server', isRoot: false,
  }))
  return result
}

test('pair codes are one-use and tokens authenticate', () => {
  const f = fixture()
  try {
    assert.equal(f.store.authenticate(f.client.token).id, f.client.clientId)
    assert.throws(() => f.store.pair('000000', 'Edge'), StoreError)
  } finally { f.cleanup() }
})

test('lease commit is versioned, idempotent and records history', () => {
  const f = fixture()
  try {
    const lease = f.store.acquireLease('default', f.client.clientId, 'tx-1')
    const result = f.store.commit({ libraryId: 'default', clientId: f.client.clientId, leaseId: lease.leaseId, transactionId: 'tx-1', baseVersion: lease.version, tree: tree() })
    assert.deepEqual({ version: result.version, changed: result.changed }, { version: 1, changed: true })
    const again = f.store.commit({ libraryId: 'default', clientId: f.client.clientId, leaseId: lease.leaseId, transactionId: 'tx-1', baseVersion: lease.version, tree: tree() })
    assert.equal(again.idempotent, true)
    assert.equal(f.store.getState().tree.children[0].title, 'Example')
    assert.deepEqual(f.store.listHistory().map(x => x.version), [1, 0])
  } finally { f.cleanup() }
})

test('stale and expired leases cannot overwrite a newer state', () => {
  const f = fixture()
  try {
    const lease = f.store.acquireLease('default', f.client.clientId, 'tx-expired')
    f.tick(1001)
    assert.throws(() => f.store.commit({ libraryId: 'default', clientId: f.client.clientId, leaseId: lease.leaseId, transactionId: 'tx-expired', baseVersion: 0, tree: tree() }), error => error.code === 'lease_expired')
  } finally { f.cleanup() }
})

test('an active client can renew its lease but another transaction cannot', () => {
  const f = fixture()
  try {
    const lease = f.store.acquireLease('default', f.client.clientId, 'tx-renew')
    f.tick(900)
    const renewed = f.store.renewLease('default', f.client.clientId, lease.leaseId, 'tx-renew')
    assert.equal(renewed.expiresAt, 1_700_000_001_900)
    f.tick(900)
    const result = f.store.commit({ libraryId: 'default', clientId: f.client.clientId, leaseId: lease.leaseId, transactionId: 'tx-renew', baseVersion: 0, tree: tree() })
    assert.equal(result.version, 1)
    assert.throws(
      () => f.store.renewLease('default', f.client.clientId, lease.leaseId, 'different-tx'),
      error => error.code === 'invalid_lease'
    )
  } finally { f.cleanup() }
})

test('restore creates a new pinned version and keeps the previous state', () => {
  const f = fixture()
  try {
    let lease = f.store.acquireLease('default', f.client.clientId, 'tx-1')
    f.store.commit({ libraryId: 'default', clientId: f.client.clientId, leaseId: lease.leaseId, transactionId: 'tx-1', baseVersion: 0, tree: tree('First') })
    lease = f.store.acquireLease('default', f.client.clientId, 'tx-2')
    f.store.commit({ libraryId: 'default', clientId: f.client.clientId, leaseId: lease.leaseId, transactionId: 'tx-2', baseVersion: 1, tree: tree('Second') })
    const restored = f.store.restore('default', 1, f.client.clientId, 2)
    assert.equal(restored.version, 3)
    assert.equal(f.store.getState().tree.children[0].title, 'First')
    assert.equal(f.store.listHistory().find(x => x.version === 3).pinned, 1)
  } finally { f.cleanup() }
})

test('conflicts retain both snapshots and reject stale resolutions', () => {
  const f = fixture()
  try {
    const conflict = f.store.saveConflict('default', f.client.clientId, 0, tree('Chrome edit'), tree('Edge edit'), 'both changed title')
    const pending = f.store.getPendingConflict('default', f.client.clientId)
    assert.equal(pending.localTree.children[0].title, 'Chrome edit')
    assert.equal(pending.sharedTree.children[0].title, 'Edge edit')
    assert.equal(f.store.listHistory()[0].pinned, 1)

    const lease = f.store.acquireLease('default', f.client.clientId, 'tx-after-conflict')
    f.store.commit({ libraryId: 'default', clientId: f.client.clientId, leaseId: lease.leaseId, transactionId: 'tx-after-conflict', baseVersion: 0, tree: tree('New shared state') })
    assert.throws(
      () => f.store.resolveConflict('default', f.client.clientId, conflict.id, 'local', 0),
      error => error.code === 'version_conflict'
    )
  } finally { f.cleanup() }
})

test('local conflict resolution holds a lease and resolves atomically with its commit', () => {
  const f = fixture()
  try {
    const conflict = f.store.saveConflict('default', f.client.clientId, 0, tree('Chrome edit'), tree('Edge edit'), 'both changed title')
    const prepared = f.store.resolveConflict('default', f.client.clientId, conflict.id, 'local', 0, 'conflict-tx')
    assert.equal(prepared.prepared, true)
    assert.equal(f.store.getPendingConflict('default', f.client.clientId).id, conflict.id)
    const result = f.store.commit({
      libraryId: 'default',
      clientId: f.client.clientId,
      leaseId: prepared.leaseId,
      transactionId: prepared.transactionId,
      baseVersion: prepared.baseVersion,
      tree: tree('Chrome edit'),
      conflictId: conflict.id,
    })
    assert.equal(result.version, 1)
    assert.equal(f.store.getPendingConflict('default', f.client.clientId), null)
    assert.equal(f.store.getState().tree.children[0].title, 'Chrome edit')
    assert.equal(f.store.resolveConflict('default', f.client.clientId, conflict.id, 'local', 0).idempotent, true)
  } finally { f.cleanup() }
})

test('restore rejects a stale preview and an active sync lease', () => {
  const f = fixture()
  try {
    const initialLease = f.store.acquireLease('default', f.client.clientId, 'initial-version')
    f.store.commit({ libraryId: 'default', clientId: f.client.clientId, leaseId: initialLease.leaseId, transactionId: 'initial-version', baseVersion: 0, tree: tree('Initial') })
    const lease = f.store.acquireLease('default', f.client.clientId, 'active-tx')
    assert.throws(
      () => f.store.restore('default', 0, f.client.clientId, 1),
      error => error.code === 'library_locked'
    )
    f.store.releaseLease('default', f.client.clientId, lease.leaseId)
    const nextLease = f.store.acquireLease('default', f.client.clientId, 'new-version')
    f.store.commit({ libraryId: 'default', clientId: f.client.clientId, leaseId: nextLease.leaseId, transactionId: 'new-version', baseVersion: 1, tree: tree('New') })
    assert.throws(
      () => f.store.restore('default', 0, f.client.clientId, 1),
      error => error.code === 'version_conflict'
    )
  } finally { f.cleanup() }
})

test('a 1,000 bookmark transaction stays within the five-second service budget', () => {
  const f = fixture()
  try {
    const lease = f.store.acquireLease('default', f.client.clientId, 'tx-1000')
    const started = performance.now()
    const result = f.store.commit({ libraryId: 'default', clientId: f.client.clientId, leaseId: lease.leaseId, transactionId: 'tx-1000', baseVersion: 0, tree: largeTree(1000) })
    const elapsed = performance.now() - started
    assert.equal(result.version, 1)
    assert.equal(f.store.getState().tree.children.length, 1000)
    assert.ok(elapsed < 5000, `service transaction took ${elapsed.toFixed(1)} ms`)
  } finally { f.cleanup() }
})
