import browser from './browser-api'
import Logger from './Logger'
import { ICapabilities, IHashSettings, OrderFolderResource } from './interfaces/Resource'
import PQueue from 'p-queue'
import { Bookmark, Folder, ItemLocation } from './Tree'
import Ordering from './interfaces/Ordering'
import uniq from 'lodash/uniq'

export default class LocalTabs implements OrderFolderResource<typeof ItemLocation.LOCAL> {
  private queue: PQueue<{ concurrency: 10 }>
  private storage: unknown

  constructor(storage:unknown) {
    this.storage = storage
    this.queue = new PQueue({ concurrency: 10 })
  }

  async getBookmarksTree():Promise<Folder<typeof ItemLocation.LOCAL>> {
    let tabs = await browser.tabs.query({
      windowType: 'normal' // no devtools or panels or popups
    })
    tabs = tabs.filter(tab => !tab.incognito)

    // Get all tab groups
    let tabGroups = []
    try {
      tabGroups = await browser.tabGroups.query({})
    } catch (e) {
      Logger.log('Tab groups not supported', e)
    }

    return new Folder({
      title: '',
      id: 'tabs',
      location: ItemLocation.LOCAL,
      children: await Promise.all(uniq(tabs.map(t => t.windowId)).map(async(windowId, i) => {
        const windowTabs = tabs.filter(t => t.windowId === windowId)

        // Get tab groups for this window
        const windowTabGroups = tabGroups.filter(g => g.windowId === windowId)

        // Get tabs that are not in any group
        const ungroupedTabs = windowTabs.filter(t => !t.groupId || t.groupId === -1)
          .sort((t1, t2) => t1.index - t2.index)
          .map(t => new Bookmark({
            id: t.id,
            title: t.title,
            url: t.url,
            parentId: windowId,
            location: ItemLocation.LOCAL,
          }))

        // Create folders for each tab group
        const groupFolders = await Promise.all(windowTabGroups.map(async group => {
          const groupTabs = (
            await browser.tabs.query({
              windowType: 'normal', // no devtools or panels or popups
              groupId: group.id
            })
          )
            .sort((t1, t2) => t1.index - t2.index)
            .map(t => new Bookmark({
              id: t.id,
              title: t.title,
              url: t.url,
              parentId: group.id,
              location: ItemLocation.LOCAL,
            }))

          // Store the minimum index of tabs in this group to use for sorting
          // If the group has no tabs (which shouldn't happen in practice, but handling for robustness),
          // use a high index value so it appears at the end
          const minTabIndex = groupTabs.length > 0
            ? Math.min(...groupTabs.map(t => windowTabs.find(tab => tab.id === t.id).index))
            : Number.MAX_SAFE_INTEGER

          return {
            folder: new Folder({
              title: group.title || `Group ${group.id}`,
              id: group.id,
              parentId: windowId,
              location: ItemLocation.LOCAL,
              children: groupTabs
            }),
            index: minTabIndex // Use the minimum index of tabs in the group for sorting
          }
        }))

        // Create a combined array of ungrouped tabs and group folders
        const combinedItems = [
          // Map ungrouped tabs to objects with the tab and its index
          ...ungroupedTabs.map(tab => ({
            item: tab,
            index: windowTabs.find(t => t.id === tab.id).index,
            isTab: true
          })),
          // Map group folders to objects with the folder and its index
          ...groupFolders.map(({ folder, index }) => ({
            item: folder,
            index,
            isTab: false
          }))
        ]

        // Sort the combined items by their index
        combinedItems.sort((a, b) => a.index - b.index)

        // Extract the sorted items
        const sortedItems = combinedItems.map(item => item.item)

        return new Folder({
          title: 'Window ' + i,
          id: windowId,
          parentId: 'tabs',
          location: ItemLocation.LOCAL,
          children: sortedItems
        })
      }))
    })
  }

