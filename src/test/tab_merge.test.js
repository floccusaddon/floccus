import { expect } from 'chai'
import { Bookmark, Folder, ItemLocation } from '../lib/Tree'
import Mappings from '../lib/Mappings'
import MergeSyncProcess from '../lib/strategies/Merge'

// Tab profiles merge after every browser start (see BrowserController#prepareTabAccounts),
// when no window or group has the id it had before
describe('Merging tabs after a browser start', function() {
  function emptyMappings() {
    return new Mappings(null, {
      folders: { LocalToServer: {}, ServerToLocal: {} },
      bookmarks: { LocalToServer: {}, ServerToLocal: {} },
    })
  }

  function tab(id, url, parentId, location) {
    return new Bookmark({ id, title: url, url, parentId, location })
  }

  function tree(location, rootId, windows) {
    const root = new Folder({ id: rootId, title: '', location, children: [] })
    root.children = windows.map(({ id, title, children }) => new Folder({
      id,
      title,
      parentId: rootId,
      location,
      children: children(id),
    }))
    root.createIndex()
    return root
  }

  async function getDiffs(localTreeRoot, serverTreeRoot, isUsingTabs = true) {
    const process = new MergeSyncProcess(
      emptyMappings(),
      { isUsingBrowserTabs: async() => isUsingTabs },
      null,
      async() => undefined
    )
    process.localTreeRoot = localTreeRoot
    process.serverTreeRoot = serverTreeRoot
    process.hashSettings = { preserveOrder: true, hashFn: 'sha256', syncTags: false }
    return process.getDiffs()
  }

  function structuralChanges(scanResult) {
    return ['CREATE', 'REMOVE', 'MOVE'].flatMap((type) => scanResult[type].getActions())
  }

  const L = ItemLocation.LOCAL
  const S = ItemLocation.SERVER

  // The windows came back in a different order, so their titles are swapped,
  // and the untitled group has a new id
  const local = () => tree(L, 'tabs', [
    {
      id: 'window-10',
      title: 'Window 0',
      children: (parentId) => [
        tab(1, 'https://example.com/a', parentId, L),
        tab(2, 'https://example.com/b', parentId, L),
        new Folder({
          id: 'group-50',
          title: '',
          parentId,
          location: L,
          children: [tab(3, 'https://example.com/c', 'group-50', L)],
        }),
      ],
    },
    {
      id: 'window-11',
      title: 'Window 1',
      children: (parentId) => [
        tab(4, 'https://example.com/d', parentId, L),
        tab(5, 'https://example.com/e', parentId, L),
      ],
    },
  ])

  const server = (groupTitle) => tree(S, 'root', [
    {
      id: 's1',
      title: 'Window 0',
      children: (parentId) => [
        tab('s4', 'https://example.com/d', parentId, S),
        tab('s5', 'https://example.com/e', parentId, S),
      ],
    },
    {
      id: 's2',
      title: 'Window 1',
      children: (parentId) => [
        tab('s1', 'https://example.com/a', parentId, S),
        tab('s2', 'https://example.com/b', parentId, S),
        new Folder({
          id: 'sg',
          title: groupTitle,
          parentId,
          location: S,
          children: [tab('s3', 'https://example.com/c', 'sg', S)],
        }),
      ],
    },
  ])

  it('pairs windows by their tabs rather than by their position', async function() {
    const { localScanResult, serverScanResult } = await getDiffs(local(), server(''))
    expect(structuralChanges(localScanResult)).to.have.lengthOf(0)
    expect(structuralChanges(serverScanResult)).to.have.lengthOf(0)
  })

  it('recognizes an untitled group stored by an older version as Group <id>', async function() {
    const { localScanResult, serverScanResult } = await getDiffs(local(), server('Group 1234'))
    expect(structuralChanges(localScanResult)).to.have.lengthOf(0)
    expect(structuralChanges(serverScanResult)).to.have.lengthOf(0)
    // The local, untitled group's title is the one to keep
    expect(localScanResult.UPDATE.getActions().map((a) => a.payload.title)).to.include('')
  })

  it('does not merge an untitled group into a titled one', async function() {
    const { serverScanResult } = await getDiffs(local(), server('Work'))
    expect(serverScanResult.CREATE.getActions().map((a) => a.payload.title)).to.deep.equal(['Work'])
  })

  it('leaves bookmark folders to their titles', async function() {
    // Same-titled folders are paired, so the tabs look moved between them
    const { serverScanResult } = await getDiffs(local(), server(''), false)
    expect(structuralChanges(serverScanResult)).to.have.length.above(0)
  })
})
