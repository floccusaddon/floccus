import { createServer } from 'node:http'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { homedir } from 'node:os'
import { WebSocketServer } from 'ws'
import { BookmarkStore, StoreError } from './store.js'

const HOST = '127.0.0.1'
const PORT = Number(process.env.FLOCCUS_LOCAL_PORT || 32145)
const DATA_DIR = process.env.FLOCCUS_LOCAL_DATA_DIR || join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'FloccusLocal')
const DB_PATH = join(DATA_DIR, 'floccus-local.sqlite3')

function json(res, status, value) {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Cache-Control': 'no-store',
  })
  res.end(body)
}

async function body(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > 5 * 1024 * 1024) throw new StoreError(413, 'request_too_large', 'Request body exceeds 5 MiB')
    chunks.push(chunk)
  }
  if (!chunks.length) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new StoreError(400, 'invalid_json', 'Request body is not valid JSON')
  }
}

function bearer(req) {
  const value = req.headers.authorization || ''
  return value.startsWith('Bearer ') ? value.slice(7) : ''
}

export function createLocalServer(store) {
  const subscribers = new Map()
  const broadcast = (libraryId, version, sourceClientId = null) => {
    const payload = JSON.stringify({ type: 'version', libraryId, version })
    for (const ws of subscribers.get(libraryId) || []) {
      if (ws.readyState === 1 && ws.clientId !== sourceClientId) ws.send(payload)
    }
  }

  const server = createServer(async(req, res) => {
    try {
      const origin = req.headers.origin
      if (origin && !/^(chrome|edge)-extension:\/\//.test(origin)) {
        throw new StoreError(403, 'origin_forbidden', 'Only browser extension clients may access this service')
      }
      if (req.method === 'OPTIONS') return json(res, 204, {})
      const url = new URL(req.url, `http://${HOST}:${PORT}`)
      if (req.method === 'GET' && url.pathname === '/api/v1/health') {
        return json(res, 200, { ok: true, service: 'floccus-local', version: 1 })
      }
      if (req.method === 'POST' && url.pathname === '/api/v1/pair') {
        const input = await body(req)
        return json(res, 201, store.pair(input.code, input.clientName))
      }
      const client = store.authenticate(bearer(req))
      const stateMatch = url.pathname.match(/^\/api\/v1\/libraries\/([^/]+)\/state$/)
      const leaseMatch = url.pathname.match(/^\/api\/v1\/libraries\/([^/]+)\/lease$/)
      const renewLeaseMatch = url.pathname.match(/^\/api\/v1\/libraries\/([^/]+)\/lease\/renew$/)
      const commitMatch = url.pathname.match(/^\/api\/v1\/libraries\/([^/]+)\/commit$/)
      const historyMatch = url.pathname.match(/^\/api\/v1\/libraries\/([^/]+)\/history$/)
      const historyVersionMatch = url.pathname.match(/^\/api\/v1\/libraries\/([^/]+)\/history\/(\d+)$/)
      const backupMatch = url.pathname.match(/^\/api\/v1\/libraries\/([^/]+)\/backup$/)
      const restoreMatch = url.pathname.match(/^\/api\/v1\/libraries\/([^/]+)\/restore$/)
      const conflictMatch = url.pathname.match(/^\/api\/v1\/libraries\/([^/]+)\/conflict$/)
      const resolveConflictMatch = url.pathname.match(/^\/api\/v1\/libraries\/([^/]+)\/conflict\/([^/]+)\/resolve$/)
      const txMatch = url.pathname.match(/^\/api\/v1\/transactions\/([^/]+)$/)
      if (req.method === 'GET' && stateMatch) return json(res, 200, store.getState(stateMatch[1]))
      if (req.method === 'POST' && leaseMatch) {
        const input = await body(req)
        return json(res, 201, store.acquireLease(leaseMatch[1], client.id, input.transactionId))
      }
      if (req.method === 'POST' && renewLeaseMatch) {
        const input = await body(req)
        return json(res, 200, store.renewLease(renewLeaseMatch[1], client.id, input.leaseId, input.transactionId))
      }
      if (req.method === 'DELETE' && leaseMatch) {
        const input = await body(req)
        store.releaseLease(leaseMatch[1], client.id, input.leaseId)
        return json(res, 200, { released: true })
      }
      if (req.method === 'POST' && commitMatch) {
        const input = await body(req)
        const result = store.commit({ ...input, libraryId: commitMatch[1], clientId: client.id })
        if (result.changed) broadcast(commitMatch[1], result.version, client.id)
        return json(res, 200, result)
      }
      if (req.method === 'GET' && txMatch) return json(res, 200, store.getTransaction(txMatch[1], client.id))
      if (req.method === 'GET' && historyMatch) return json(res, 200, { versions: store.listHistory(historyMatch[1], url.searchParams.get('limit')) })
      if (req.method === 'GET' && historyVersionMatch) return json(res, 200, store.getSnapshot(historyVersionMatch[1], historyVersionMatch[2]))
      if (req.method === 'POST' && backupMatch) {
        const input = await body(req)
        return json(res, 201, store.pinCurrent(backupMatch[1], input.reason))
      }
      if (req.method === 'POST' && restoreMatch) {
        const input = await body(req)
        const result = store.restore(restoreMatch[1], Number(input.version), client.id, input.baseVersion)
        // The browser that requested the restore also needs to download it.
        broadcast(restoreMatch[1], result.version)
        return json(res, 201, result)
      }
      if (req.method === 'GET' && conflictMatch) {
        return json(res, 200, { conflict: store.getPendingConflict(conflictMatch[1], client.id) })
      }
      if (req.method === 'POST' && conflictMatch) {
        const input = await body(req)
        return json(res, 201, store.saveConflict(conflictMatch[1], client.id, input.baseVersion, input.localTree, input.sharedTree, input.details))
      }
      if (req.method === 'POST' && resolveConflictMatch) {
        const input = await body(req)
        const result = store.resolveConflict(
          resolveConflictMatch[1],
          client.id,
          resolveConflictMatch[2],
          input.resolution,
          input.baseVersion,
          input.transactionId
        )
        return json(res, 200, result)
      }
      throw new StoreError(404, 'not_found', 'Endpoint was not found')
    } catch (error) {
      const status = error instanceof StoreError ? error.status : 500
      json(res, status, {
        error: error instanceof StoreError ? error.code : 'internal_error',
        message: error.message,
        details: error.details || undefined,
      })
    }
  })

  const wss = new WebSocketServer({ noServer: true })
  server.on('upgrade', (req, socket, head) => {
    const origin = req.headers.origin
    if (origin && !/^(chrome|edge)-extension:\/\//.test(origin)) return socket.destroy()
    if (req.url !== '/api/v1/events') return socket.destroy()
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws))
  })
  wss.on('connection', ws => {
    const authTimer = setTimeout(() => ws.close(4001, 'Authentication timeout'), 5000)
    ws.on('message', raw => {
      try {
        const message = JSON.parse(raw.toString())
        if (message.type === 'ping') return ws.send(JSON.stringify({ type: 'pong', at: Date.now() }))
        if (message.type !== 'auth' || ws.clientId) return
        const client = store.authenticate(message.token)
        const libraryId = String(message.libraryId || 'default')
        store.getState(libraryId)
        ws.clientId = client.id
        ws.libraryId = libraryId
        clearTimeout(authTimer)
        if (!subscribers.has(libraryId)) subscribers.set(libraryId, new Set())
        subscribers.get(libraryId).add(ws)
        ws.send(JSON.stringify({ type: 'ready', ...store.getState(libraryId), tree: undefined }))
      } catch (error) {
        ws.close(4003, error.message)
      }
    })
    ws.on('close', () => {
      clearTimeout(authTimer)
      if (ws.libraryId) subscribers.get(ws.libraryId)?.delete(ws)
    })
  })
  return { server, wss, broadcast }
}

function openStore() {
  mkdirSync(DATA_DIR, { recursive: true })
  return new BookmarkStore(DB_PATH)
}

async function main() {
  const command = process.argv[2] || 'start'
  if (command === 'status' && !existsSync(DB_PATH)) {
    console.log(JSON.stringify({ database: DB_PATH, exists: false }, null, 2))
    return
  }
  const store = openStore()
  if (command === 'pair-code') {
    console.log(store.createPairCode())
    store.close()
    return
  }
  if (command === 'status') {
    const state = store.getState('default')
    console.log(JSON.stringify({ database: DB_PATH, exists: true, version: state.version, updatedAt: state.updatedAt }, null, 2))
    store.close()
    return
  }
  if (command !== 'start') throw new Error(`Unknown command: ${command}`)
  if (!existsSync(DB_PATH)) mkdirSync(DATA_DIR, { recursive: true })
  const { server } = createLocalServer(store)
  server.listen(PORT, HOST, () => {
    console.log(`Floccus Local listening on http://${HOST}:${PORT}`)
    console.log(`Data: ${DB_PATH}`)
  })
  const shutdown = () => server.close(() => { store.close(); process.exit(0) })
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(error)
    process.exitCode = 1
  })
}