  async createBookmark(bookmark:Bookmark<typeof ItemLocation.LOCAL>): Promise<string|number> {
    Logger.log('(tabs)CREATE', bookmark)
    if (bookmark.parentId === 'tabs') {
      Logger.log('Parent is "tabs", ignoring this one.')
      return
    }
    if (self.location.protocol === 'moz-extension:' && new URL(bookmark.url).protocol === 'file:') {
      Logger.log('URL is a file URL and we are on firefox, ignoring this one.')
      return
    }

    try {
      // Check if the parentId is a tab group by trying to get it
      let isTabGroup = false
      let windowId = null
      try {
        // Try to query the tab group to see if it exists
        if (typeof browser.tabGroups !== 'undefined') {
          const tabGroup = await this.queue.add(() =>
            browser.tabGroups.get(bookmark.parentId)
          )
          if (tabGroup) {
            isTabGroup = true
            windowId = tabGroup.windowId
            Logger.log('Parent is a tab group', tabGroup)
          }
        }
      } catch (e) {
        // If we get an error, it's not a tab group
        Logger.log('Parent is not a tab group', e)
        isTabGroup = false
      }

      // If it's not a tab group, use the parentId as the windowId
      if (!isTabGroup) {
        windowId = typeof bookmark.parentId === 'string' ? parseInt(bookmark.parentId) : bookmark.parentId
      }

      // Create the tab in the appropriate window
      const node = await this.queue.add(() =>
        browser.tabs.create({
          windowId: windowId,
          url: bookmark.url,
          // Only firefox allows discarded prop
          ...(typeof browser.BookmarkTreeNodeType !== 'undefined' && { discarded: true }),
          active: false,
        })
      )

      // If it's a tab group, move the tab to the group
      if (isTabGroup) {
        Logger.log('Moving new tab to tab group', bookmark.parentId)
        await this.queue.add(() =>
          browser.tabs.group({
            tabIds: [node.id],
            groupId: bookmark.parentId
          })
        )
      }

      await awaitTabsUpdated()
      return node.id
    } catch (e) {
      Logger.log('Failed to create tab', e)
      // Don't throw error if the tab group doesn't exist anymore
      if (e.message && !e.message.includes('No tab group with id') &&
          !e.message.includes('Invalid tab group id')) {
        throw e
      }
      // If the tab group doesn't exist, return null
      return null
    }
  }

  async updateBookmark(bookmark:Bookmark<typeof ItemLocation.LOCAL>):Promise<void> {
    Logger.log('(tabs)UPDATE', bookmark)
    if (bookmark.parentId === 'tabs') {
      Logger.log('Parent is "tabs", ignoring this one.')
      return
    }

    // Update the tab's URL
    await this.queue.add(() =>
      browser.tabs.update(bookmark.id, {
        url: bookmark.url
      })
    )

    try {
      // Check if the parentId is a tab group by trying to get it
      let isTabGroup = false
      try {
        // Try to query the tab group to see if it exists
        if (typeof browser.tabGroups !== 'undefined') {
          const tabGroup = await this.queue.add(() =>
            browser.tabGroups.get(bookmark.parentId)
          )
          isTabGroup = !!tabGroup
        }
      } catch (e) {
        // If we get an error, it's not a tab group
        Logger.log('Parent is not a tab group', e)
        isTabGroup = false
      }

      if (isTabGroup) {
        // If it's a tab group, use tabs.group to move the tab to the group
        Logger.log('Moving tab to tab group', bookmark.parentId)
        await this.queue.add(() =>
          browser.tabs.group({
            tabIds: [bookmark.id],
            groupId: bookmark.parentId
          })
        )
      } else {
        if (typeof browser.tabGroups !== 'undefined') {
          // Move tab out of any groups
          Logger.log('Moving tab out of any tab group', bookmark.id)
          await this.queue.add(() =>
            browser.tabs.ungroup([bookmark.id])
          )
        }
        // If it's a window, use tabs.move
        Logger.log('Moving tab to window', bookmark.parentId)
        await this.queue.add(() =>
          browser.tabs.move(bookmark.id, {
            windowId: bookmark.parentId,
            index: -1, // last
          })
        )
      }
    } catch (e) {
      Logger.log('Failed to move tab', e)
      // Don't throw error if the tab group doesn't exist anymore
      if (e.message && !e.message.includes('No tab group with id') &&
          !e.message.includes('Invalid tab group id')) {
        throw e
      }
    }

    await awaitTabsUpdated()
  }

