/* global IS_BROWSER */
import chai from 'chai'
import chaiAsPromised from 'chai-as-promised'
import { Bookmark, Folder } from '../lib/Tree'
import Logger from '../lib/Logger'
import FakeAdapter from '../lib/adapters/Fake'
import random from 'random'
import seedrandom from 'seedrandom'
import FakeNcBookmarksAdapter from '../lib/adapters/FakeNcBookmarks'

const DEFAULT_SEED = Math.random() + ''

function getSearchParams() {
  if (typeof window !== 'undefined' && window.location?.href) {
    return new URL(window.location.href).searchParams
  }
  return new URLSearchParams()
}

function getProcessEnv(name) {
  if (typeof process === 'undefined' || !process?.env) {
    return undefined
  }
  return process.env[name]
}

function filterAccounts(accounts, selector) {
  if (!selector) {
    return accounts
  }

  const selectors = selector
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)

  const filteredAccounts = accounts.filter((account) =>
    selectors.some((selector) => stringifyAccountData(account) === selector)
  )

  if (!filteredAccounts.length) {
    throw new Error(
      `No test accounts matched FLOCCUS_TEST_ACCOUNTS/accounts filter: ${selector}`
    )
  }

  return filteredAccounts
}

export function getEnv() {
  const params = getSearchParams()
  let SERVER,
    CREDENTIALS,
    ACCOUNTS,
    APP_VERSION,
    SEED,
    BROWSER,
    RANDOM_MANIPULATION_ITERATIONS,
    TEST_URL,
    IS_CI,
    ACCOUNT_FILTER
  SERVER =
    params.get('server') ||
    getProcessEnv('TEST_SERVER') ||
    (getProcessEnv('TEST_HOST') ? `http://${getProcessEnv('TEST_HOST')}` : null) ||
    'http://localhost'
  TEST_URL = params.get('test_url') || getProcessEnv('TEST_URL') || 'https://example.org/'
  CREDENTIALS = {
    username: params.get('username') || getProcessEnv('TEST_USERNAME') || 'admin',
    password: params.get('password') || getProcessEnv('TEST_PASSWORD') || 'admin',
  }
  APP_VERSION = params.get('app_version') || getProcessEnv('APP_VERSION') || 'stable'
  BROWSER =
    params.get('browser') ||
    getProcessEnv('SELENIUM_BROWSER') ||
    getProcessEnv('FLOCCUS_TEST_BROWSER') ||
    (typeof process !== 'undefined' ? 'node' : 'firefox')
  IS_CI = params.get('ci') === 'true' || getProcessEnv('CI') === 'true'
  ACCOUNT_FILTER = params.get('accounts') || getProcessEnv('FLOCCUS_TEST_ACCOUNTS')

  SEED =
    params.get('seed') || getProcessEnv('FLOCCUS_TEST_SEED') || DEFAULT_SEED
  console.log('RANDOMNESS SEED', SEED)

  // needed for credentials below
  random.use(seedrandom(SEED))

  RANDOM_MANIPULATION_ITERATIONS = 35

  ACCOUNTS = filterAccounts([
    FakeAdapter.getDefaultValues(),
    FakeNcBookmarksAdapter.getDefaultValues(),
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
  ], ACCOUNT_FILTER)

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
  }
  Logger.messages = []
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

