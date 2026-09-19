import { ISerializedSyncProcess } from './strategies/Default'

/**
 * How a sync continuation is stored.
 *
 * A continuation used to be one JSON blob that was written in full on every
 * progress tick (roughly every 1.5s) -- for a large account that is megabytes
 * of serialization and IO, repeated throughout the sync, and it grows with the
 * account rather than with what actually happened since the last tick.
 *
 * So instead the store keeps one row per action, keyed by the Diff the action
 * lives in and a sequence number Diff hands out on commit(). Since commit() and
 * retract() are the only structural mutators of a Diff (see Diff#getPendingChanges),
 * a tick only has to write the actions that were executed since the last one:
 * during execution every action moves from its plan to the done plan, i.e. one
 * deleted and one inserted row each.
 *
 * What is _not_ a set of actions -- which members exist, which Diff each of
 * them refers to, and the scalars like actionsPlanned -- is small and goes into
 * a single meta record, rewritten as a whole each time.
 */
export type TContinuationMember =
  | { kind: 'null' }
  | { kind: 'value', value: any }
  | { kind: 'diff', diff: string }
  | { kind: 'plan', slots: Record<string, TContinuationMember> }

/** The rows of one Diff that have to change in the store */
export interface IContinuationDiffUpdate {
  id: string
  /** Rows to insert or overwrite */
  added: { seq: number, action: any }[]
  /** Rows to drop, by sequence number */
  removed: number[]
  /**
   * All other rows of this diff are stale and are to be dropped -- set when the
   * update was built as a full one, in which case `added` holds every action.
   */
  replace: boolean
}

export interface IContinuationUpdate {
  strategy: string
  /** Top-level entries that aren't members, i.e. the nulled tree roots */
  meta: Record<string, any>
  members: Record<string, TContinuationMember>
  /** Only the diffs with pending changes */
  diffs: IContinuationDiffUpdate[]
  /** Every diff the members refer to; rows of any other diff are obsolete */
  diffIds: string[]
}

/**
 * The stored shape of a continuation, minus the actions.
 */
export interface IContinuationMeta {
  strategy: string
  createdAt: number
  meta: Record<string, any>
  members: Record<string, TContinuationMember>
  diffIds: string[]
}

function assembleMember(member: TContinuationMember, actions: Map<string, any[]>): any {
  switch (member.kind) {
    case 'null':
      return null
    case 'value':
      return member.value
    case 'diff':
      // A shallow copy per member: one and the same diff is usually referenced
      // by two members (planStage3Server.CREATE *is* serverPlanStage2.CREATE),
      // and Diff.fromJSON hydrates the actions it is given in place
      return (actions.get(member.diff) || []).map(action => ({ ...action }))
    case 'plan':
      return Object.fromEntries(
        Object.entries(member.slots).map(([slot, value]) => [slot, assembleMember(value, actions)])
      )
    default:
      throw new Error('Unknown continuation member kind')
  }
}

/**
 * Put the rows back together into the JSON a sync process can be restored from,
 * i.e. what the old blob in storage used to hold.
 */
export function assembleContinuation(meta: IContinuationMeta, actions: Map<string, any[]>): ISerializedSyncProcess {
  return {
    strategy: meta.strategy,
    createdAt: meta.createdAt,
    ...meta.meta,
    ...Object.fromEntries(
      Object.entries(meta.members).map(([name, member]) => [name, assembleMember(member, actions)])
    ),
  } as ISerializedSyncProcess
}

/**
 * The actions of a *full* update, in the shape assembleContinuation() takes.
 */
export function actionsOfUpdate(update: IContinuationUpdate): Map<string, any[]> {
  const actions = new Map<string, any[]>()
  for (const id of update.diffIds) {
    actions.set(id, [])
  }
  for (const diff of update.diffs) {
    actions.set(
      diff.id,
      diff.added.slice().sort((a, b) => a.seq - b.seq).map(({ action }) => action)
    )
  }
  return actions
}

/**
 * A full update rendered as one blob, for storage that can't store rows.
 */
export function continuationUpdateToJSON(update: IContinuationUpdate): ISerializedSyncProcess {
  return assembleContinuation(
    { ...update, createdAt: Date.now() },
    actionsOfUpdate(update)
  )
}
