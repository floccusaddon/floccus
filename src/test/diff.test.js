import { expect } from './utils'
import Diff, { ActionType } from '../lib/Diff'
import { Bookmark, Folder, ItemLocation, serializeIterations } from '../lib/Tree'

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

    it('skips nothing when the diff is compacted while it serializes', async function() {
      const diff = diffOf(4)
      const first = diff.getActions()[0]
      const pending = diff.getPendingChangesAsync(true)
      // The first action is being serialized now; execute it and let the
      // executor's next getActions() compact the diff under the running loop
      diff.retract(first)
      diff.getActions()

      const update = await pending
      expect(update.added.map(({ action }) => action.payload.id)).to.deep.equal([1, 2, 3])
    })
  })

  describe('findChain', function() {
    const L = ItemLocation.LOCAL
    const S = ItemLocation.SERVER
    const snapshot = (serverToLocalFolders = {}) => ({
      LocalToServer: {
        folder: Object.fromEntries(Object.entries(serverToLocalFolders).map(([s, l]) => [l, s])),
        bookmark: {},
      },
      ServerToLocal: { folder: serverToLocalFolders, bookmark: {} },
    })
    const folder = (id, parentId, children = [], location = L) =>
      new Folder({ id, parentId, title: 'folder' + id, location, children })
    const bm = (id, parentId, location = L) =>
      new Bookmark({ id, parentId, title: 'bookmark' + id, url: 'http://example.com/' + id, location })
    const create = (payload) => ({ type: ActionType.CREATE, payload })
    const move = (payload) => ({ type: ActionType.MOVE, payload })
    const remove = (payload) => ({ type: ActionType.REMOVE, payload })
    // A tree that knows none of the items, so only the payloads and the
    // actions can tell where something is
    const emptyTree = () => folder(0, undefined)

    describe('without any actions', function() {
      it('finds an item directly inside the removed folder', function() {
        const removal = remove(folder(10, 1))
        expect(Diff.findChain(snapshot(), [], emptyTree(), bm(20, 10), removal)).to.equal(true)
      })

      it('finds an item further down inside the removed folder', function() {
        const removal = remove(folder(10, 1, [folder(11, 10, [folder(12, 11)])]))
        expect(Diff.findChain(snapshot(), [], emptyTree(), bm(20, 12), removal)).to.equal(true)
      })

      it('does not find an item elsewhere', function() {
        const removal = remove(folder(10, 1, [folder(11, 10)]))
        expect(Diff.findChain(snapshot(), [], emptyTree(), bm(20, 13), removal)).to.equal(false)
      })

      it('does not count the removed folder itself', function() {
        const removed = folder(10, 1)
        // The folder's parent is outside of it
        expect(Diff.findChain(snapshot(), [], emptyTree(), folder(10, 1), remove(removed))).to.equal(false)
      })

      it('looks the removed folder up in the tree when its payload has no children', function() {
        const removal = remove(folder(10, 1))
        const tree = folder(1, undefined, [folder(10, 1, [folder(11, 10)])])
        expect(Diff.findChain(snapshot(), [], tree, bm(20, 11), removal)).to.equal(true)
        // ... which is why callers pass an empty tree to ignore where things are now
        expect(Diff.findChain(snapshot(), [], emptyTree(), bm(20, 11), removal)).to.equal(false)
      })
    })

    describe('across locations', function() {
      it('maps the item\'s parent to the location of the removed folder', function() {
        const removal = remove(folder(10, 1, [folder(11, 10)]))
        const serverBookmark = bm('s20', 's11', S)
        expect(Diff.findChain(snapshot({ s11: 11 }), [], emptyTree(), serverBookmark, removal)).to.equal(true)
      })

      it('does not find an item whose parent has no mapping', function() {
        const removal = remove(folder(10, 1, [folder(11, 10)]))
        const serverBookmark = bm('s20', 's11', S)
        expect(Diff.findChain(snapshot(), [], emptyTree(), serverBookmark, removal)).to.equal(false)
      })

      it('follows a chain through an action in the other location', function() {
        // Locally removed folder 10; on the server, folder s30 (mapped to 30)
        // was moved into s11 (mapped to 11, inside 10), and the bookmark
        // created in s30
        const removal = remove(folder(10, 1, [folder(11, 10)]))
        const serverMove = move(folder('s30', 's11', [], S))
        const serverBookmark = bm('s20', 's30', S)
        const mappings = snapshot({ s11: 11, s30: 30 })
        expect(Diff.findChain(mappings, [serverMove], emptyTree(), serverBookmark, removal)).to.equal(true)
        expect(Diff.findChain(mappings, [], emptyTree(), serverBookmark, removal)).to.equal(false)
      })
    })

    describe('through actions', function() {
      it('follows a folder created inside the removed folder', function() {
        const removal = remove(folder(10, 1))
        const actions = [create(folder(30, 10))]
        expect(Diff.findChain(snapshot(), actions, emptyTree(), bm(20, 30), removal)).to.equal(true)
      })

      it('follows a chain of moves', function() {
        // 32 moved into 31, 31 into 30, 30 into the removed folder
        const removal = remove(folder(10, 1))
        const actions = [move(folder(32, 31)), move(folder(31, 30)), move(folder(30, 10))]
        expect(Diff.findChain(snapshot(), actions, emptyTree(), bm(20, 32), removal)).to.equal(true)
        // in any order
        expect(Diff.findChain(snapshot(), actions.slice().reverse(), emptyTree(), bm(20, 32), removal)).to.equal(true)
      })

      it('does not follow a chain that leads elsewhere', function() {
        const removal = remove(folder(10, 1))
        const actions = [move(folder(32, 31)), move(folder(31, 30)), move(folder(30, 40))]
        expect(Diff.findChain(snapshot(), actions, emptyTree(), bm(20, 32), removal)).to.equal(false)
      })

      it('does not follow a chain with a missing link', function() {
        const removal = remove(folder(10, 1))
        const actions = [move(folder(32, 31)), move(folder(30, 10))]
        expect(Diff.findChain(snapshot(), actions, emptyTree(), bm(20, 32), removal)).to.equal(false)
      })

      it('follows a moved folder\'s subtree', function() {
        // 30 was moved into the removed folder with 31 inside it
        const removal = remove(folder(10, 1))
        const actions = [move(folder(30, 10, [folder(31, 30)]))]
        expect(Diff.findChain(snapshot(), actions, emptyTree(), bm(20, 31), removal)).to.equal(true)
      })

      it('ignores actions that only move things out of the item\'s ancestors', function() {
        const removal = remove(folder(10, 1))
        // 30 holds the bookmark, its sibling 31 moved into the removed folder
        const actions = [move(folder(31, 10)), move(folder(30, 1))]
        expect(Diff.findChain(snapshot(), actions, emptyTree(), bm(20, 30), removal)).to.equal(false)
      })

      it('terminates on a hierarchy reversal', function() {
        // 30 moved into 31 and 31 into 30: each one's payload is a parent of the other
        const removal = remove(folder(10, 1))
        const actions = [move(folder(30, 31)), move(folder(31, 30))]
        expect(Diff.findChain(snapshot(), actions, emptyTree(), bm(20, 30), removal)).to.equal(false)
        actions.push(move(folder(32, 10, [folder(31, 32)])))
        expect(Diff.findChain(snapshot(), actions, emptyTree(), bm(20, 30), removal)).to.equal(true)
      })
    })

    describe('with a cache', function() {
      it('keeps answers for different targets apart', function() {
        const removal1 = remove(folder(10, 1, [folder(11, 10)]))
        const removal2 = remove(folder(12, 1))
        const item = bm(20, 30)
        const actions = [move(folder(30, 11))]
        const cache = {}
        expect(Diff.findChain(snapshot(), actions, emptyTree(), item, removal2, cache)).to.equal(false)
        expect(Diff.findChain(snapshot(), actions, emptyTree(), item, removal1, cache)).to.equal(true)
        expect(Diff.findChain(snapshot(), actions, emptyTree(), item, removal2, cache)).to.equal(false)
        expect(Diff.findChain(snapshot(), actions, emptyTree(), item, removal1, cache)).to.equal(true)
      })

      it('keeps answers for different items apart', function() {
        const removal = remove(folder(10, 1))
        const actions = [move(folder(30, 10)), move(folder(31, 40))]
        const cache = {}
        expect(Diff.findChain(snapshot(), actions, emptyTree(), bm(20, 31), removal, cache)).to.equal(false)
        expect(Diff.findChain(snapshot(), actions, emptyTree(), bm(21, 30), removal, cache)).to.equal(true)
        expect(Diff.findChain(snapshot(), actions, emptyTree(), bm(22, 31), removal, cache)).to.equal(false)
      })

      it('reuses an item\'s chain for every target', function() {
        // The chain from the bookmark runs through 30 and 31; asked about
        // three removals, each of them on a different link
        const actions = [move(folder(30, 31)), move(folder(31, 32))]
        const item = bm(20, 30)
        const cache = {}
        expect(Diff.findChain(snapshot(), actions, emptyTree(), item, remove(folder(40, 1)), cache)).to.equal(false)
        expect(Diff.findChain(snapshot(), actions, emptyTree(), item, remove(folder(30, 1)), cache)).to.equal(true)
        expect(Diff.findChain(snapshot(), actions, emptyTree(), item, remove(folder(31, 1)), cache)).to.equal(true)
        expect(Diff.findChain(snapshot(), actions, emptyTree(), item, remove(folder(32, 1)), cache)).to.equal(true)
      })
    })

    // The shape of the failing sync in 'should handle complex move-remove
    // interactions': the cache has z(a(url)), locally a moved out of z into b
    // and got a new subfolder, z moved into c, and the server removed z. The
    // removal's payload and the MOVE's payload are both #603[z] -- one as it
    // was in the cache (still holding a), one as it is now (empty).
    describe('with two payloads of the same item', function() {
      function scenario() {
        const cacheZ = folder(603, 601, [folder(604, 603, [bm(607, 604)])])
        const newFolder = folder(615, 604)
        const movedA = folder(604, 605, [bm(607, 604), newFolder])
        const movedZ = folder(603, 606)
        const localTree = folder(601, undefined, [
          folder(605, 601, [movedA]),
          folder(606, 601, [movedZ]),
        ])
        localTree.createIndex()

        const actions = [create(newFolder), move(movedZ), move(movedA)]
        return { localTree, actions, removal: remove(cacheZ), newFolder }
      }

      it('tells them apart', function() {
        const { localTree, actions, removal, newFolder } = scenario()
        // a, new's parent, was inside z when the server removed it
        expect(Diff.findChain(snapshot(), actions, localTree, newFolder, removal, {})).to.equal(true)
      })

      it('tells them apart with a cache shared across calls', function() {
        const { localTree, actions, removal, newFolder } = scenario()
        const cache = {}
        // Ask about the MOVE of z first, which is z in its new, empty place
        expect(Diff.findChain(snapshot(), actions, localTree, newFolder, actions[1], cache)).to.equal(false)
        expect(Diff.findChain(snapshot(), actions, localTree, newFolder, removal, cache)).to.equal(true)
        // ... and the other way round
        const cache2 = {}
        expect(Diff.findChain(snapshot(), actions, localTree, newFolder, removal, cache2)).to.equal(true)
        expect(Diff.findChain(snapshot(), actions, localTree, newFolder, actions[1], cache2)).to.equal(false)
      })
    })
  })
})

