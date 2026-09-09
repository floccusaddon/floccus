import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { WebSocket } from 'ws'
import { createLocalServer } from '../src/server.js'
import { BookmarkStore } from '../src/store.js'

function sampleTree(title = 'Shared') {
  return {
    type: 'folder', id: '0', parentId: null, title: 'root', location: 'Server', isRoot: true, loaded: true,
    children: [{ type: 'bookmark', id: '1', parentId: '0', title, url: 'https://example.com/', location: 'Server', isRoot: false }],
  }
}

function waitForMessage(socket, predicate, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out waiting for WebSocket message')), timeoutMs)
    const listener = raw => {
      const message = JSON.parse(raw.toString())
      if (!predicate(message)) return
      clearTimeout(timer)
      socket.off('message', listener)
      resolve(message)
    }
    socket.on('message', listener)
  })
}

test('HTTP transactions notify both browsers and restores notify the requester', async() => {
  const dir = mkdtempSync(join(tmpdir(), 'floccus-local-http-'))
  const store = new BookmarkStore(join(dir, 'test.sqlite3'))
  const chrome = store.pair(store.createPairCode(), 'Chrome')
  const edge = store.pair(store.createPairCode(), 'Edge')
  const { server, wss } = createLocalServer(store)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const port = server.address().port
  const base = `http://127.0.0.1:${port}/api/v1`
  const request = async(client, path, options = {}) => {
    const response = await fetch(base + path, {
      ...options,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${client.token}` },
    })
    const payload = await response.json()
    assert.equal(response.ok, true, JSON.stringify(payload))
    return payload
  }
  const openSocket = async client => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/api/v1/events`)
    await once(socket, 'open')
    const ready = waitForMessage(socket, message => message.type === 'ready')
    socket.send(JSON.stringify({ type: 'auth', token: client.token, libraryId: 'default' }))
    await ready
    return socket
  }
  const chromeSocket = await openSocket(chrome)
  const edgeSocket = await openSocket(edge)
  try {
    const edgeNotification = waitForMessage(edgeSocket, message => message.type === 'version' && message.version === 1)
    const lease = await request(chrome, '/libraries/default/lease', {
      method: 'POST', body: JSON.stringify({ transactionId: 'http-tx-1' }),
    })
    await request(chrome, '/libraries/default/lease/renew', {
      method: 'POST', body: JSON.stringify({ leaseId: lease.leaseId, transactionId: 'http-tx-1' }),
    })
    const committed = await request(chrome, '/libraries/default/commit', {
      method: 'POST', body: JSON.stringify({ leaseId: lease.leaseId, transactionId: 'http-tx-1', baseVersion: 0, tree: sampleTree() }),
    })
    assert.deepEqual({ version: committed.version, changed: committed.changed }, { version: 1, changed: true })
    assert.equal((await edgeNotification).libraryId, 'default')

    const chromeRestoreNotification = waitForMessage(chromeSocket, message => message.type === 'version' && message.version === 2)
    const restored = await request(chrome, '/libraries/default/restore', {
      method: 'POST', body: JSON.stringify({ version: 0, baseVersion: 1 }),
    })
    assert.equal(restored.version, 2)
    assert.equal((await chromeRestoreNotification).version, 2)
    assert.equal((await request(edge, '/libraries/default/state')).tree.children.length, 0)
  } finally {
    chromeSocket.close()
    edgeSocket.close()
    wss.close()
    server.close()
    await once(server, 'close')
    store.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
