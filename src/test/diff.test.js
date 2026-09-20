import { expect } from './utils'
import Diff, { ActionType } from '../lib/Diff'
import { Bookmark, ItemLocation } from '../lib/Tree'

function bookmark(id) {
  return new Bookmark({
    id,
    parentId: 1,
    title: 'bookmark' + id,
    url: 'http://example.com/' + id,
    location: ItemLocation.LOCAL,
  })
}

function diffOf(count) {
  const diff = new Diff()
  for (let i = 0; i < count; i++) {
    diff.commit({ type: ActionType.CREATE, payload: bookmark(i) })
  }
  return diff
}

const idsOf = (actions) => actions.map((action) => action.payload.id)

describe('Diff', function() {
  describe('retract', function() {
    it('keeps the remaining actions in order', function() {
      const diff = diffOf(5)
      const actions = diff.getActions()
      diff.retract(actions[1])
      diff.retract(actions[3])
      expect(idsOf(diff.getActions())).to.deep.equal([0, 2, 4])
    })

    it('ignores an action it never held', function() {
      const diff = diffOf(2)
      const stranger = { type: ActionType.CREATE, payload: bookmark(9) }
      diff.retract(stranger)
      expect(idsOf(diff.getActions())).to.deep.equal([0, 1])
    })

    it('ignores an action it has already let go of', function() {
      const diff = diffOf(3)
      const [, second] = diff.getActions()
      diff.retract(second)
      diff.retract(second)
      expect(idsOf(diff.getActions())).to.deep.equal([0, 2])
    })

    it('does not take a committed action along with an equal one', function() {
      // commit() stores a copy, so two equal actions are two separate rows and
      // the position map has to tell them apart by identity
      const diff = new Diff()
      const action = { type: ActionType.CREATE, payload: bookmark(1) }
      diff.commit(action)
      diff.commit(action)
      const stored = diff.getActions()
      expect(stored[0]).to.not.equal(stored[1])
      diff.retract(stored[0])
      expect(diff.getActions()).to.have.lengthOf(1)
      expect(diff.getActions()[0]).to.equal(stored[1])
    })

    it('lets what is committed after it be retracted again', function() {
      const diff = diffOf(3)
      diff.retract(diff.getActions()[0])
      diff.commit({ type: ActionType.CREATE, payload: bookmark(7) })
      const actions = diff.getActions()
      expect(idsOf(actions)).to.deep.equal([1, 2, 7])
      diff.retract(actions[2])
      diff.retract(actions[0])
      expect(idsOf(diff.getActions())).to.deep.equal([2])
    })
  })

  describe('peekActions', function() {
    it('hands out the same actions getActions does', function() {
      const diff = diffOf(4)
      diff.retract(diff.getActions()[2])
      expect([...diff.peekActions()]).to.deep.equal(diff.getActions())
    })

    it('hands out the diff\'s own array, where getActions copies', function() {
      const diff = diffOf(3)
      expect(diff.peekActions()).to.equal(diff.peekActions())
      expect(diff.getActions()).to.not.equal(diff.getActions())
      expect(diff.getActions()).to.not.equal(diff.peekActions())
    })

    it('shows no trace of a retraction', function() {
      const diff = diffOf(4)
      diff.retract(diff.peekActions()[0])
      diff.retract(diff.peekActions()[diff.peekActions().length - 1])
      expect(diff.peekActions().every((action) => Boolean(action))).to.equal(true)
      expect(idsOf([...diff.peekActions()])).to.deep.equal([1, 2])
    })
  })

  describe('markChanged', function() {
    it('has the action written again on the next persist', async function() {
      const diff = diffOf(3)
      const update = await diff.getPendingChangesAsync()
      diff.markPersisted(update)
      expect((await diff.getPendingChangesAsync()).added).to.have.lengthOf(0)

      const action = diff.getActions()[1]
      action.index = 42
      diff.markChanged(action)

      const next = await diff.getPendingChangesAsync()
      expect(next.added).to.have.lengthOf(1)
      expect(next.added[0].action.payload.id).to.equal(1)
      expect(next.added[0].action.index).to.equal(42)
    })

    it('still finds the action after an earlier one was retracted', async function() {
      const diff = diffOf(3)
      diff.markPersisted(await diff.getPendingChangesAsync())
      const actions = diff.getActions()
      diff.retract(actions[0])
      // getActions() compacts, so the action has moved within the diff
      diff.getActions()
      diff.markChanged(actions[2])
      const next = await diff.getPendingChangesAsync()
      expect(next.added.map(({ action }) => action.payload.id)).to.deep.equal([2])
    })

    it('ignores an action the diff no longer holds', async function() {
      const diff = diffOf(2)
      diff.markPersisted(await diff.getPendingChangesAsync())
      const [first] = diff.getActions()
      diff.retract(first)
      diff.markChanged(first)
      expect((await diff.getPendingChangesAsync()).added).to.have.lengthOf(0)
    })
  })

  describe('persisting', function() {
    it('reports a retracted action as a removed row, whatever else moved', async function() {
      const diff = diffOf(4)
      const update = await diff.getPendingChangesAsync()
      diff.markPersisted(update)
      const seqOf = (id) => update.added.find(({ action }) => action.payload.id === id).seq

      const actions = diff.getActions()
      diff.retract(actions[1])
      diff.retract(actions[2])

      const next = await diff.getPendingChangesAsync()
      expect(next.added).to.have.lengthOf(0)
      expect(next.removed.slice().sort()).to.deep.equal([seqOf(1), seqOf(2)].sort())
    })

    it('keeps each action with its own row number across a compaction', async function() {
      const diff = diffOf(4)
      diff.markPersisted(await diff.getPendingChangesAsync(true))
      const before = await diff.getPendingChangesAsync(true)
      const seqById = new Map(before.added.map(({ seq, action }) => [action.payload.id, seq]))

      diff.retract(diff.getActions()[0])
      diff.getActions() // compacts

      const after = await diff.getPendingChangesAsync(true)
      after.added.forEach(({ seq, action }) => {
        expect(seq).to.equal(seqById.get(action.payload.id))
      })
      expect(after.added.map(({ action }) => action.payload.id)).to.deep.equal([1, 2, 3])
    })
  })
})
