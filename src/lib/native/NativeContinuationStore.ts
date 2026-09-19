import NativeDatabase, { TStatement } from './NativeDatabase'
import {
  assembleContinuation,
  IContinuationMeta,
  IContinuationUpdate,
} from '../Continuation'
import { ISerializedSyncProcess } from '../strategies/Default'
import Logger from '../Logger'

const UPSERT_ACTION =
  'INSERT OR REPLACE INTO continuation_actions (account_id, diff_id, seq, action) VALUES (?,?,?,?)'
const DELETE_ACTION =
  'DELETE FROM continuation_actions WHERE account_id = ? AND diff_id = ? AND seq = ?'

/**
 * Row storage for one account's pending sync continuation.
 *
 * The actions of the sync plan are rows keyed by (diff, sequence number), and
 * everything else -- which members the continuation has, which diff each of
 * them refers to, the scalars -- is a single row of JSON. See Continuation.ts
 * for why it is cut this way.
 */
export default class NativeContinuationStore {
  private readonly accountId: string

  constructor(accountId: string) {
    this.accountId = accountId
  }

  async load(): Promise<ISerializedSyncProcess | null> {
    const [row] = await NativeDatabase.query(
      'SELECT strategy, created_at, structure FROM continuations WHERE account_id = ?',
      [this.accountId]
    )
    if (!row) {
      return null
    }
    let structure: Omit<IContinuationMeta, 'strategy' | 'createdAt'>
    try {
      structure = JSON.parse(row.structure)
    } catch (e) {
      Logger.log('Error while parsing stored continuation: ' + e.message)
      return null
    }
    const actionRows = await NativeDatabase.query(
      'SELECT diff_id, seq, action FROM continuation_actions WHERE account_id = ? ORDER BY diff_id, seq',
      [this.accountId]
    )
    const actions = new Map<string, any[]>()
    for (const id of structure.diffIds || []) {
      actions.set(id, [])
    }
    for (const actionRow of actionRows) {
      if (!actions.has(actionRow.diff_id)) {
        // A diff the meta row doesn't refer to (any more): its rows are dropped
        // with the next update, and it is no part of this continuation
        continue
      }
      actions.get(actionRow.diff_id).push(JSON.parse(actionRow.action))
    }
    return assembleContinuation(
      { ...structure, strategy: row.strategy, createdAt: Number(row.created_at) },
      actions
    )
  }

  async update(update: IContinuationUpdate): Promise<void> {
    const statements: TStatement[] = []

    // Rows of diffs that are no longer part of the continuation, e.g. because
    // the sync has moved on to a stage that doesn't persist that member
    const keptIds = update.diffIds
    statements.push({
      statement:
        'DELETE FROM continuation_actions WHERE account_id = ?' +
        (keptIds.length ? ` AND diff_id NOT IN (${keptIds.map(() => '?').join(',')})` : ''),
      values: [this.accountId, ...keptIds],
    })

    // One statement per row, as the mappings store does it: an update carries
    // the actions executed since the last progress tick, which is a handful,
    // and the whole set is applied as one transaction, so a crash mid-write
    // can't leave a half-written continuation behind for the next sync to
    // resume from
    for (const diff of update.diffs) {
      if (diff.replace) {
        statements.push({
          statement: 'DELETE FROM continuation_actions WHERE account_id = ? AND diff_id = ?',
          values: [this.accountId, diff.id],
        })
      }
      for (const seq of diff.removed) {
        statements.push({
          statement: DELETE_ACTION,
          values: [this.accountId, diff.id, seq],
        })
      }
      for (const { seq, action } of diff.added) {
        statements.push({
          statement: UPSERT_ACTION,
          values: [this.accountId, diff.id, seq, JSON.stringify(action)],
        })
      }
    }

    const structure: Omit<IContinuationMeta, 'strategy' | 'createdAt'> = {
      meta: update.meta,
      members: update.members,
      diffIds: update.diffIds,
    }
    statements.push({
      statement:
        'INSERT OR REPLACE INTO continuations (account_id, strategy, created_at, structure) VALUES (?,?,?,?)',
      // Account#sync discards continuations older than half an hour by this
      // stamp, so it is refreshed with every update
      values: [this.accountId, update.strategy, Date.now(), JSON.stringify(structure)],
    })

    await NativeDatabase.batch(statements)
  }

  async clear(): Promise<void> {
    await NativeDatabase.batch([
      { statement: 'DELETE FROM continuation_actions WHERE account_id = ?', values: [this.accountId] },
      { statement: 'DELETE FROM continuations WHERE account_id = ?', values: [this.accountId] },
    ])
  }
}
