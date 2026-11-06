import { IAccountData } from './interfaces/AccountStorage'

export const DEFAULT_SYNC_INTERVAL = 15 // minutes
const MIN_BACKOFF_INTERVAL = 1000 * 60 // 1 minute
const MAX_BACKOFF_INTERVAL = 1000 * 60 * 60 // 1 hour

/**
 * Whether an account syncs by itself at all. A purely manual profile is left
 * alone after a failure, too.
 */
export function syncsAutomatically(data: IAccountData): boolean {
  return Boolean(data.enabled || data.syncIntervalEnabled || data.syncOnStartupEnabled)
}

/**
 * How long to wait after a failed attempt before retrying: doubles with every
 * consecutive failure, starting at a minute, and never longer than an hour or
 * than the account would wait for its next regular sync.
 *
 * @param data - the account's data
 * @returns the delay in milliseconds
 */
export function getBackoffInterval(data: IAccountData): number {
  const errorCount = Math.max(1, data.errorCount || 1)
  let max = MAX_BACKOFF_INTERVAL
  if (data.syncIntervalEnabled) {
    max = Math.min(max, (data.syncInterval || DEFAULT_SYNC_INTERVAL) * 1000 * 60)
  }
  return Math.min(max, MIN_BACKOFF_INTERVAL * Math.pow(2, errorCount - 1))
}

/**
 * Whether the last sync of this account failed with an error that may well go
 * away by itself (network trouble, a server hiccup), so that it's worth
 * retrying without the user's intervention.
 */
export function isRetriable(data: IAccountData): boolean {
  return Boolean(data.error && data.isTransientError && syncsAutomatically(data))
}

/**
 * Decides whether the periodic check should sync this account now.
 *
 * @param data - the account's data
 * @param now - the current time in ms
 * @param online - false if the device is known to be offline: a retry would
 *   only fail again and push the next one further out, so it waits for the
 *   connection to come back (see `networkRestored`)
 * @param networkRestored - the connection just came back: retry failed syncs
 *   right away instead of waiting out the backoff
 */
export function isSyncDue(data: IAccountData, now: number, online = true, networkRestored = false): boolean {
  if (data.scheduled) {
    return true
  }
  if (data.error) {
    if (!isRetriable(data) || !online) {
      return false
    }
    return networkRestored || now > (data.lastAttempt || 0) + getBackoffInterval(data)
  }
  return Boolean(
    data.syncIntervalEnabled &&
    now > (data.syncInterval || DEFAULT_SYNC_INTERVAL) * 1000 * 60 + (data.lastSync || 0)
  )
}

export type TDueAction = 'sync' | 'check' | null

/**
 * Whether the profile only looks for changes on its own and leaves syncing
 * them to the user ("only notify me", #2403). Its triggers -- local changes,
 * startup, the interval -- run a check instead of a sync.
 */
export function isNotifyOnly(data: IAccountData): boolean {
  return Boolean(data.notifyOnly)
}

/**
 * Like `isSyncDue`, but for profiles that may only want a check: decides
 * whether the periodic check should sync this account, check it for pending
 * changes, or leave it alone.
 *
 * A notify-only profile still syncs when a sync was scheduled explicitly --
 * the user asked for it, or one of their syncs found the server locked and is
 * waiting to try again. Everything it would otherwise have synced for by
 * itself -- the interval, a retry after a transient error -- becomes a check.
 * Its interval counts from the last sync or check, whichever was later, as a
 * check doesn't move `lastSync`.
 *
 * @see isSyncDue for the parameters
 */
export function getDueAction(data: IAccountData, now: number, online = true, networkRestored = false): TDueAction {
  if (!isNotifyOnly(data)) {
    return isSyncDue(data, now, online, networkRestored) ? 'sync' : null
  }
  if (data.scheduled) {
    return 'sync'
  }
  if (data.error) {
    if (!isRetriable(data) || !online) {
      return null
    }
    return networkRestored || now > (data.lastAttempt || 0) + getBackoffInterval(data) ? 'check' : null
  }
  if (data.checkScheduled) {
    return 'check'
  }
  const lastRun = Math.max(data.lastSync || 0, data.lastCheck || 0)
  if (data.syncIntervalEnabled && now > (data.syncInterval || DEFAULT_SYNC_INTERVAL) * 1000 * 60 + lastRun) {
    return 'check'
  }
  return null
}
