import {
  assembleContinuation,
  IContinuationMeta,
  IContinuationUpdate,
} from '../Continuation'
import { ISerializedSyncProcess } from '../strategies/Default'
import Logger from '../Logger'

const DB_NAME = 'floccus_continuations'
const DB_VERSION = 1
const META = 'meta'
const ACTIONS = 'actions'

let dbPromise: Promise<IDBDatabase> | null = null
let openDb: IDBDatabase | null = null

/** Drop a connection we no longer hold, so that the next call opens a new one */
function forget(db: IDBDatabase): void {
  if (openDb === db) {
    openDb = null
    dbPromise = null
  }
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined' || !indexedDB) {
      reject(new Error('IndexedDB is not available'))
      return
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(META)) {
        db.createObjectStore(META, { keyPath: 'accountId' })
      }
      if (!db.objectStoreNames.contains(ACTIONS)) {
        // One row per action of the sync plan, ordered by diff and sequence
        // number so that both a whole continuation and a single diff can be
        // read and dropped as one key range
        db.createObjectStore(ACTIONS, { keyPath: ['accountId', 'diffId', 'seq'] })
      }
    }
    request.onsuccess = () => {
      const db = request.result
      // Something wants to delete or upgrade the database -- a git sync
      // sweeping up its file systems, say. Keeping the connection open blocks
      // that request, and a blocked delete stays pending for good, after which
      // indexedDB.databases() never resolves again for anyone in this origin
      db.onversionchange = () => {
        db.close()
        forget(db)
      }
      db.onclose = () => forget(db)
      openDb = db
      resolve(db)
    }
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error('Opening the continuation database is blocked'))
  })
}

function getDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = open().catch((e) => {
      // Don't cache a failed attempt
      dbPromise = null
      throw e
    })
  }
  return dbPromise
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function transactionToPromise(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error || new Error('Continuation transaction aborted'))
  })
}

/**
 * `[]` sorts after every other key, so this covers all keys starting with the
 * given prefix -- all rows of an account, or all rows of one of its diffs.
 */
function prefixRange(prefix: any[]): IDBKeyRange {
  return IDBKeyRange.bound(prefix, [...prefix, []])
}

/**
 * Row storage for one account's pending sync continuation.
 *
 * The actions of the sync plan are rows keyed by (diff, sequence number), and
 * everything else -- which members the continuation has, which diff each of
 * them refers to, the scalars -- is a single record. See Continuation.ts for
 * why it is cut this way. An update is applied as one IndexedDB transaction, so
 * a crash mid-write can't leave a half-written continuation behind for the next
 * sync to resume from.
 */
export default class BrowserContinuationStore {
  private readonly accountId: string

  constructor(accountId: string) {
    this.accountId = accountId
  }

  static async isAvailable(): Promise<boolean> {
    try {
      await getDb()
      return true
    } catch (e) {
      Logger.log('Cannot store continuations incrementally: ' + e.message)
      return false
    }
  }

  async load(): Promise<ISerializedSyncProcess | null> {
    const db = await getDb()
    const tx = db.transaction([META, ACTIONS], 'readonly')
    const meta = await requestToPromise<IContinuationMeta & { accountId: string }>(
      tx.objectStore(META).get(this.accountId)
    )
    if (!meta) {
      return null
    }
    const rows = await requestToPromise<{ diffId: string, seq: number, action: any }[]>(
      tx.objectStore(ACTIONS).getAll(prefixRange([this.accountId]))
    )
    const actions = new Map<string, any[]>()
    for (const id of meta.diffIds || []) {
      actions.set(id, [])
    }
    for (const row of rows) {
      if (!actions.has(row.diffId)) {
        // A diff the meta record doesn't refer to (any more): its rows are
        // dropped with the next update, and it is no part of this continuation
        continue
      }
      actions.get(row.diffId).push(row.action)
    }
    return assembleContinuation(meta, actions)
  }

  async update(update: IContinuationUpdate): Promise<void> {
    const db = await getDb()
    const tx = db.transaction([META, ACTIONS], 'readwrite')
    const metaStore = tx.objectStore(META)
    const actionStore = tx.objectStore(ACTIONS)

    const previous = await requestToPromise<IContinuationMeta | undefined>(
      metaStore.get(this.accountId)
    )
    // Diffs that are no longer part of the continuation, e.g. because the sync
    // has moved on to a stage that doesn't persist that member
    for (const id of (previous?.diffIds || []).filter(id => !update.diffIds.includes(id))) {
      actionStore.delete(prefixRange([this.accountId, id]))
    }
    for (const diff of update.diffs) {
      if (diff.replace) {
        actionStore.delete(prefixRange([this.accountId, diff.id]))
      }
      for (const seq of diff.removed) {
        actionStore.delete([this.accountId, diff.id, seq])
      }
      for (const { seq, action } of diff.added) {
        actionStore.put({ accountId: this.accountId, diffId: diff.id, seq, action })
      }
    }
    metaStore.put({
      accountId: this.accountId,
      strategy: update.strategy,
      // Account#sync discards continuations older than half an hour by this
      // stamp, so it is refreshed with every update
      createdAt: Date.now(),
      meta: update.meta,
      members: update.members,
      diffIds: update.diffIds,
    })

    await transactionToPromise(tx)
  }

  async clear(): Promise<void> {
    const db = await getDb()
    const tx = db.transaction([META, ACTIONS], 'readwrite')
    tx.objectStore(ACTIONS).delete(prefixRange([this.accountId]))
    tx.objectStore(META).delete(this.accountId)
    await transactionToPromise(tx)
  }
}
