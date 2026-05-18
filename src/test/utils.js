import chai from 'chai'
import chaiAsPromised from 'chai-as-promised'
import { Bookmark } from '../lib/Tree'
import Logger from '../lib/Logger'
import FakeAdapter from '../lib/adapters/Fake'
import random from 'random'
import browser from '../lib/browser-api'

export function getEnv() {
  const params = new URL(window.location.href).searchParams
  let SERVER,
    CREDENTIALS,
    ACCOUNTS,
    APP_VERSION,
    SEED,
    BROWSER,
    RANDOM_MANIPULATION_ITERATIONS,
    TEST_URL,
    IS_CI
  SERVER = params.get('server') || 'http://localhost'
  TEST_URL = params.get('test_url') || 'https://example.org/'
  CREDENTIALS = {
    username: params.get('username') || 'admin',
    password: params.get('password') || 'admin',
  }
  APP_VERSION = params.get('app_version') || 'stable'
  BROWSER = params.get('browser') || 'firefox'
  IS_CI = params.get('ci') === 'true'

  SEED =
    new URL(window.location.href).searchParams.get('seed') || Math.random() + ''
  console.log('RANDOMNESS SEED', SEED)

  RANDOM_MANIPULATION_ITERATIONS = 35

  ACCOUNTS = [
    FakeAdapter.getDefaultValues(),
    {
      ...FakeAdapter.getDefaultValues(),
      noCache: true,
    },
    {
      type: 'nextcloud-bookmarks',
      url: SERVER,
      ...CREDENTIALS,
    },
    {
      type: 'nextcloud-bookmarks',
      url: SERVER,
      serverRoot: '/my folder/some subfolder',
      ...CREDENTIALS,
    },
    {
      type: 'webdav',
      url: `${SERVER}/remote.php/webdav/`,
      bookmark_file: 'bookmarks.xbel',
      bookmark_file_type: 'xbel',
      ...CREDENTIALS,
    },
    {
      type: 'webdav',
      url: `${SERVER}/remote.php/webdav/`,
      bookmark_file: 'bookmarks.xbel',
      bookmark_file_type: 'xbel',
      passphrase: random.float(),
      ...CREDENTIALS,
    },
    {
      type: 'webdav',
      url: `${SERVER}/remote.php/webdav/`,
      bookmark_file: 'bookmarks.html',
      bookmark_file_type: 'html',
      ...CREDENTIALS,
    },
    {
      type: 'webdav',
      url: `${SERVER}/remote.php/webdav/`,
      bookmark_file: 'bookmarks.html',
      bookmark_file_type: 'html',
      passphrase: random.float(),
      ...CREDENTIALS,
    },
    {
      type: 'git',
      url: `${SERVER}/test.git`,
      branch: 'main',
      bookmark_file: 'bookmarks.xbel',
      bookmark_file_type: 'xbel',
      ...CREDENTIALS,
    },
    {
      type: 'git',
      url: `${SERVER}/test.git`,
      branch: 'main',
      bookmark_file: 'bookmarks.html',
      bookmark_file_type: 'html',
      ...CREDENTIALS,
    },
    {
      type: 'google-drive',
      bookmark_file: Math.random() + '.xbel',
      password: '',
      refreshToken: CREDENTIALS.password,
    },
    {
      type: 'google-drive',
      bookmark_file: Math.random() + '.xbel',
      password: random.float(),
      refreshToken: CREDENTIALS.password,
    },
    {
      type: 'dropbox',
      bookmark_file: Math.random() + '.xbel',
      password: '',
      refreshToken: CREDENTIALS.password,
    },
    {
      type: 'dropbox',
      bookmark_file: Math.random() + '.xbel',
      password: random.float(),
      refreshToken: CREDENTIALS.password,
    },
    {
      type: 'linkwarden',
      url: SERVER,
      serverFolder: 'Floccus-' + Math.random(),
      ...CREDENTIALS,
    },
    {
      type: 'karakeep',
      url: SERVER,
      serverFolder: 'Floccus-' + Math.random(),
      ...CREDENTIALS,
    },
  ]

  return {
    SERVER,
    CREDENTIALS,
    ACCOUNTS,
    APP_VERSION,
    BROWSER,
    IS_CI,
    TEST_URL,
    RANDOM_MANIPULATION_ITERATIONS,
  }
}

