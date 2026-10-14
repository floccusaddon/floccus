/* global globalThis */
import { expect } from 'chai'

describe('LocalTabs URL filtering', function() {
  const urls = [
    'https://example.com/',
    'about:blank',
    'javascript:void(0)',
    'file:///tmp/example.html',
    'chrome://settings/',
    'data:text/plain,example',
    undefined,
    'not a URL',
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
    await expectUrls('moz-extension:', [urls[0], undefined, 'not a URL'])
  })

  it('keeps Chromium URLs in ungrouped and grouped tabs unchanged', async function() {
    await expectUrls('chrome-extension:', urls)
  })
})