  async removeBookmark(bookmark:Bookmark<typeof ItemLocation.LOCAL>): Promise<void> {
    const bookmarkId = bookmark.id
    Logger.log('(tabs)REMOVE', bookmark)
    if (bookmark.parentId === 'tabs') {
      Logger.log('Parent is "tabs", ignoring this one.')
      return
    }
    await this.queue.add(() => browser.tabs.remove(bookmarkId))
    await awaitTabsUpdated()
  }

  async createFolder(folder:Folder<typeof ItemLocation.LOCAL>): Promise<number> {
    Logger.log('(tabs)CREATEFOLDER', folder)

    // If parentId is 'tabs', create a window
    if (folder.parentId === 'tabs') {
      const node = await this.queue.add(() =>
        browser.windows.create()
      )
      return node.id
    } else {
      // Otherwise, create a tab group
      try {
        // Create a dummy tab in the parent window to hold the group
        const dummyTab = await this.queue.add(() =>
          browser.tabs.create({
            windowId: folder.parentId,
            url: 'about:blank',
            active: false
          })
        )

        // Create a tab group with the dummy tab
        const groupId = await this.queue.add(() =>
          browser.tabs.group({
            tabIds: [dummyTab.id],
            createProperties: {
              windowId: folder.parentId
            }
          })
        )

        // Update the tab group title
        if (folder.title) {
          await this.queue.add(() =>
            browser.tabGroups.update(groupId, {
              title: folder.title
            })
          )
        }

        // Remove the dummy tab after a timeout
        setTimeout(async() => {
          try {
            await browser.tabs.remove(dummyTab.id)
          } catch (e) {
            Logger.log('Failed to remove dummy tab', e)
          }
        }, 2000)

        await awaitTabsUpdated()
        return groupId
      } catch (e) {
        Logger.log('Failed to create tab group', e)
        throw e
      }
    }
  }

  async orderFolder(id:string|number, order:Ordering<typeof ItemLocation.LOCAL>):Promise<void> {
    Logger.log('(tabs)ORDERFOLDER', { id, order })
    try {
      // Check if tab groups are supported
      const tabGroupsSupported = typeof browser.tabGroups !== 'undefined'

      // Determine if the folder to order is a tab group or a window
      let isTabGroup = false
      let tabGroupIndex = 0

      if (tabGroupsSupported && id !== 'tabs') {
        try {
          // Try to get the tab group to see if it exists
          const tabs = await this.queue.add(() => browser.tabs.query({groupId: id}))
          if (tabs.length) {
            isTabGroup = true
            // Get the tab group's current index
            tabGroupIndex = tabs.sort((a, b) => a.index - b.index)[0].index
            Logger.log('Ordering a tab group with index', tabGroupIndex)
          }
        } catch (e) {
          // If we get an error, it's not a tab group
          Logger.log('Not a tab group', e)
          isTabGroup = false
        }
      }

      try {
        if (isTabGroup) {
          // If it's a tab group, add the tab group's index as an offset to all child tabs
          Logger.log('Ordering tabs within a tab group, adding offset', tabGroupIndex)
          for (let index = 0; index < order.length; index++) {
            const item = order[index]
            // For tab groups, all items should be tabs (bookmarks)
            if (item.type !== 'folder') {
              // It's a tab, use browser.tabs.move with the tab group's index as an offset
              const adjustedIndex = tabGroupIndex + index
              Logger.log('Moving tab', item.id, 'to index', adjustedIndex)
              await this.queue.add(() =>
                browser.tabs.move(item.id, { index: adjustedIndex })
              )
            } else {
              // tab groups inside tab groups do not exist (yet)
              // noop
            }
          }
        } else {
          // Process folders first
          let currentIndex = 0
          for (let i = 0; i < order.length; i++) {
            if (order[i].type === 'folder') {
              const folder = order[i]
              Logger.log('Moving tab group', folder.id, 'to index', currentIndex)
              try {
                if (tabGroupsSupported) {
                  await this.queue.add(() =>
                    browser.tabGroups.move(folder.id, { index: currentIndex })
                  )

                  // Get the size of the folder (number of tabs in the group)
                  const folderTabs = await this.queue.add(() =>
                    browser.tabs.query({
                      windowType: 'normal',
                      groupId: folder.id
                    })
                  )

                  // Increment the current index by the size of the folder
                  currentIndex += folderTabs.length
                }
              } catch (e) {
                Logger.log('Failed to move tab group', e)
                // Don't throw error if the tab group doesn't exist anymore
                if (e.message && !e.message.includes('No tab group with id') &&
                    !e.message.includes('Invalid tab group id')) {
                  throw e
                }
              }
            } else {
              const bookmark = order[i]
              Logger.log('Moving tab', bookmark.id, 'to index', currentIndex)
              await this.queue.add(() =>
                browser.tabs.move(bookmark.id, { index: currentIndex })
              )
              currentIndex += 1
            }
          }
        }
      } catch (e) {
        throw new Error('Failed to reorder folder ' + id + ': ' + e.message)
      }
    } catch (e) {
      throw new Error('Failed to reorder folder ' + id + ': ' + e.message)
    }
    await awaitTabsUpdated()
  }

