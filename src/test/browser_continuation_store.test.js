import './node-shims/indexeddb.js'
import { expect } from './utils'
import { Bookmark, ItemLocation } from '../lib/Tree'
import BrowserContinuationStore from '../lib/browser/BrowserContinuationStore'
import DefaultSyncProcess from '../lib/strategies/Default'
import Diff from '../lib/Diff'

const DB_NAME = 'floccus_continuations'
const ACTIONS = 'actions'
const META = 'meta'

function newAccountId() {
  return 'test' + Date.now() + Math.random()
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

/**
 * A connection of our own, to look at what the store actually wrote. Only ever
 * opened once the store has created the database, so that it never races the
 * schema in.
 */
async function withDb(fn) {
  const request = indexedDB.open(DB_NAME, 1)
  const db = await requestToPromise(request)
  try {
    return await fn(db)
  } finally {
    db.close()
  }
}

function rowsOf(accountId) {
  return withDb(async(db) => {
    const rows = await requestToPromise(
      db.transaction([ACTIONS], 'readonly').objectStore(ACTIONS).getAll()
    )
    return rows.filter((row) => row.accountId === accountId)
  })
}

function metaOf(accountId) {
  return withDb((db) =>
    requestToPromise(
      db.transaction([META], 'readonly').objectStore(META).get(accountId)
    )
  )
}

describe('BrowserContinuationStore', function() {
  this.timeout(20000)

  let accountId, store

  before('let the store create the database', async function() {
    expect(await BrowserContinuationStore.isAvailable()).to.equal(true)
  })

  beforeEach('set up a store', function() {
    accountId = newAccountId()
    store = new BrowserContinuationStore(accountId)
  })

  afterEach('drop the continuation', async function() {
    await store.clear()
  })

  /**
   * Every diff the members refer to, which is what a sync process fills
   * `diffIds` from -- always a superset of the diffs an update carries changes
   * for, and the store drops the rows of everything outside it.
   */
  function diffIdsOf(members) {
    const ids = []
    const collect = (member) => {
      if (member.kind === 'diff' && !ids.includes(member.diff)) {
        ids.push(member.diff)
      } else if (member.kind === 'plan') {
        Object.values(member.slots).forEach(collect)
      }
    }
    Object.values(members).forEach(collect)
    return ids
  }

  /** An update as a sync process hands it over, spelled out */
  function update({ strategy = 'default', meta = {}, members = {}, diffs = [] } = {}) {
    return { strategy, meta, members, diffs, diffIds: diffIdsOf(members) }
  }

  function diffUpdate(id, added, { removed = [], replace = false } = {}) {
    return {
      id,
      added: added.map((seq) => ({ seq, action: { type: 'CREATE', seq } })),
      removed,
      replace,
    }
  }

  function seqsOf(actions) {
    return actions.map((action) => action.seq)
  }

  describe('round trip', function() {
    it('should hand back nothing when it holds nothing', async function() {
      expect(await store.load()).to.equal(null)
    })

    it('should put the rows back together into a continuation', async function() {
      await store.update(update({
        strategy: 'unidirectional',
        meta: { localTreeRoot: null, serverTreeRoot: null },
        members: {
          scanResult: {
            kind: 'plan',
            slots: {
              CREATE: { kind: 'diff', diff: 'd1' },
              REMOVE: { kind: 'diff', diff: 'd2' },
            },
          },
          revertPlan: { kind: 'null' },
          direction: { kind: 'value', value: 'local' },
        },
        diffs: [diffUpdate('d1', [0, 1]), diffUpdate('d2', [0])],
      }))

      const loaded = await store.load()
      expect(loaded.strategy).to.equal('unidirectional')
      expect(loaded.createdAt).to.be.a('number')
      expect(seqsOf(loaded.scanResult.CREATE)).to.deep.equal([0, 1])
      expect(seqsOf(loaded.scanResult.REMOVE)).to.deep.equal([0])
      // A member that hadn't been computed at this point stays null, so that a
      // resumed sync recomputes it instead of reading .CREATE off nothing
      expect(loaded.revertPlan).to.equal(null)
      expect(loaded.direction).to.equal('local')
      // The trees are deliberately not part of a continuation
      expect(loaded.localTreeRoot).to.equal(null)
    })

    it('should hand back the actions of a diff in sequence order', async function() {
      // getAll() walks the key range in key order, but a diff's rows are written
      // in whatever order the update carried them
      await store.update(update({
        members: { plan: { kind: 'diff', diff: 'd1' } },
        diffs: [diffUpdate('d1', [2, 0, 1])],
      }))

      expect(seqsOf((await store.load()).plan)).to.deep.equal([0, 1, 2])
    })

    it('should give each member its own copy of a shared diff', async function() {
      // planStage3Local.CREATE *is* localPlanStage2.CREATE, and Diff.fromJSON
      // hydrates the actions it is handed in place
      await store.update(update({
        members: {
          localPlanStage2: { kind: 'diff', diff: 'd1' },
          planStage3Local: { kind: 'diff', diff: 'd1' },
        },
        diffs: [diffUpdate('d1', [0])],
      }))

      const loaded = await store.load()
      expect(seqsOf(loaded.localPlanStage2)).to.deep.equal([0])
      expect(loaded.localPlanStage2[0]).to.not.equal(loaded.planStage3Local[0])
    })

    it('should stamp every update with the time it was written', async function() {
      // Account#sync discards continuations older than half an hour by this very
      // field, so it has to move with the sync rather than with its start
      await store.update(update())
      const first = (await store.load()).createdAt
      expect(first).to.be.a('number')

      await new Promise((resolve) => setTimeout(resolve, 5))
      await store.update(update())

      expect((await store.load()).createdAt).to.be.above(first)
    })
  })

  describe('incremental updates', function() {
    it('should keep the rows an update doesn\'t mention', async function() {
      await store.update(update({
        members: { plan: { kind: 'diff', diff: 'd1' } },
        diffs: [diffUpdate('d1', [0, 1])],
      }))
      // What a tick with nothing executed since the last one carries
      await store.update(update({
        members: { plan: { kind: 'diff', diff: 'd1' } },
        diffs: [],
      }))

      expect(seqsOf((await store.load()).plan)).to.deep.equal([0, 1])
    })

    it('should drop the rows an update removes and overwrite the ones it repeats', async function() {
      await store.update(update({
        members: { plan: { kind: 'diff', diff: 'd1' } },
        diffs: [diffUpdate('d1', [0, 1, 2])],
      }))

      await store.update(update({
        members: { plan: { kind: 'diff', diff: 'd1' } },
        diffs: [{
          id: 'd1',
          added: [{ seq: 1, action: { type: 'CREATE', seq: 1, rewritten: true } }],
          removed: [0],
          replace: false,
        }],
      }))

      const loaded = await store.load()
      expect(seqsOf(loaded.plan)).to.deep.equal([1, 2])
      expect(loaded.plan[0].rewritten).to.equal(true)
      expect(await rowsOf(accountId)).to.have.length(2)
    })

    it('should drop the rows a full update didn\'t write', async function() {
      await store.update(update({
        members: { plan: { kind: 'diff', diff: 'd1' } },
        diffs: [diffUpdate('d1', [0, 1, 2])],
      }))

      // What a store that can't apply changes incrementally is handed -- and
      // what the diff hands over after it lost track of what is stored
      await store.update(update({
        members: { plan: { kind: 'diff', diff: 'd1' } },
        diffs: [diffUpdate('d1', [1], { replace: true })],
      }))

      expect(seqsOf((await store.load()).plan)).to.deep.equal([1])
      expect(await rowsOf(accountId)).to.have.length(1)
    })

    it('should drop the rows of a diff the continuation no longer refers to', async function() {
      await store.update(update({
        members: {
          scanResult: { kind: 'diff', diff: 'd1' },
          plan: { kind: 'diff', diff: 'd2' },
        },
        diffs: [diffUpdate('d1', [0]), diffUpdate('d2', [0])],
      }))
      expect(await rowsOf(accountId)).to.have.length(2)

      // Once both stage 3 plans exist, the scan results are no longer persisted
      await store.update(update({
        members: { plan: { kind: 'diff', diff: 'd2' } },
        diffs: [],
      }))

      const loaded = await store.load()
      expect('scanResult' in loaded).to.equal(false)
      expect(seqsOf(loaded.plan)).to.deep.equal([0])
      expect(await rowsOf(accountId)).to.have.length(1)
    })

    it('should not adopt the rows of the run before it', async function() {
      // A restart hands the store an entirely new set of diffs, whose ids carry
      // a per-run prefix of their own
      await store.update(update({
        members: { plan: { kind: 'diff', diff: 'run1-1' } },
        diffs: [diffUpdate('run1-1', [0, 1, 2])],
      }))

      await store.update(update({
        members: { plan: { kind: 'diff', diff: 'run2-1' } },
        diffs: [diffUpdate('run2-1', [0])],
      }))

      expect(seqsOf((await store.load()).plan)).to.deep.equal([0])
      expect(await rowsOf(accountId)).to.have.length(1)
    })
  })

  describe('key ranges', function() {
    it('should not sweep a diff whose id merely starts with another\'s', async function() {
      await store.update(update({
        members: {
          a: { kind: 'diff', diff: 'd1' },
          b: { kind: 'diff', diff: 'd1x' },
        },
        diffs: [diffUpdate('d1', [0]), diffUpdate('d1x', [0, 1])],
      }))

      // Dropping d1 -- as a replace, and as a diff that left the continuation
      await store.update(update({
        members: { b: { kind: 'diff', diff: 'd1x' } },
        diffs: [],
      }))

      const loaded = await store.load()
      expect(seqsOf(loaded.b)).to.deep.equal([0, 1])
      expect(await rowsOf(accountId)).to.have.length(2)
    })

    it('should not touch an account whose id merely starts with another\'s', async function() {
      const neighbour = new BrowserContinuationStore(accountId + 'x')
      const rows = {
        members: { plan: { kind: 'diff', diff: 'd1' } },
        diffs: [diffUpdate('d1', [0, 1])],
      }
      await store.update(update(rows))
      await neighbour.update(update(rows))

      await store.clear()

      expect(await store.load()).to.equal(null)
      expect(seqsOf((await neighbour.load()).plan)).to.deep.equal([0, 1])
      await neighbour.clear()
    })

    it('should keep two accounts apart', async function() {
      const other = new BrowserContinuationStore(newAccountId())
      await store.update(update({
        members: { plan: { kind: 'diff', diff: 'd1' } },
        diffs: [diffUpdate('d1', [0])],
      }))
      await other.update(update({
        strategy: 'merge',
        members: { plan: { kind: 'diff', diff: 'd1' } },
        diffs: [diffUpdate('d1', [7, 8])],
      }))

      expect(seqsOf((await store.load()).plan)).to.deep.equal([0])
      expect((await other.load()).strategy).to.equal('merge')
      expect(seqsOf((await other.load()).plan)).to.deep.equal([7, 8])
      await other.clear()
    })
  })

  describe('clearing', function() {
    it('should leave neither rows nor meta behind', async function() {
      await store.update(update({
        members: { plan: { kind: 'diff', diff: 'd1' } },
        diffs: [diffUpdate('d1', [0, 1])],
      }))

      await store.clear()

      expect(await store.load()).to.equal(null)
      expect(await rowsOf(accountId)).to.have.length(0)
      expect(await metaOf(accountId)).to.equal(undefined)
    })

    it('should not mind clearing what was never written', async function() {
      await store.clear()
      expect(await store.load()).to.equal(null)
    })
  })

  describe('a database that goes away', function() {
    it('should let go of its connection and open a new one', async function() {
      await store.update(update({
        members: { plan: { kind: 'diff', diff: 'd1' } },
        diffs: [diffUpdate('d1', [0])],
      }))

      // What a git sync sweeping up its file systems does. Holding the
      // connection open would block the delete for good, and while one is
      // pending indexedDB.databases() never resolves again for anyone here
      await new Promise((resolve, reject) => {
        const request = indexedDB.deleteDatabase(DB_NAME)
        request.onsuccess = () => resolve()
        request.onerror = () => reject(request.error)
        request.onblocked = () => reject(new Error('Deleting the database was blocked'))
      })

      expect(await store.load()).to.equal(null)
      await store.update(update({
        members: { plan: { kind: 'diff', diff: 'd2' } },
        diffs: [diffUpdate('d2', [5])],
      }))
      expect(seqsOf((await store.load()).plan)).to.deep.equal([5])
    })
  })

  describe('with a sync process', function() {
    let syncProcess

    function bookmark(id) {
      return new Bookmark({
        id,
        parentId: 1,
        title: 'Bookmark ' + id,
        url: 'http://example.com/' + id,
        location: ItemLocation.LOCAL,
      })
    }

    function emptyPlan() {
      return {
        CREATE: new Diff(),
        UPDATE: new Diff(),
        MOVE: new Diff(),
        REMOVE: new Diff(),
        REORDER: new Diff(),
      }
    }

    function creation(id) {
      return { type: 'CREATE', payload: bookmark(id) }
    }

    function storedIds(actions) {
      return actions.map((action) => action.payload.id)
    }

    async function persist() {
      const pending = await syncProcess.toContinuationUpdateAsync()
      await store.update(pending)
      syncProcess.markContinuationPersisted(pending)
      return pending
    }

    beforeEach('set up a sync process', function() {
      // The strategy is only used as a bag of members here -- nothing is synced
      syncProcess = new DefaultSyncProcess(null, null, null, async() => undefined)
    })

    it('should store what a sync process hands it and give it back', async function() {
      const scanResult = emptyPlan()
      scanResult.CREATE.commit(creation(1))
      scanResult.CREATE.commit(creation(2))
      scanResult.REMOVE.commit({ type: 'REMOVE', payload: bookmark(3) })
      syncProcess.localScanResult = scanResult

      await persist()

      const loaded = await store.load()
      expect(loaded.strategy).to.equal('default')
      expect(storedIds(loaded.localScanResult.CREATE)).to.deep.equal([1, 2])
      expect(storedIds(loaded.localScanResult.REMOVE)).to.deep.equal([3])
      expect(loaded.localScanResult.UPDATE).to.deep.equal([])
      expect(loaded.serverPlanStage2).to.equal(null)
    })

    it('should follow a plan through execution one tick at a time', async function() {
      const scanResult = emptyPlan()
      scanResult.CREATE.commit(creation(1))
      scanResult.CREATE.commit(creation(2))
      syncProcess.localScanResult = scanResult

      await persist()
      expect(await rowsOf(accountId)).to.have.length(2)

      // Nothing happened since
      const unchanged = await persist()
      expect(unchanged.diffs).to.have.length(0)
      expect(await rowsOf(accountId)).to.have.length(2)

      // What an executed action does: out of the plan, into the done plan
      const [executed] = scanResult.CREATE.getActions()
      scanResult.CREATE.retract(executed)
      await persist()

      expect(storedIds((await store.load()).localScanResult.CREATE)).to.deep.equal([2])
      expect(await rowsOf(accountId)).to.have.length(1)
    })

    it('should drop the row of an action executed while the write was in flight', async function() {
      const scanResult = emptyPlan()
      scanResult.CREATE.commit(creation(1))
      scanResult.CREATE.commit(creation(2))
      syncProcess.localScanResult = scanResult

      // The sync doesn't wait for the continuation to be written -- it goes on
      // executing actions, which take themselves out of their plan, while the
      // update that still holds them is on its way to the store
      const pending = await syncProcess.toContinuationUpdateAsync()
      const [executed] = scanResult.CREATE.getActions()
      scanResult.CREATE.retract(executed)
      await store.update(pending)
      syncProcess.markContinuationPersisted(pending)

      // That row may have been written by this very update, so the next one has
      // to take it out again: an executed action left behind in its plan is
      // executed a second time by the sync that resumes from this continuation
      await persist()

      expect(storedIds((await store.load()).localScanResult.CREATE)).to.deep.equal([2])
      expect(await rowsOf(accountId)).to.have.length(1)
    })
  })
})