Logger.persist = () => Promise.resolve()
export const DUMP_LOGS = function(currentTest) {
  // Dump logs if test failed
  if (getEnv().IS_CI && currentTest && currentTest.isFailed()) {
    for (const log of Logger.messages) {
      console.log(log)
    }
    Logger.messages = []
  }
}

chai.use(chaiAsPromised)
export const expect = chai.expect

export const expectTreeEqual = function(
  tree1,
  tree2,
  ignoreEmptyFolders,
  checkOrder = true
) {
  expectTreeEqualRec(tree1, tree2, 0, ignoreEmptyFolders, checkOrder)
}

let expectTreeEqualRec = function (
  tree1,
  tree2,
  recDepth,
  ignoreEmptyFolders,
  checkOrder
) {
  try {
    expect(tree1.title).to.equal(tree2.title)
    if (tree2.url) {
      expect(tree1.url).to.equal(tree2.url)
    } else {
      if (checkOrder === false) {
        tree2.children.sort((a, b) => {
          if (a.title < b.title) return -1
          if (a.title > b.title) return 1
          if ((a.url || '') < (b.url || '')) return -1
          if ((a.url || '') > (b.url || '')) return 1
          return 0
        })
        tree1.children.sort((a, b) => {
          if (a.title < b.title) return -1
          if (a.title > b.title) return 1
          if ((a.url || '') < (b.url || '')) return -1
          if ((a.url || '') > (b.url || '')) return 1
          return 0
        })
      }
      let children1 = ignoreEmptyFolders
        ? tree1.children.filter((child) => !hasNoBookmarks(child))
        : tree1.children
      let children2 = ignoreEmptyFolders
        ? tree2.children.filter((child) => !hasNoBookmarks(child))
        : tree2.children
      expect(children1).to.have.length(children2.length)
      children2.forEach((child2, i) => {
        expectTreeEqualRec(
          children1[i],
          child2,
          recDepth + 1,
          ignoreEmptyFolders,
          checkOrder
        )
      })
    }
  } catch (e) {
    console.log(
      `Trees are not equal: (recDepth: ${recDepth}, checkOrder: ${checkOrder}, ignoreEmptyFolders: ${ignoreEmptyFolders})\n`,
      'Tree 1:\n' + tree1.inspect(0) + '\n',
      'Tree 2:\n' + tree2.inspect(0)
    )
    throw e
  }
}

export function hasNoBookmarks(child) {
  if (child instanceof Bookmark) return false
  else return !child.children.some((child) => !hasNoBookmarks(child))
}

export async function getAllBookmarks(account) {
  let tree
  await withSyncConnection(account, async () => {
    tree = await account.server.getBookmarksTree(true)
  })
  return tree
}

export async function withSyncConnection(account, fn) {
  const adapter = account.server
  if (adapter.onSyncStart) await adapter.onSyncStart()
  const capabilities = await adapter.getCapabilities()
  if (adapter.setHashSettings)
    adapter.setHashSettings({
      preserveOrder: capabilities.preserveOrder,
      hashFn: capabilities.hashFn[0],
    })
  await fn()
  if (adapter.onSyncComplete) await adapter.onSyncComplete()
}

