/* global globalThis */
import { expect } from 'chai'
import { Bookmark, Folder, ItemLocation } from '../lib/Tree'

describe('LocalTabs URL filtering', function() {
  const supportedUrl = 'https://example.com/'

  const unsupportedFirefoxUrls = [
    'about:blank',
    'javascript:void(0)',
    'file:///tmp/example.html',
    'chrome://settings/',
    'data:text/plain,example',
  ]

  const unparseableUrls = [
    undefined,
    'not a URL',
  ]

  const urls = [
    supportedUrl,
    ...unsupportedFirefoxUrls,
    ...unparseableUrls,
  ]
  let LocalTabs, originalBrowser, originalLocation

  before(async function() {
    originalBrowser = globalThis.browser
    originalLocation = self.location
    const tabs = [-1, 10].flatMap((groupId, groupIndex) =>
      urls.map((url, index) => ({
        id: groupIndex * urls.length + index + 1,
        windowId: 1,
        groupId,
        index: groupIndex * urls.length + index,
        title: url,
        url,
        incognito: false,
      }))
    )
    globalThis.browser = {
      tabs: {
        query: async(query) => tabs.filter((tab) =>
          query.groupId === undefined || tab.groupId === query.groupId),
      },
      tabGroups: {
        query: async() => [{ id: 10, windowId: 1, title: 'Group' }],
      },
    }
    LocalTabs = (await import('../lib/LocalTabs')).default
  })

  afterEach(function() {
    self.location = originalLocation
  })

  after(function() {
    if (originalBrowser === undefined) {
      delete globalThis.browser
    } else {
      globalThis.browser = originalBrowser
    }
  })

  async function expectUrls(protocol, expected) {
    self.location = { protocol }
    const tree = await new LocalTabs().getBookmarksTree()
    const window = tree.findFolder('window-1')
    expect(window.children.filter((item) => item.type === 'bookmark').map((tab) => tab.url))
      .to.deep.equal(expected)
    expect(tree.findFolder('group-10').children.map((tab) => tab.url))
      .to.deep.equal(expected)
  }

  it('excludes unsupported Firefox URLs from ungrouped and grouped tabs', async function() {
    await expectUrls('moz-extension:', [supportedUrl, ...unparseableUrls])
  })

  it('keeps Chromium URLs in ungrouped and grouped tabs unchanged', async function() {
    await expectUrls('chrome-extension:', urls)
  })
})

