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

describe('LocalTabs after a browser start', function() {
  let LocalTabs, waitForTabsToSettle, browser, originalApi, tabs

  before(async function() {
    if (globalThis.browser === undefined) {
      globalThis.browser = {}
    }
    // browser-api holds on to the object it found first, so mock its members
    browser = (await import('../lib/browser-api')).default
    originalApi = { ...browser }
    ;({ default: LocalTabs, waitForTabsToSettle } = await import('../lib/LocalTabs'))
  })

  beforeEach(function() {
    tabs = [
      // A restored tab that hasn't committed its URL yet
      { id: 1, windowId: 7, groupId: -1, index: 0, title: 'One', url: '', pendingUrl: 'https://example.com/1', status: 'loading' },
      { id: 2, windowId: 7, groupId: 30, index: 1, title: 'Two', url: 'https://example.com/2', status: 'complete' },
    ].map((tab) => ({ incognito: false, ...tab }))
    for (const key of Object.keys(browser)) {
      delete browser[key]
    }
    Object.assign(browser, {
      tabs: {
        query: async(query) => tabs
          .filter((tab) => query.groupId === undefined || tab.groupId === query.groupId)
          .map((tab) => ({ ...tab })),
        group: async() => undefined,
      },
      tabGroups: {
        query: async() => [{ id: 30, windowId: 7, title: '' }],
      },
    })
  })

  after(function() {
    for (const key of Object.keys(browser)) {
      delete browser[key]
    }
    Object.assign(browser, originalApi)
  })

  it('reads the URL a tab is still loading', async function() {
    const tree = await new LocalTabs().getBookmarksTree()
    expect(tree.findBookmark(1).url).to.equal('https://example.com/1')
  })

  it('leaves an untitled group untitled', async function() {
    // Group ids change with every browser start, a title made of one would never match again
    const tree = await new LocalTabs().getBookmarksTree()
    expect(tree.findFolder('group-30').title).to.equal('')
  })

  it('waits for tabs to stop loading', async function() {
    this.timeout(10000)
    setTimeout(() => {
      tabs[0] = { ...tabs[0], url: tabs[0].pendingUrl, pendingUrl: undefined, status: 'complete' }
    }, 1500)
    const start = Date.now()
    await waitForTabsToSettle()
    // and then for the tabs to stay the same over the next polls
    expect(Date.now() - start).to.be.at.least(1500 + 2000)
    expect(tabs[0].status).to.equal('complete')
  })
})