export async function randomlyManipulateTree(account, folders, bookmarks, iterations) {
  for (let i = 0; i < iterations; i++) {
    let magicBookmark
    let magicFolder1
    let magicFolder2
    let magicFolder3
    let magicFolder4
    let magicFolder5
    try {
      // Randomly move one bookmark
      magicBookmark = bookmarks[random.int(0, bookmarks.length - 1)]
      magicFolder1 = folders[random.int(0, folders.length - 1)]
      await browser.bookmarks.move(magicBookmark.id, {
        parentId: magicFolder1.id,
      })
      console.log('Move ' + magicBookmark.title + ' to ' + magicFolder1.id)

      // Randomly move two folders
      magicFolder2 = folders[random.int(0, folders.length - 1)]
      magicFolder3 = folders[random.int(0, folders.length - 1)]
      if (magicFolder2 === magicFolder3) {
        continue
      }
      const tree2 = (await browser.bookmarks.getSubTree(magicFolder2.id))[0]
      const root = (
        await browser.bookmarks.getSubTree(account.getData().localRoot)
      )[0]
      if (Folder.hydrate(tree2).findFolder(magicFolder3.id)) {
        continue
      }
      if (!Folder.hydrate(root).findFolder(magicFolder3.id)) {
        // This folder is not in our tree anymore for some reason
        continue
      }
      await browser.bookmarks.move(magicFolder2.id, {
        parentId: magicFolder3.id,
      })
      console.log(
        'Move #' +
          magicFolder2.id +
          '[' +
          magicFolder2.title +
          '] to ' +
          magicFolder3.id
      )

      // Randomly create a folder
      magicFolder4 = folders[random.int(0, folders.length - 1)]
      const newFolder = await browser.bookmarks.create({
        title: 'newFolder' + Math.random(),
        parentId: magicFolder4.id,
      })
      folders.push(newFolder)
      console.log(
        'Created #' +
          newFolder.id +
          '[' +
          newFolder.title +
          '] in ' +
          magicFolder4.id
      )

      magicFolder5 = folders[random.int(0, folders.length - 1)]
      const newBookmark = await browser.bookmarks.create({
        title: 'newBookmark' + Math.random(),
        url: 'http://ur.l/' + magicFolder5.id + '/' + Math.random(),
        parentId: magicFolder5.id,
      })
      bookmarks.push(newBookmark)
      console.log(
        'Created #' +
          newBookmark.id +
          '[' +
          newBookmark.title +
          '] in ' +
          magicFolder5.id
      )
    } catch (e) {
      console.log(e)
    }
  }
}