  async updateFolder(folder:Folder<typeof ItemLocation.LOCAL>):Promise<void> {
    Logger.log('(tabs)UPDATEFOLDER', folder)

    // If parentId is not 'tabs', it's a tab group
    if (folder.parentId !== 'tabs') {
      try {
        // Update the tab group title
        await this.queue.add(() =>
          browser.tabGroups.update(folder.id, {
            title: folder.title
          })
        )
      } catch (e) {
        Logger.log('Failed to update tab group', e)
        // Don't throw error if the tab group doesn't exist anymore
        if (e.message && !e.message.includes('No tab group with id')) {
          throw e
        }
      }
    }
    // Otherwise it's a window, which we don't need to update
  }

  async removeFolder(folder:Folder<typeof ItemLocation.LOCAL>):Promise<void> {
    const id = folder.id
    Logger.log('(tabs)REMOVEFOLDER', id)

    // If parentId is 'tabs', it's a window
    if (folder.parentId === 'tabs') {
      try {
        await this.queue.add(() => browser.windows.remove(id))
      } catch (e) {
        Logger.log('Failed to remove window', e)
        // Don't throw error if the window doesn't exist anymore
        if (e.message && !e.message.includes('No window with id')) {
          throw e
        }
      }
    } else {
      // Otherwise, it's a tab group
      try {
        // Get all tabs in the group
        const tabs = await this.queue.add(() =>
          browser.tabs.query({
            groupId: id
          })
        )

        // Remove all tabs in the group
        if (tabs.length > 0) {
          await this.queue.add(() => browser.tabs.remove(tabs.map(t => t.id)))
        }

        // The tab group will be automatically removed when all its tabs are removed
      } catch (e) {
        Logger.log('Failed to remove tab group', e)
        // Don't throw error if the tab group doesn't exist anymore
        if (e.message && !e.message.includes('No tab group with id') && !e.message.includes('No tab with id')) {
          throw e
        }
      }
    }
  }

  async isAvailable(): Promise<boolean> {
    const tabs = await browser.tabs.query({
      windowType: 'normal' // no devtools or panels or popups
    })
    return Boolean(tabs.length)
  }

  async isUsingBrowserTabs() {
    return true
  }

  async getCapabilities(): Promise<ICapabilities> {
    return {
      preserveOrder: true,
      hashFn: ['xxhash3', 'murmur3', 'sha256']
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  setHashSettings(hashSettings: IHashSettings): void {
    // noop
  }
}

function awaitTabsUpdated() {
  return Promise.race([
    new Promise<void>(resolve => {
      browser.tabs.onUpdated.addListener(function listener() {
        browser.tabs.onUpdated.removeListener(listener)
        setTimeout(() => resolve(), 100)
      })
    }),
    new Promise(resolve => setTimeout(resolve, 300))
  ])
}