describe('Tree serialization', function() {
  function tree() {
    let id = 0
    return new Folder({
      id: ++id,
      title: 'root',
      location: ItemLocation.LOCAL,
      children: [
        new Bookmark({ id: ++id, parentId: 1, title: 'a', url: 'http://example.com/a', location: ItemLocation.LOCAL }),
        new Folder({
          id: ++id,
          parentId: 1,
          title: 'sub',
          location: ItemLocation.LOCAL,
          children: [
            new Bookmark({ id: ++id, parentId: 3, title: 'b', url: 'http://example.com/b', tags: ['x', 'y'], location: ItemLocation.LOCAL }),
          ],
        }),
      ],
    })
  }

  it('toJSONAsync agrees with toJSON', async function() {
    const folder = tree()
    expect(await folder.toJSONAsync()).to.deep.equal(folder.toJSON())
  })

  it('agrees on a folder carrying hashes and an index, too', async function() {
    const folder = tree()
    await folder.hash({ preserveOrder: false, hashFn: 'murmur3', syncTags: false })
    folder.createIndex()
    const json = await folder.toJSONAsync()
    expect(json).to.deep.equal(folder.toJSON())
    // the index is derived, and must not be dragged into storage with the rest
    expect('index' in json).to.equal(false)
  })

  it('agrees on a clone, whose properties sit on its prototype', async function() {
    // clone() hands out Object.create(this), so toJSONAsync has to walk the
    // prototype chain to find anything at all
    const folder = tree().clone(true)
    expect(await folder.toJSONAsync()).to.deep.equal(folder.toJSON())
    expect((await folder.toJSONAsync()).children).to.have.lengthOf(2)
  })

  function wide(count) {
    let id = 0
    return new Folder({
      id: ++id,
      title: 'root',
      location: ItemLocation.LOCAL,
      children: Array.from({ length: count }, (_, i) => new Bookmark({
        id: ++id, parentId: 1, title: 'b' + i, url: 'http://example.com/' + i, location: ItemLocation.LOCAL,
      })),
    })
  }

  it('ticks its yield counter once per item, so the yields land every 1000', async function() {
    // The counter used to be local to each call and count the steps of the
    // item's own prototype chain -- two or three -- so `% 1000` never came up
    // and a whole tree was serialized without ever giving the browser a breath
    const folder = wide(250)
    const before = serializeIterations()
    await folder.toJSONAsync()
    expect(serializeIterations() - before).to.equal(folder.count() + folder.countFolders())
  })

  it('ticks once per item for a clone, too, whatever its prototype chain', async function() {
    const folder = wide(250).clone(true)
    const before = serializeIterations()
    await folder.toJSONAsync()
    expect(serializeIterations() - before).to.equal(251)
  })

  it('keeps the children in order', async function() {
    const folder = tree()
    const json = await folder.toJSONAsync()
    expect(json.children.map((child) => child.id)).to.deep.equal(folder.children.map((child) => child.id))
    expect(json.children[1].children[0].title).to.equal('b')
  })
})