let expectTreeEqualRec = function(
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
        console.log(tree2)
        console.log(tree2.children)
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
  await withSyncConnection(account, async() => {
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
    await randomTreeManipulation(account, folders, bookmarks)
  }
}

function pickRandomItem(items) {
  if (!items.length) {
    return null
  }
  return items[random.int(0, items.length - 1)]
}

async function randomTreeManipulation(account, folders, bookmarks) {
  const localResource = await account.getResource()
  const root = await localResource.getBookmarksTree(true)
  let magicBookmark
  let magicFolder1
  let magicFolder2
  let magicFolder3
  let magicFolder4
  let magicFolder5
  try {
    if (!bookmarks.length || !folders.length) {
      return
    }

    // Randomly move one bookmark
    magicBookmark = pickRandomItem(bookmarks)
    magicFolder1 = pickRandomItem(folders)
    await localResource.updateBookmark(new Bookmark({
      ...magicBookmark,
      parentId: magicFolder1.id,
    }))
    magicBookmark.parentId = magicFolder1.id
    console.log('Move ' + magicBookmark.title + ' to ' + magicFolder1.id)

    // Randomly move two folders
    magicFolder2 = pickRandomItem(folders)
    magicFolder3 = pickRandomItem(folders)
    if (magicFolder2 === magicFolder3) {
      return
    }
    const tree2 = root.findFolder(magicFolder2.id)
    if (!tree2) {
      return
    }
    const targetFolder = root.findFolder(magicFolder3.id)

    if (tree2.findFolder(magicFolder3.id)) {
      return
    }
    if (!targetFolder) {
      // This folder is not in our tree anymore for some reason
      return
    }
    await localResource.updateFolder(
      new Folder({
        ...magicFolder2,
        parentId: magicFolder3.id,
      })
    )
    magicFolder2.parentId = magicFolder3.id
    console.log(
      'Move #' +
      magicFolder2.id +
      '[' +
      magicFolder2.title +
      '] to ' +
      magicFolder3.id
    )

    // Randomly create a folder
    magicFolder4 = pickRandomItem(folders)
    let newFolder, newFolderId
    newFolderId = await localResource.createFolder(
      newFolder = new Folder({
        title: 'newFolder' + Math.random(),
        parentId: magicFolder4.id,
      })
    )
    newFolder.id = newFolderId
    folders.push(newFolder)
    console.log(
      'Created #' +
      newFolder.id +
      '[' +
      newFolder.title +
      '] in ' +
      magicFolder4.id
    )

    magicFolder5 = pickRandomItem(folders)
    let newBookmark, newBookmarkId
    newBookmarkId = await localResource.createBookmark(
      (newBookmark = new Bookmark({
        title: 'newBookmark' + Math.random(),
        url: 'http://ur.l/' + magicFolder5.id + '/' + Math.random(),
        parentId: magicFolder5.id,
      }))
    )
    newBookmark.id = newBookmarkId
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

async function randomTreeManipulationWithDeletion(account, folders, bookmarks) {
  const localResource = await account.getResource()
  let magicBookmark
  let magicFolder1
  let magicFolder2
  let magicFolder3
  let magicFolder4
  let magicFolder5
  try {
    if (!bookmarks.length || !folders.length) {
      return
    }

    // Randomly remove one bookmark
    magicBookmark = pickRandomItem(bookmarks)
    await localResource.removeBookmark(magicBookmark)
    bookmarks.splice(bookmarks.indexOf(magicBookmark), 1)
    console.log('Remove ' + magicBookmark.title)

    if (!bookmarks.length || !folders.length) {
      return
    }

    // Randomly rename one bookmark
    magicBookmark = pickRandomItem(bookmarks)
    const newTitle = 'renamed' + Math.random()
    await localResource.updateBookmark(new Bookmark({
      ...magicBookmark,
      title: newTitle,
    }))
    magicBookmark.title = newTitle
    console.log(
      'Rename #' +
      magicBookmark.id +
      '[' +
      magicBookmark.title +
      '] to ' +
      newTitle
    )

    // randomly remove one folder
    magicFolder1 = pickRandomItem(folders)
    await localResource.removeFolder(magicFolder1)
    console.log(
      'Removed #' + magicFolder1.id + '[' + magicFolder1.title + ']'
    )

    if (!bookmarks.length || !folders.length) {
      return
    }

    // Randomly move one bookmark
    magicBookmark = pickRandomItem(bookmarks)
    magicFolder1 = pickRandomItem(folders)
    await localResource.updateBookmark(new Bookmark({
      ...magicBookmark,
      parentId: magicFolder1.id,
    }))
    magicBookmark.parentId = magicFolder1.id
    console.log('Move ' + magicBookmark.title + ' to ' + magicFolder1.id)

    // Randomly move two folders
    magicFolder2 = pickRandomItem(folders)
    magicFolder3 = pickRandomItem(folders)
    if (magicFolder2 === magicFolder3) {
      return
    }
    const root = await localResource.getBookmarksTree(true)
    const tree2 = root.findFolder(magicFolder2.id)
    if (!tree2) {
      return
    }
    if (tree2.findFolder(magicFolder3.id)) {
      return
    }
    const targetFolder = root.findFolder(magicFolder3.id)
    if (!targetFolder) {
      // This folder is not in our tree anymore for some reason
      return
    }
    await localResource.updateFolder(new Folder({
      ...magicFolder2,
      parentId: magicFolder3.id,
    }))
    magicFolder2.parentId = magicFolder3.id
    console.log(
      'Move #' +
      magicFolder2.id +
      '[' +
      magicFolder2.title +
      '] to ' +
      magicFolder3.id
    )

    // Randomly create a folder
    magicFolder4 = pickRandomItem(folders)
    let newFolder, newFolderId
    newFolderId = await localResource.createFolder(
      (newFolder = new Folder({
        title: 'newFolder' + Math.random(),
        parentId: magicFolder4.id,
      }))
    )
    newFolder.id = newFolderId
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
    magicFolder5 = pickRandomItem(folders)
    let newBookmark, newBookmarkId
    newBookmarkId = await localResource.createBookmark(
      (newBookmark = new Bookmark({
        title: 'newBookmark' + Math.random(),
        url: 'http://ur.l/' + magicFolder5.id + '/' + Math.random(),
        parentId: magicFolder5.id,
      }))
    )
    newBookmark.id = newBookmarkId
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

export async function randomlyManipulateTreeWithDeletions(
  account,
  folders,
  bookmarks,
  iterations
) {
  for (let i = 0; i < iterations; i++) {
    await randomTreeManipulationWithDeletion(account, folders, bookmarks)
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

export async function awaitTabsUpdated() {
  const {default: browser} = await import('../lib/browser-api.js')
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

export async function clearLocalResource(account) {
  const resource = await account.getResource()
  try {
    const tree = await resource.getBookmarksTree(true)
    for (const child of [...tree.children]) {
      try {
        if (child instanceof Folder) {
          await resource.removeFolder(child)
        } else {
          await resource.removeBookmark(child)
        }
      } catch (e) {
        console.log(e)
      }
    }
    if (IS_BROWSER) {
      try {
        await resource.removeFolder(tree)
      } catch (e) {
        console.log(e)
      }
    }
  } catch (e) {
    console.log(e)
  }
}