describe('LocalTabs without windows and tab groups API', function() {
  let LocalTabs, browser, originalApi, tabs, nextTabId

  before(async function() {
    if (globalThis.browser === undefined) {
      globalThis.browser = {}
    }
    // browser-api holds on to the object it found first, so mock its members
    browser = (await import('../lib/browser-api')).default
    originalApi = { ...browser }
    LocalTabs = (await import('../lib/LocalTabs')).default
  })

  beforeEach(function() {
    // Firefox for Android: one window, no browser.windows, no tab groups
    tabs = [1, 2, 3].map((id, index) => ({
      id,
      windowId: 7,
      index,
      title: 'Tab ' + id,
      url: `https://example.com/${id}`,
      incognito: false,
    }))
    nextTabId = 100
    const reindex = () => tabs.forEach((tab, index) => { tab.index = index })
    for (const key of Object.keys(browser)) {
      delete browser[key]
    }
    Object.assign(browser, {
      tabs: {
        query: async() => tabs.map((tab) => ({ ...tab })),
        get: async(id) => ({ ...tabs.find((tab) => tab.id === id) }),
        create: async({ url }) => {
          const tab = { id: nextTabId++, windowId: 7, index: tabs.length, title: url, url, incognito: false }
          tabs.push(tab)
          return { ...tab }
        },
        update: async(id, { url }) => {
          tabs.find((tab) => tab.id === id).url = url
        },
        remove: async(ids) => {
          ids = [].concat(ids)
          tabs = tabs.filter((tab) => !ids.includes(tab.id))
          reindex()
        },
        onUpdated: {
          addListener: () => undefined,
          removeListener: () => undefined,
        },
      },
    })
  })

  after(function() {
    for (const key of Object.keys(browser)) {
      delete browser[key]
    }
    Object.assign(browser, originalApi)
  })

  async function createFolder(localTabs, title, parentId) {
    return localTabs.createFolder(new Folder({ title, parentId, location: ItemLocation.LOCAL }))
  }

  async function createTab(localTabs, url, parentId) {
    return localTabs.createBookmark(new Bookmark({ title: url, url, parentId, location: ItemLocation.LOCAL }))
  }

  it('reads the one window', async function() {
    const tree = await new LocalTabs().getBookmarksTree()
    expect(tree.children.map((window) => window.id)).to.deep.equal(['window-7'])
    expect(tree.children[0].children.map((tab) => tab.id)).to.deep.equal([1, 2, 3])
  })

  it('flattens windows and groups into the existing window', async function() {
    const localTabs = new LocalTabs()
    const windowId = await createFolder(localTabs, 'Window 1', 'tabs')
    const groupId = await createFolder(localTabs, 'Group', windowId)
    const groupInRealWindowId = await createFolder(localTabs, 'Other group', 'window-7')
    expect(new Set([windowId, groupId, groupInRealWindowId]).size).to.equal(3)

    const inWindow = await createTab(localTabs, 'https://example.org/a', windowId)
    const inGroup = await createTab(localTabs, 'https://example.org/b', groupId)
    const inOtherGroup = await createTab(localTabs, 'https://example.org/c', groupInRealWindowId)

    // Nothing for the flattened folders to do, and nothing for them to fail on
    await localTabs.updateFolder(new Folder({ id: groupId, title: 'Renamed', parentId: windowId, location: ItemLocation.LOCAL }))
    await localTabs.orderFolder(windowId, [{ type: 'folder', id: groupId }, { type: 'bookmark', id: inWindow }])

    const tree = await localTabs.getBookmarksTree()
    expect(tree.children.map((window) => window.id)).to.deep.equal(['window-7'])
    expect(tree.children[0].children.map((tab) => tab.id))
      .to.deep.equal([1, 2, 3, inWindow, inGroup, inOtherGroup])
  })

  it('leaves a tab where it is when it moves into a flattened folder', async function() {
    const localTabs = new LocalTabs()
    const groupId = await createFolder(localTabs, 'Group', 'window-7')
    await localTabs.updateBookmark(new Bookmark({ id: 2, title: 'Tab 2', url: 'https://example.com/two', parentId: groupId, location: ItemLocation.LOCAL }))
    expect(tabs.map((tab) => [tab.id, tab.url])).to.deep.equal([
      [1, 'https://example.com/1'],
      [2, 'https://example.com/two'],
      [3, 'https://example.com/3'],
    ])
  })

  it('does not move a tab between windows', async function() {
    const localTabs = new LocalTabs()
    // e.g. a mapping to the window id from before a restart
    await localTabs.updateBookmark(new Bookmark({ id: 2, title: 'Tab 2', url: 'https://example.com/2', parentId: 'window-8', location: ItemLocation.LOCAL }))
    expect(tabs.map((tab) => [tab.id, tab.windowId])).to.deep.equal([[1, 7], [2, 7], [3, 7]])
  })

  it('refuses to reorder a window', async function() {
    let error
    try {
      await new LocalTabs().orderFolder('window-7', [3, 2, 1].map((id) => ({ type: 'bookmark', id })))
    } catch (e) {
      error = e
    }
    expect(error).to.be.instanceOf(Error)
    expect(tabs.map((tab) => tab.id)).to.deep.equal([1, 2, 3])
  })

  it('removes a flattened folder without touching any tab', async function() {
    const localTabs = new LocalTabs()
    const windowId = await createFolder(localTabs, 'Window 1', 'tabs')
    await createTab(localTabs, 'https://example.org/a', windowId)
    await localTabs.removeFolder(new Folder({ id: windowId, title: 'Window 1', parentId: 'tabs', location: ItemLocation.LOCAL }))
    expect(tabs).to.have.lengthOf(4)
  })

  it('closes the tabs of a removed window', async function() {
    const localTabs = new LocalTabs()
    await localTabs.removeFolder(new Folder({ id: 'window-7', title: 'Window 0', parentId: 'tabs', location: ItemLocation.LOCAL }))
    expect(tabs).to.have.lengthOf(0)
  })
})

