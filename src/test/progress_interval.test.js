import { expect } from './utils'
import {
  progressInterval,
  PROGRESS_INTERVAL_MAX,
  PROGRESS_INTERVAL_MIN,
  PROGRESS_INTERVAL_PER_ITEM,
} from '../lib/strategies/Default'

describe('progressInterval', function() {
  it('leaves small accounts at the old fixed interval', function() {
    expect(progressInterval(0)).to.equal(PROGRESS_INTERVAL_MIN)
    expect(progressInterval(1)).to.equal(PROGRESS_INTERVAL_MIN)
    expect(progressInterval(1000)).to.equal(PROGRESS_INTERVAL_MIN)
    // The point where scaling takes over
    expect(progressInterval(PROGRESS_INTERVAL_MIN / PROGRESS_INTERVAL_PER_ITEM)).to.equal(PROGRESS_INTERVAL_MIN)
  })

  it('grows with the tree in between', function() {
    const items = 20000
    expect(progressInterval(items)).to.equal(items * PROGRESS_INTERVAL_PER_ITEM)
    expect(progressInterval(items)).to.be.above(PROGRESS_INTERVAL_MIN)
    expect(progressInterval(items)).to.be.below(PROGRESS_INTERVAL_MAX)
  })

  it('is monotonic', function() {
    let last = 0
    for (const items of [0, 100, 5000, 10000, 20000, 40000, 80000, 200000]) {
      const interval = progressInterval(items)
      expect(interval).to.be.at.least(last)
      last = interval
    }
  })

  it('caps the interval, so an interrupt never loses more than that much work', function() {
    expect(progressInterval(80000)).to.equal(PROGRESS_INTERVAL_MAX)
    expect(progressInterval(1000000)).to.equal(PROGRESS_INTERVAL_MAX)
  })

  it('falls back to the minimum for a count it can make no sense of', function() {
    expect(progressInterval(NaN)).to.equal(PROGRESS_INTERVAL_MIN)
    expect(progressInterval(-1)).to.equal(PROGRESS_INTERVAL_MIN)
    expect(progressInterval(Infinity)).to.equal(PROGRESS_INTERVAL_MIN)
  })
})