export async function randomlyManipulateTreeWithDeletions(
  account,
  folders,
  bookmarks,
  iterations
) {
  for (let i = 0; i < iterations; i++) {
    let magicBookmark
    let magicFolder1
    let magicFolder2
    let magicFolder3
    let magicFolder4
    let magicFolder5
    try {
      // Randomly remove one bookmark
      magicBookmark = bookmarks[random.int(0, bookmarks.length - 1)]
      await browser.bookmarks.remove(magicBookmark.id)
      bookmarks.splice(bookmarks.indexOf(magicBookmark), 1)
      console.log('Remove ' + magicBookmark.title)

      // Randomly rename one bookmark
      magicBookmark = bookmarks[random.int(0, bookmarks.length - 1)]
      const newTitle = 'renamed' + Math.random()
      await browser.bookmarks.update(magicBookmark.id, { title: newTitle })
      console.log(
        'Rename #' +
          magicBookmark.id +
          '[' +
          magicBookmark.title +
          '] to ' +
          newTitle
      )

      // randomly remove one folder
      magicFolder1 = folders[random.int(0, folders.length - 1)]
      await browser.bookmarks.removeTree(magicFolder1.id)
      folders.splice(folders.indexOf(magicFolder1), 1)
      console.log(
        'Removed #' + magicFolder1.id + '[' + magicFolder1.title + ']'
      )

      // Randomly move one bookmark
      magicBookmark = bookmarks[random.int(0, bookmarks.length - 1)]
      magicFolder1 = folders[random.int(0, folders.length - 1)]
      await browser.bookmarks.move(magicBookmark.id, {
        parentId: magicFolder1.id,
      })
      console.log('Move ' + magicBookmark.title + ' to ' + magicFolder1.id)

      // Randomly move two folders
      magicFolder2 = folders[random.int(0, folders.length - 1)]
      magicFolder3 = folders[random.int(0, folders.length - 1)]
      if (magicFolder2 === magicFolder3) {
        continue
      }
      const tree2 = (await browser.bookmarks.getSubTree(magicFolder2.id))[0]
      const root = (
        await browser.bookmarks.getSubTree(account.getData().localRoot)
      )[0]
      if (Folder.hydrate(tree2).findFolder(magicFolder3.id)) {
        continue
      }
      if (!Folder.hydrate(root).findFolder(magicFolder3.id)) {
        // This folder is not in our tree anymore for some reason
        continue
      }
      await browser.bookmarks.move(magicFolder2.id, {
        parentId: magicFolder3.id,
      })
      console.log(
        'Move #' +
          magicFolder2.id +
          '[' +
          magicFolder2.title +
          '] to ' +
          magicFolder3.id
      )

      // Randomly create a folder
      magicFolder4 = folders[random.int(0, folders.length - 1)]
      const newFolder = await browser.bookmarks.create({
        title: 'newFolder' + Math.random(),
        parentId: magicFolder4.id,
      })
      folders.push(newFolder)
      console.log(
        'Created #' +
          newFolder.id +
          '[' +
          newFolder.title +
          '] in ' +
          magicFolder4.id
      )

      // Randomly create a bookmark
      magicFolder5 = folders[random.int(0, folders.length - 1)]
      const newBookmark = await browser.bookmarks.create({
        title: 'newBookmark' + Math.random(),
        url: 'http://ur.l/' + magicFolder5.id + '/' + Math.random(),
        parentId: magicFolder5.id,
      })
      bookmarks.push(newBookmark)
      console.log(
        'Created #' +
          newBookmark.id +
          '[' +
          newBookmark.title +
          '] in ' +
          magicFolder5.id
      )
    } catch (e) {
      console.log(e)
    }
  }
}

export async function syncAccountWithInterrupts(account) {
  await account.sync()
  try {
    expect(account.getData().error).to.not.be.ok
  } catch (e) {
    if (
      !account.getData().error.includes('E026') &&
      !account.getData().error.includes('E027')
    ) {
      throw e
    } else {
      console.log(account.getData().error)
      account.lockTimeout = 0
      await syncAccountWithInterrupts(account)
    }
  }
}

export function stringifyAccountData(ACCOUNT_DATA) {
  return `${ACCOUNT_DATA.type}${
    (ACCOUNT_DATA.noCache ? '-noCache' : '') +
    (typeof ACCOUNT_DATA.bookmark_file_type !== 'undefined'
      ? '-' + ACCOUNT_DATA.bookmark_file_type
      : '') +
    ((ACCOUNT_DATA.type === 'google-drive' && ACCOUNT_DATA.password) ||
    (ACCOUNT_DATA.type === 'dropbox' && ACCOUNT_DATA.password) ||
    (ACCOUNT_DATA.type === 'webdav' && ACCOUNT_DATA.passphrase)
      ? '-encrypted'
      : '')
  }`
}

export function awaitTabsUpdated() {
  return Promise.race([
    new Promise((resolve) => {
      browser.tabs.onUpdated.addListener(function listener() {
        browser.tabs.onUpdated.removeListener(listener)
        setTimeout(() => resolve(), 1000)
      })
    }),
    new Promise((resolve) => setTimeout(resolve, 1300)),
  ])
}

export function filterBookmarksInTree(tree, fn) {
  tree.children = tree.children.filter((item) => {
    if (item instanceof Bookmark) return fn(item)
    else {
      filterBookmarksInTree(item, fn)
      return true
    }
  })
  return tree
}
