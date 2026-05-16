import Account from '../../lib/Account'
import { Bookmark, Folder, ItemLocation, ItemType } from '../../lib/Tree'

function serializeItem(item) {
  const node = {
    id: item.id,
    parentId: item.parentId,
    title: item.title,
    type: item.type,
  }

  if (item.type === ItemType.BOOKMARK) {
    node.url = item.url
    return node
  }

  node.children = item.children.map(serializeItem)
  return node
}

async function getNativeBookmarkAccounts() {
  const accountClass = await Account.getAccountClass()
  const accounts = await accountClass.getAllAccounts()
  return accounts.filter(account => account.getData().localRoot && account.getData().localRoot !== 'tabs')
}

async function resolveFolder(id) {
  for (const account of await getNativeBookmarkAccounts()) {
    const resource = await account.getResource()
    const tree = await resource.getBookmarksTree()
    const folder = tree.findFolder(id)
    if (folder) {
      return { account, resource, tree, folder }
    }
  }
  return null
}

async function resolveItem(id) {
  for (const account of await getNativeBookmarkAccounts()) {
    const resource = await account.getResource()
    const tree = await resource.getBookmarksTree()
    const bookmark = tree.findBookmark(id)
    if (bookmark) {
      return { account, resource, tree, item: bookmark }
    }
    const folder = tree.findFolder(id)
    if (folder) {
      return { account, resource, tree, item: folder }
    }
  }
  return null
}

async function orderChildren(resource, parentId, movedId, index) {
  if (typeof index !== 'number') {
    return
  }

  const tree = await resource.getBookmarksTree()
  const parent = tree.findFolder(parentId)
  if (!parent) {
    throw new Error('Unknown parent folder: ' + parentId)
  }

  const movedItem = parent.children.find(child => String(child.id) === String(movedId))
  if (!movedItem) {
    throw new Error('Unknown child item: ' + movedId)
  }

  const otherItems = parent.children.filter(child => String(child.id) !== String(movedId))
  otherItems.splice(index, 0, movedItem)

  await resource.orderFolder(parentId, otherItems.map(child => ({
    id: child.id,
    type: child.type,
  })))
}

async function clearFolder(resource, folder) {
  for (const child of [...folder.children].reverse()) {
    if (child.type === ItemType.FOLDER) {
      await clearFolder(resource, child)
      await resource.removeFolder(child)
    } else {
      await resource.removeBookmark(child)
    }
  }
}

function createUnsupportedApi(name) {
  return new Proxy({}, {
    get() {
      return () => {
        throw new Error(name + ' is not supported by the native test route')
      }
    }
  })
}

export function installNativeBrowserApi() {
  const root = typeof window !== 'undefined' ? window : self
  const browser = {
    bookmarks: {
      async create(details) {
        const resolvedParent = await resolveFolder(details.parentId)
        if (!resolvedParent) {
          throw new Error('Unknown parent folder: ' + details.parentId)
        }

        const { resource } = resolvedParent
        let id
        if (details.url || details.type === ItemType.BOOKMARK) {
          id = await resource.createBookmark(new Bookmark({
            id: null,
            parentId: details.parentId,
            title: details.title || '',
            url: details.url,
            location: ItemLocation.LOCAL,
          }))
        } else {
          id = await resource.createFolder(new Folder({
            id: null,
            parentId: details.parentId,
            title: details.title || '',
            location: ItemLocation.LOCAL,
          }))
        }

        await orderChildren(resource, details.parentId, id, details.index)

        const resolvedItem = await resolveItem(id)
        return serializeItem(resolvedItem.item)
      },

      async update(id, changes) {
        const resolvedItem = await resolveItem(id)
        if (!resolvedItem) {
          throw new Error('Unknown bookmark item: ' + id)
        }

        const { resource, item } = resolvedItem
        const parentId = changes.parentId || item.parentId

        if (item.type === ItemType.FOLDER) {
          await resource.updateFolder(new Folder({
            id: item.id,
            parentId,
            title: changes.title || item.title,
            children: item.children,
            location: ItemLocation.LOCAL,
          }))
        } else {
          await resource.updateBookmark(new Bookmark({
            id: item.id,
            parentId,
            title: changes.title || item.title,
            url: changes.url || item.url,
            location: ItemLocation.LOCAL,
          }))
        }

        const updatedItem = await resolveItem(id)
        return serializeItem(updatedItem.item)
      },

      async move(id, destination) {
        const resolvedItem = await resolveItem(id)
        if (!resolvedItem) {
          throw new Error('Unknown bookmark item: ' + id)
        }

        const { resource, item } = resolvedItem
        const parentId = destination.parentId || item.parentId

        if (item.type === ItemType.FOLDER) {
          await resource.updateFolder(new Folder({
            id: item.id,
            parentId,
            title: item.title,
            children: item.children,
            location: ItemLocation.LOCAL,
          }))
        } else {
          await resource.updateBookmark(new Bookmark({
            id: item.id,
            parentId,
            title: item.title,
            url: item.url,
            location: ItemLocation.LOCAL,
          }))
        }

        await orderChildren(resource, parentId, id, destination.index)

        const movedItem = await resolveItem(id)
        return serializeItem(movedItem.item)
      },

      async remove(id) {
        const resolvedItem = await resolveItem(id)
        if (!resolvedItem) {
          return
        }

        const { resource, item } = resolvedItem
        if (item.type === ItemType.FOLDER) {
          await clearFolder(resource, item)
          await resource.removeFolder(item)
        } else {
          await resource.removeBookmark(item)
        }
      },

      async removeTree(id) {
        const resolvedFolder = await resolveFolder(id)
        if (!resolvedFolder) {
          return
        }

        const { account, resource, folder } = resolvedFolder
        await clearFolder(resource, folder)

        if (String(account.getData().localRoot) !== String(id)) {
          await resource.removeFolder(folder)
        }
      },

      async get(id) {
        const resolvedItem = await resolveItem(id)
        if (!resolvedItem) {
          throw new Error('Unknown bookmark item: ' + id)
        }
        return [serializeItem(resolvedItem.item)]
      },

      async getChildren(id) {
        const resolvedFolder = await resolveFolder(id)
        if (!resolvedFolder) {
          throw new Error('Unknown folder: ' + id)
        }
        return resolvedFolder.folder.children.map(serializeItem)
      },

      async getSubTree(id) {
        const resolvedFolder = await resolveFolder(id)
        if (!resolvedFolder) {
          throw new Error('Unknown folder: ' + id)
        }
        return [serializeItem(resolvedFolder.folder)]
      },

      async getTree() {
        const accounts = await getNativeBookmarkAccounts()
        if (accounts.length === 1) {
          const resource = await accounts[0].getResource()
          return [serializeItem(await resource.getBookmarksTree())]
        }

        const children = []
        for (const account of accounts) {
          const resource = await account.getResource()
          children.push(serializeItem(await resource.getBookmarksTree()))
        }

        return [{
          id: 'native-root',
          title: 'root',
          type: ItemType.FOLDER,
          children,
        }]
      },
    },
    tabs: createUnsupportedApi('browser.tabs'),
    windows: createUnsupportedApi('browser.windows'),
  }

  Object.defineProperty(root, 'browser', {
    configurable: true,
    writable: true,
    value: browser,
  })

  return browser
}
