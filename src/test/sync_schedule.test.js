import { expect } from './utils'
import { getBackoffInterval, getDueAction, isSyncDue } from '../lib/SyncSchedule'

const MINUTE = 1000 * 60

describe('SyncSchedule', function() {
  const now = Date.now()
  const failed = (data) => ({
    enabled: true,
    syncIntervalEnabled: true,
    syncInterval: 15,
    lastSync: now - 60 * MINUTE,
    error: 'E017: Network error',
    isTransientError: true,
    errorCount: 1,
    lastAttempt: now,
    ...data,
  })

  it('backs off exponentially from a minute', function() {
    expect(getBackoffInterval(failed({ errorCount: 1 }))).to.equal(MINUTE)
    expect(getBackoffInterval(failed({ errorCount: 2 }))).to.equal(2 * MINUTE)
    expect(getBackoffInterval(failed({ errorCount: 4 }))).to.equal(8 * MINUTE)
  })

  it('never backs off longer than the sync interval or an hour', function() {
    expect(getBackoffInterval(failed({ errorCount: 10 }))).to.equal(15 * MINUTE)
    expect(getBackoffInterval(failed({ errorCount: 10, syncInterval: 120 }))).to.equal(60 * MINUTE)
    expect(getBackoffInterval(failed({ errorCount: 10, syncIntervalEnabled: false }))).to.equal(60 * MINUTE)
  })

  it('retries a transient error once the backoff has passed', function() {
    expect(isSyncDue(failed({ errorCount: 3 }), now + 3 * MINUTE)).to.equal(false)
    expect(isSyncDue(failed({ errorCount: 3 }), now + 5 * MINUTE)).to.equal(true)
  })

  it('retries after the first failure without interval sync, too', function() {
    expect(isSyncDue(failed({ syncIntervalEnabled: false }), now + 2 * MINUTE)).to.equal(true)
  })

  it('does not retry purely manual profiles', function() {
    const data = failed({ enabled: false, syncIntervalEnabled: false, syncOnStartupEnabled: false })
    expect(isSyncDue(data, now + 120 * MINUTE)).to.equal(false)
  })

  it('does not retry permanent errors', function() {
    expect(isSyncDue(failed({ isTransientError: false }), now + 120 * MINUTE)).to.equal(false)
  })

  it('waits while offline and retries at once when the network is back', function() {
    expect(isSyncDue(failed({ errorCount: 5 }), now + 2 * MINUTE, false)).to.equal(false)
    expect(isSyncDue(failed({ errorCount: 5 }), now + 2 * MINUTE, true, true)).to.equal(true)
  })

  it('syncs by the interval when there is no error', function() {
    const data = { syncIntervalEnabled: true, syncInterval: 15, lastSync: now }
    expect(isSyncDue(data, now + 10 * MINUTE)).to.equal(false)
    expect(isSyncDue(data, now + 16 * MINUTE)).to.equal(true)
    expect(isSyncDue({ ...data, syncIntervalEnabled: false }, now + 16 * MINUTE)).to.equal(false)
  })

  it('syncs scheduled accounts', function() {
    expect(isSyncDue(failed({ scheduled: true }), now, false)).to.equal(true)
  })

  describe('notify-only profiles', function() {
    const notifyOnly = (data) => ({ notifyOnly: true, syncIntervalEnabled: true, syncInterval: 15, lastSync: now, ...data })

    it('syncs like before when not notify-only', function() {
      expect(getDueAction({ syncIntervalEnabled: true, syncInterval: 15, lastSync: now }, now + 16 * MINUTE)).to.equal('sync')
      expect(getDueAction({ syncIntervalEnabled: true, syncInterval: 15, lastSync: now }, now + 10 * MINUTE)).to.equal(null)
    })

    it('checks instead of syncing by the interval', function() {
      expect(getDueAction(notifyOnly(), now + 10 * MINUTE)).to.equal(null)
      expect(getDueAction(notifyOnly(), now + 16 * MINUTE)).to.equal('check')
      expect(getDueAction(notifyOnly({ syncIntervalEnabled: false }), now + 16 * MINUTE)).to.equal(null)
    })

    it('counts the interval from the last check, too', function() {
      const data = notifyOnly({ lastSync: now - 60 * MINUTE, lastCheck: now })
      expect(getDueAction(data, now + 10 * MINUTE)).to.equal(null)
      expect(getDueAction(data, now + 16 * MINUTE)).to.equal('check')
    })

    it('still syncs when a sync was scheduled', function() {
      expect(getDueAction(notifyOnly({ scheduled: true }), now)).to.equal('sync')
      expect(getDueAction(notifyOnly({ scheduled: 'slave' }), now)).to.equal('sync')
    })

    it('runs a scheduled check', function() {
      expect(getDueAction(notifyOnly({ checkScheduled: true }), now)).to.equal('check')
    })

    it('retries a transient error with a check', function() {
      const data = failed({ notifyOnly: true, errorCount: 3 })
      expect(getDueAction(data, now + 3 * MINUTE)).to.equal(null)
      expect(getDueAction(data, now + 5 * MINUTE)).to.equal('check')
      expect(getDueAction(data, now + 2 * MINUTE, false)).to.equal(null)
      expect(getDueAction(data, now + MINUTE / 2, true, true)).to.equal('check')
      expect(getDueAction({ ...data, isTransientError: false }, now + 120 * MINUTE)).to.equal(null)
    })
  })
})