describe('LocalTabs unsupported tabs', function() {
  let LocalTabs, UnsupportedItemError, originalLocation

  before(async function() {
    LocalTabs = (await import('../lib/LocalTabs')).default
    ;({ UnsupportedItemError } = await import('../errors/Error'))
    originalLocation = self.location
  })

  after(function() {
    self.location = originalLocation
  })

  async function expectSkipped(bookmark) {
    let error
    try {
      await new LocalTabs().createBookmark(new Bookmark({ title: 'tab', location: ItemLocation.LOCAL, ...bookmark }))
    } catch (e) {
      error = e
    }
    expect(error).to.be.instanceOf(UnsupportedItemError)
  }

  it('skips URLs Firefox cannot open', async function() {
    self.location = { protocol: 'moz-extension:' }
    await expectSkipped({ url: 'chrome://newtab/', parentId: 'window-1' })
  })

  it('skips tabs outside of a window', async function() {
    await expectSkipped({ url: 'https://example.com/', parentId: 'tabs' })
  })
})

describe('LocalTabs pinned tabs', function() {
  let LocalTabs, browser, originalApi, tabs

  before(async function() {
    if (globalThis.browser === undefined) {
      globalThis.browser = {}
    }
    browser = (await import('../lib/browser-api')).default
    originalApi = { ...browser }
    LocalTabs = (await import('../lib/LocalTabs')).default
  })

  beforeEach(function() {
    // window 7: two pinned tabs, two tabs, and a group of two;
    // window 8: one pinned tab only
    tabs = [
      { id: 1, windowId: 7, pinned: true, groupId: -1 },
      { id: 2, windowId: 7, pinned: true, groupId: -1 },
      { id: 3, windowId: 7, pinned: false, groupId: -1 },
      { id: 4, windowId: 7, pinned: false, groupId: -1 },
      { id: 5, windowId: 7, pinned: false, groupId: 50 },
      { id: 6, windowId: 7, pinned: false, groupId: 50 },
      { id: 9, windowId: 8, pinned: true, groupId: -1 },
    ].map((tab) => ({ ...tab, title: 'Tab ' + tab.id, url: `https://example.com/${tab.id}`, incognito: false }))
    reindex()
    const pinnedCount = (windowId) =>
      tabs.filter((tab) => tab.windowId === windowId && tab.pinned).length
    // Like Chromium: pinned tabs stay in front, a group can't go among them
    const moveTabs = (moving, index) => {
      const windowId = moving[0].windowId
      const minIndex = moving[0].pinned ? 0 : pinnedCount(windowId)
      const rest = tabs.filter((tab) => !moving.includes(tab))
      const windowTabs = rest.filter((tab) => tab.windowId === windowId)
      const target = Math.min(Math.max(index, minIndex), windowTabs.length)
      const before = windowTabs[target]
      rest.splice(before ? rest.indexOf(before) : rest.length, 0, ...moving)
      tabs = rest
      reindex()
    }
    for (const key of Object.keys(browser)) {
      delete browser[key]
    }
    Object.assign(browser, {
      windows: {
        remove: async(windowId) => {
          tabs = tabs.filter((tab) => tab.windowId !== windowId)
          reindex()
        },
      },
      tabs: {
        query: async(query) => tabs
          .filter((tab) =>
            (query.windowId === undefined || tab.windowId === query.windowId) &&
            (query.groupId === undefined || tab.groupId === query.groupId) &&
            (query.pinned === undefined || tab.pinned === query.pinned))
          .map((tab) => ({ ...tab })),
        get: async(id) => ({ ...tabs.find((tab) => tab.id === id) }),
        update: async(id, { url }) => {
          tabs.find((tab) => tab.id === id).url = url
        },
        move: async(id, { index }) => {
          moveTabs([tabs.find((tab) => tab.id === id)], index)
        },
        remove: async(ids) => {
          ids = [].concat(ids)
          tabs = tabs.filter((tab) => !ids.includes(tab.id))
          reindex()
        },
        group: async() => undefined,
        ungroup: async() => undefined,
        onUpdated: {
          addListener: () => undefined,
          removeListener: () => undefined,
        },
      },
      tabGroups: {
        query: async() => [{ id: 50, windowId: 7, title: 'Group' }],
        get: async(id) => (id === 50 ? { id, windowId: 7, title: 'Group' } : undefined),
        move: async(groupId, { index }) => {
          const groupTabs = tabs.filter((tab) => tab.groupId === groupId)
          if (index < pinnedCount(groupTabs[0].windowId)) {
            throw new Error('Cannot move the group to an index that is in the middle of pinned tabs.')
          }
          moveTabs(groupTabs, index)
        },
      },
    })
  })

  after(function() {
    for (const key of Object.keys(browser)) {
      delete browser[key]
    }
    Object.assign(browser, originalApi)
  })

  function reindex() {
    for (const windowId of new Set(tabs.map((tab) => tab.windowId))) {
      tabs.filter((tab) => tab.windowId === windowId).forEach((tab, index) => { tab.index = index })
    }
  }

  function windowOrder(windowId) {
    return tabs.filter((tab) => tab.windowId === windowId).map((tab) => tab.id)
  }

  function ignoring(ignorePinnedTabs) {
    const localTabs = new LocalTabs()
    localTabs.setIgnorePinnedTabs(ignorePinnedTabs)
    return localTabs
  }

  it('reads pinned tabs as ordinary tabs by default', async function() {
    const tree = await new LocalTabs().getBookmarksTree()
    expect(tree.children.map((window) => window.id)).to.deep.equal(['window-7', 'window-8'])
    expect(tree.findFolder('window-7').children.map((item) => item.id))
      .to.deep.equal([1, 2, 3, 4, 'group-50'])
  })

  it('leaves pinned tabs and windows of only pinned tabs out when ignoring them', async function() {
    const tree = await ignoring(true).getBookmarksTree()
    expect(tree.children.map((window) => window.id)).to.deep.equal(['window-7'])
    expect(tree.findFolder('window-7').children.map((item) => item.id))
      .to.deep.equal([3, 4, 'group-50'])
  })

  it('orders a window behind the ignored pinned tabs', async function() {
    await ignoring(true).orderFolder('window-7', [
      { type: 'folder', id: 'group-50' },
      { type: 'bookmark', id: 4 },
      { type: 'bookmark', id: 3 },
    ])
    expect(windowOrder(7)).to.deep.equal([1, 2, 5, 6, 4, 3])
  })

  it('puts synced pinned tabs in front when ordering a window', async function() {
    // e.g. the other device has them elsewhere: the order can't be had here
    await ignoring(false).orderFolder('window-7', [
      { type: 'folder', id: 'group-50' },
      { type: 'bookmark', id: 3 },
      { type: 'bookmark', id: 2 },
      { type: 'bookmark', id: 4 },
      { type: 'bookmark', id: 1 },
    ])
    expect(windowOrder(7)).to.deep.equal([2, 1, 5, 6, 3, 4])
  })

  it('does not close or change an ignored pinned tab', async function() {
    const localTabs = ignoring(true)
    await localTabs.removeBookmark(new Bookmark({ id: 1, title: 'Tab 1', url: 'https://example.com/1', parentId: 'window-7', location: ItemLocation.LOCAL }))
    await localTabs.updateBookmark(new Bookmark({ id: 2, title: 'Tab 2', url: 'https://example.com/other', parentId: 'window-7', location: ItemLocation.LOCAL }))
    expect(windowOrder(7)).to.deep.equal([1, 2, 3, 4, 5, 6])
    expect(tabs.find((tab) => tab.id === 2).url).to.equal('https://example.com/2')
  })

  it('closes a pinned tab when not ignoring them', async function() {
    await ignoring(false).removeBookmark(new Bookmark({ id: 1, title: 'Tab 1', url: 'https://example.com/1', parentId: 'window-7', location: ItemLocation.LOCAL }))
    expect(windowOrder(7)).to.deep.equal([2, 3, 4, 5, 6])
  })

  it('keeps ignored pinned tabs open when their window is removed', async function() {
    await ignoring(true).removeFolder(new Folder({ id: 'window-7', title: 'Window 0', parentId: 'tabs', location: ItemLocation.LOCAL }))
    expect(windowOrder(7)).to.deep.equal([1, 2])
  })

  it('closes a removed window entirely when not ignoring pinned tabs', async function() {
    await ignoring(false).removeFolder(new Folder({ id: 'window-7', title: 'Window 0', parentId: 'tabs', location: ItemLocation.LOCAL }))
    expect(windowOrder(7)).to.deep.equal([])
  })
})
