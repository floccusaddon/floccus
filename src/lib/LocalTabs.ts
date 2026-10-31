import browser from './browser-api'
import Logger from './Logger'
import { ICapabilities, IHashSettings, OrderFolderResource } from './interfaces/Resource'
import PQueue from 'p-queue'
import { Bookmark, Folder, ItemLocation } from './Tree'
import Ordering from './interfaces/Ordering'
import uniq from 'lodash/uniq'
import { UnsupportedItemError } from '../errors/Error'

export default class LocalTabs implements OrderFolderResource<typeof ItemLocation.LOCAL> {
  private queue: PQueue<{ concurrency: 10 }>
  private storage: unknown
  // A tab group can't exist without a tab, so createFolder() puts a blank tab
  // into each new group, which has to stay until the group's first real tab
  // arrives: Chromium deletes a group the moment its last tab is closed.
  // groupId -> placeholder tabIds
  private placeholderTabs: Map<number, number[]> = new Map()
  // Opera dissolves a group with fewer than two tabs, so there createFolder()
  // needs two placeholders and they may only go while the group keeps two tabs
  private minGroupSize = 1
  private flattenedFolderCount = 0

  // see https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/tabs/create#url
  public static URL_SCHEME_BLACKLIST = [
    'javascript:',
    'file:',
    'chrome:',
    'data:',
    'about:',
  ]

  constructor(storage: unknown) {
    this.storage = storage
    this.queue = new PQueue({ concurrency: 10 })
  }

  private isUnsupportedFirefoxUrl(url?: string): boolean {
    if (!url || self.location.protocol !== 'moz-extension:') return false
    try {
      return LocalTabs.URL_SCHEME_BLACKLIST.includes(new URL(url).protocol)
    } catch (e) {
      return false
    }
  }

  private static windowsSupported(): boolean {
    return typeof browser.windows !== 'undefined'
  }

  private static tabGroupsSupported(): boolean {
    return typeof browser.tabGroups !== 'undefined' &&
      typeof browser.tabs.group === 'function'
  }

  /**
   * A folder this browser has no API for -- a window on Firefox for Android,
   * a tab group where there are no tab groups -- is not created at all: its
   * id only lives on in the sync cache, and its tabs are opened wherever the
   * browser puts them. The next sync finds the folder gone and its tabs moved
   * out of it and passes that on, so the other devices' windows and groups end
   * up merged into what this browser has.
   */
  private createFlattenedFolder(folder: Folder<typeof ItemLocation.LOCAL>): string {
    Logger.log('This browser has no windows or tab groups to create this folder in, flattening it', folder)
    return 'flattened-' + Date.now() + '-' + (++this.flattenedFolderCount)
  }

  private isFlattenedFolder(folderId: string | number): boolean {
    return String(folderId).startsWith('flattened-')
  }

  private getWindowIdFromFolderId(folderId: string | number): number {
    return parseInt(String(folderId).slice('window-'.length))
  }

  private getTabGroupIdFromFolderId(folderId: string | number): number {
    return parseInt(String(folderId).slice('group-'.length))
  }

  private getFolderIdFromWindowId(windowId: number): string {
    return 'window-' + windowId
  }

  private getFolderIdFromTabGroupId(tabGroupId: number): string {
    return 'group-' + tabGroupId
  }

  async getBookmarksTree(): Promise<Folder<typeof ItemLocation.LOCAL>> {
    let tabs = await browser.tabs.query({
      windowType: 'normal', // no devtools or panels or popups
    })
    const placeholderTabIds = new Set(
      [...this.placeholderTabs.values()].flat()
    )
    tabs = tabs.filter(
      (tab) => !tab.incognito && !placeholderTabIds.has(tab.id) &&
        !this.isUnsupportedFirefoxUrl(getTabUrl(tab))
    )

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
      children: await Promise.all(
        uniq(tabs.map((t) => t.windowId)).map(async (windowId, i) => {
          const windowTabs = tabs.filter((t) => t.windowId === windowId)

          // Get tab groups for this window
          const windowTabGroups = tabGroups.filter(
            (g) => g.windowId === windowId
          )

          // Get tabs that are not in any group
          const ungroupedTabs = windowTabs
            .filter((t) => !t.groupId || t.groupId === -1)
            .sort((t1, t2) => t1.index - t2.index)
            .map(
              (t) =>
                new Bookmark({
                  id: t.id,
                  title: t.title,
                  url: getTabUrl(t),
                  parentId: this.getFolderIdFromWindowId(windowId),
                  location: ItemLocation.LOCAL,
                })
            )

          // Create folders for each tab group
          const groupFolders = await Promise.all(
            windowTabGroups.map(async (group) => {
              const groupTabs = (
                await browser.tabs.query({
                  windowType: 'normal', // no devtools or panels or popups
                  groupId: group.id,
                })
              )
                .filter((t) => !placeholderTabIds.has(t.id) &&
                  !this.isUnsupportedFirefoxUrl(getTabUrl(t)))
                .sort((t1, t2) => t1.index - t2.index)
                .map(
                  (t) =>
                    new Bookmark({
                      id: t.id,
                      title: t.title,
                      url: getTabUrl(t),
                      parentId: this.getFolderIdFromTabGroupId(group.id),
                      location: ItemLocation.LOCAL,
                    })
                )

              // Store the minimum index of tabs in this group to use for sorting
              // If the group has no tabs (which shouldn't happen in practice, but handling for robustness),
              // use a high index value so it appears at the end
              const minTabIndex =
                groupTabs.length > 0
                  ? Math.min(
                      ...groupTabs.map(
                        (t) => windowTabs.find((tab) => tab.id === t.id).index
                      )
                    )
                  : Number.MAX_SAFE_INTEGER

              return {
                folder: new Folder({
                  // Not 'Group <id>': group ids change with every browser start,
                  // so an untitled group would never be recognized again
                  title: group.title || '',
                  id: this.getFolderIdFromTabGroupId(group.id),
                  parentId: this.getFolderIdFromWindowId(windowId),
                  location: ItemLocation.LOCAL,
                  children: groupTabs,
                }),
                index: minTabIndex, // Use the minimum index of tabs in the group for sorting
              }
            })
          )

          // Create a combined array of ungrouped tabs and group folders
          const combinedItems = [
            // Map ungrouped tabs to objects with the tab and its index
            ...ungroupedTabs.map((tab) => ({
              item: tab,
              index: windowTabs.find((t) => t.id === tab.id).index,
              isTab: true,
            })),
            // Map group folders to objects with the folder and its index
            ...groupFolders.map(({ folder, index }) => ({
              item: folder,
              index,
              isTab: false,
            })),
          ]

          // Sort the combined items by their index
          combinedItems.sort((a, b) => a.index - b.index)

          // Extract the sorted items
          const sortedItems = combinedItems.map((item) => item.item)

          return new Folder({
            title: 'Window ' + i,
            id: this.getFolderIdFromWindowId(windowId),
            parentId: 'tabs',
            location: ItemLocation.LOCAL,
            children: sortedItems,
          })
        })
      ),
    })
  }

  async createBookmark(
    bookmark: Bookmark<typeof ItemLocation.LOCAL>
  ): Promise<string | number> {
    Logger.log('(tabs)CREATE', bookmark)
    if (bookmark.parentId === 'tabs') {
      throw new UnsupportedItemError('Tabs can only be opened in a window')
    }
    if (this.isUnsupportedFirefoxUrl(bookmark.url)) {
      throw new UnsupportedItemError(
        `Firefox cannot open ${new URL(bookmark.url).protocol} URLs in a tab`
      )
    }

    try {
      // Check if the parentId is a tab group by trying to get it
      let isTabGroup = false
      let windowId = null
      if (String(bookmark.parentId).split('-')[0] === 'group') {
        // Try to query the tab group to see if it exists
        if (typeof browser.tabGroups !== 'undefined') {
          const tabGroup = await this.queue.add(() =>
            browser.tabGroups.get(
              this.getTabGroupIdFromFolderId(bookmark.parentId)
            )
          )
          if (tabGroup) {
            isTabGroup = true
            windowId = tabGroup.windowId
            Logger.log('Parent is a tab group', tabGroup)
          }
        }
      } else {
        // If we get an error, it's not a tab group
        Logger.log('Parent is not a tab group')
        isTabGroup = false
      }

      // Create the tab in the appropriate window
      const node = await this.queue.add(() =>
        browser.tabs.create({
          windowId: windowId,
          url: bookmark.url,
          // Only firefox allows discarded prop
          ...(typeof browser.BookmarkTreeNodeType !== 'undefined' && {
            discarded: true,
          }),
          active: false,
        })
      )

      // If it's a tab group, move the tab to the group
      if (isTabGroup) {
        Logger.log('Moving new tab to tab group', bookmark.parentId)
        await this.queue.add(() =>
          browser.tabs.group({
            tabIds: [node.id],
            groupId: this.getTabGroupIdFromFolderId(bookmark.parentId),
          })
        )
        await this.removePlaceholderTabs(
          this.getTabGroupIdFromFolderId(bookmark.parentId)
        )
      }

      await awaitTabsUpdated()
      return node.id
    } catch (e) {
      Logger.log('Failed to create tab', e)
      // Don't throw error if the tab group doesn't exist anymore
      if (
        e.message &&
        !e.message.includes('No tab group with id') &&
        !e.message.includes('No group with id') &&
        !e.message.includes('Invalid tab group id')
      ) {
        throw e
      }
      throw new UnsupportedItemError('The tab group to open this tab in is gone')
    }
  }

  async updateBookmark(
    bookmark: Bookmark<typeof ItemLocation.LOCAL>
  ): Promise<void> {
    Logger.log('(tabs)UPDATE', bookmark)
    if (bookmark.parentId === 'tabs') {
      Logger.log('Parent is "tabs", ignoring this one.')
      return
    }

    // Update the tab's URL
    await this.queue.add(() =>
      browser.tabs.update(bookmark.id, {
        url: bookmark.url,
      })
    )

    if (this.isFlattenedFolder(bookmark.parentId)) {
      Logger.log('Parent was flattened, not moving the tab')
      await awaitTabsUpdated()
      return
    }

    try {
      // Check if the parentId is a tab group by trying to get it
      let isTabGroup = false
      try {
        // Try to query the tab group to see if it exists
        if (typeof browser.tabGroups !== 'undefined') {
          const tabGroup = await this.queue.add(() =>
            browser.tabGroups.get(
              this.getTabGroupIdFromFolderId(bookmark.parentId)
            )
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
            groupId: this.getTabGroupIdFromFolderId(bookmark.parentId),
          })
        )
        await this.removePlaceholderTabs(
          this.getTabGroupIdFromFolderId(bookmark.parentId)
        )
      } else {
        let currentWindowId = null
        try {
          const tab = await this.queue.add(() => browser.tabs.get(bookmark.id))
          currentWindowId = tab.windowId
        } catch (e) {
          Logger.log('Failed to get current tab info', e)
        }
        if (typeof browser.tabGroups !== 'undefined') {
          // Move tab out of any groups
          Logger.log('Moving tab out of any tab group', bookmark.id)
          await this.queue.add(() => browser.tabs.ungroup([bookmark.id]))
        }
        // If it's a window, use tabs.move -- unless this browser has only the
        // one window (Firefox for Android, which has no tabs.move either)
        if (LocalTabs.windowsSupported() && (
          currentWindowId === null ||
          this.getWindowIdFromFolderId(bookmark.parentId) !== currentWindowId
        )) {
          // Do not move if we do not have to, since index -1 can mean that
          // Firefox will put it into the last group in that window...
          Logger.log('Moving tab to window', bookmark.parentId)
          await this.queue.add(() =>
            browser.tabs.move(bookmark.id, {
              windowId: this.getWindowIdFromFolderId(bookmark.parentId),
              index: -1, // last
            })
          )
        }
      }
    } catch (e) {
      Logger.log('Failed to move tab', e)
      // Don't throw error if the tab group doesn't exist anymore
      if (
        e.message &&
        !e.message.includes('No tab group with id') &&
        !e.message.includes('No group with id') &&
        !e.message.includes('Invalid tab group id')
      ) {
        throw e
      }
    }

    await awaitTabsUpdated()
  }

  async removeBookmark(
    bookmark: Bookmark<typeof ItemLocation.LOCAL>
  ): Promise<void> {
    const bookmarkId = bookmark.id
    Logger.log('(tabs)REMOVE', bookmark)
    if (bookmark.parentId === 'tabs') {
      Logger.log('Parent is "tabs", ignoring this one.')
      return
    }
    await this.queue.add(() => browser.tabs.remove(bookmarkId))
    await awaitTabsUpdated()
  }

  async createFolder(
    folder: Folder<typeof ItemLocation.LOCAL>
  ): Promise<string> {
    Logger.log('(tabs)CREATEFOLDER', folder)

    if (folder.parentId === 'tabs'
      ? !LocalTabs.windowsSupported()
      : !LocalTabs.tabGroupsSupported() || this.isFlattenedFolder(folder.parentId)) {
      return this.createFlattenedFolder(folder)
    }

    // If parentId is 'tabs', create a window
    if (folder.parentId === 'tabs') {
      const node = await this.queue.add(() => browser.windows.create())
      return this.getFolderIdFromWindowId(node.id)
    } else {
      // Otherwise, create a tab group
      const windowId = this.getWindowIdFromFolderId(folder.parentId)
      const placeholderTabIds: number[] = []
      try {
        const groupId = await this.queue.add(async () => {
          // Create a dummy tab in the parent window to hold the group
          placeholderTabIds.push(await this.createPlaceholderTab(windowId))
          let groupId = await browser.tabs.group({
            tabIds: placeholderTabIds,
            createProperties: { windowId },
          })

          if (!(await this.tabGroupExists(groupId))) {
            // Opera has dissolved the one-tab group right away
            Logger.log('Tab group with a single tab vanished, retrying with two')
            this.minGroupSize = 2
            placeholderTabIds.push(await this.createPlaceholderTab(windowId))
            groupId = await browser.tabs.group({
              tabIds: placeholderTabIds,
              createProperties: { windowId },
            })
          }

          // Update the tab group title
          if (folder.title) {
            await browser.tabGroups.update(groupId, {
              title: folder.title,
            })
          }

          // The dummy tabs are removed once real tabs join the group
          // (see removePlaceholderTabs): removing them on a timer deleted the
          // group whenever its tabs were created later than that (#2366)
          this.placeholderTabs.set(groupId, placeholderTabIds)

          await awaitTabsUpdated()

          return groupId
        })

        await awaitTabsUpdated()
        return this.getFolderIdFromTabGroupId(groupId)
      } catch (e) {
        Logger.log('Failed to create tab group', e)
        // Don't leave the dummy tabs behind: the next sync would take them for real tabs
        if (placeholderTabIds.length) {
          try {
            await browser.tabs.remove(placeholderTabIds)
          } catch (e) {
            Logger.log('Failed to remove placeholder tabs', e)
          }
        }
        throw e
      }
    }
  }

  private async createPlaceholderTab(windowId: number): Promise<number> {
    const tab = await browser.tabs.create({
      windowId,
      url: 'about:blank',
      active: false,
    })
    return tab.id
  }

  private async tabGroupExists(groupId: number): Promise<boolean> {
    try {
      return Boolean(await browser.tabGroups.get(groupId))
    } catch (e) {
      return false
    }
  }

  async orderFolder(
    id: string | number,
    order: Ordering<typeof ItemLocation.LOCAL>
  ): Promise<void> {
    Logger.log('(tabs)ORDERFOLDER', { id, order })
    if (this.isFlattenedFolder(id)) {
      Logger.log('Folder was flattened, nothing to order')
      return
    }
    if (typeof browser.tabs.move !== 'function') {
      // Failing leaves the cache in the order the tabs are actually in, so the
      // next sync doesn't take the other devices' order for a local change
      throw new Error('This browser cannot reorder tabs')
    }
    try {
      // Check if tab groups are supported
      const tabGroupsSupported = typeof browser.tabGroups !== 'undefined'

      // Determine if the folder to order is a tab group or a window
      let isTabGroup = false
      let tabGroupIndex = 0

      if (tabGroupsSupported && id !== 'tabs') {
        try {
          // Try to get the tab group to see if it exists
          const tabs = await this.queue.add(() =>
            browser.tabs.query({ groupId: this.getTabGroupIdFromFolderId(id) })
          )
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
          Logger.log(
            'Ordering tabs within a tab group, adding offset',
            tabGroupIndex
          )
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
              Logger.log(
                'Moving tab group',
                folder.id,
                'to index',
                currentIndex
              )
              try {
                if (tabGroupsSupported) {
                  await this.queue.add(() =>
                    browser.tabGroups.move(
                      this.getTabGroupIdFromFolderId(folder.id),
                      { index: currentIndex }
                    )
                  )

                  // Get the size of the folder (number of tabs in the group)
                  const folderTabs = await this.queue.add(() =>
                    browser.tabs.query({
                      windowType: 'normal',
                      groupId: this.getTabGroupIdFromFolderId(folder.id),
                    })
                  )

                  // Increment the current index by the size of the folder
                  currentIndex += folderTabs.length
                }
              } catch (e) {
                Logger.log('Failed to move tab group', e)
                // Don't throw error if the tab group doesn't exist anymore
                if (
                  e.message &&
                  !e.message.includes('No tab group with id') &&
                  !e.message.includes('No group with id') &&
                  !e.message.includes('Invalid tab group id')
                ) {
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

  async updateFolder(folder: Folder<typeof ItemLocation.LOCAL>): Promise<void> {
    Logger.log('(tabs)UPDATEFOLDER', folder)
    if (this.isFlattenedFolder(folder.id)) {
      Logger.log('Folder was flattened, nothing to update')
      return
    }

    // If parentId is not 'tabs', it's a tab group
    if (folder.parentId !== 'tabs' && LocalTabs.tabGroupsSupported()) {
      try {
        // Update the tab group title
        await this.queue.add(() =>
          browser.tabGroups.update(this.getTabGroupIdFromFolderId(folder.id), {
            title: folder.title,
          })
        )
      } catch (e) {
        Logger.log('Failed to update tab group', e)
        // Don't throw error if the tab group doesn't exist anymore
        if (
          e.message &&
          !e.message.includes('No tab group with id') &&
          !e.message.includes('No group with id')
        ) {
          throw e
        }
      }
    }
    // Otherwise it's a window, which we don't need to update
  }

  async removeFolder(folder: Folder<typeof ItemLocation.LOCAL>): Promise<void> {
    const id = folder.id
    Logger.log('(tabs)REMOVEFOLDER', id)

    if (this.isFlattenedFolder(id)) {
      Logger.log('Folder was flattened, nothing to remove')
      return
    }

    if (folder.parentId === 'tabs' && !LocalTabs.windowsSupported()) {
      // Without browser.windows there is no closing the window, so close its tabs
      const tabs = await this.queue.add(() =>
        browser.tabs.query({ windowType: 'normal' })
      )
      const windowTabs = tabs.filter(
        (tab) => tab.windowId === this.getWindowIdFromFolderId(id)
      )
      if (windowTabs.length) {
        await this.queue.add(() =>
          browser.tabs.remove(windowTabs.map((tab) => tab.id))
        )
      }
    } else if (folder.parentId === 'tabs') {
      // If parentId is 'tabs', it's a window
      try {
        await this.queue.add(() =>
          browser.windows.remove(this.getWindowIdFromFolderId(id))
        )
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
            groupId: this.getTabGroupIdFromFolderId(id),
          })
        )

        // Remove all tabs in the group
        if (tabs.length > 0) {
          await this.queue.add(() => browser.tabs.remove(tabs.map((t) => t.id)))
        }

        // The tab group will be automatically removed when all its tabs are removed
        this.placeholderTabs.delete(this.getTabGroupIdFromFolderId(id))
      } catch (e) {
        Logger.log('Failed to remove tab group', e)
        // Don't throw error if the tab group doesn't exist anymore
        if (
          e.message &&
          !e.message.includes('No tab group with id') &&
          !e.message.includes('No group with id') &&
          !e.message.includes('No tab with id')
        ) {
          throw e
        }
      }
    }
  }

  private async removePlaceholderTabs(groupId: number): Promise<void> {
    if (!this.placeholderTabs.has(groupId)) {
      return
    }
    try {
      // Keep as many placeholders as the group needs to survive
      const groupTabs = await this.queue.add(() =>
        browser.tabs.query({ groupId })
      )
      // Read the placeholders only now: concurrent calls may have taken some
      const tabIds = this.placeholderTabs.get(groupId)
      if (typeof tabIds === 'undefined') {
        return
      }
      const removable = Math.max(0, groupTabs.length - this.minGroupSize)
      const toRemove = tabIds.slice(0, removable)
      const remaining = tabIds.slice(toRemove.length)
      if (remaining.length) {
        this.placeholderTabs.set(groupId, remaining)
      } else {
        this.placeholderTabs.delete(groupId)
      }
      if (toRemove.length) {
        await this.queue.add(() => browser.tabs.remove(toRemove))
      }
    } catch (e) {
      Logger.log('Failed to remove placeholder tabs', e)
    }
  }

  async isAvailable(): Promise<boolean> {
    const tabs = await browser.tabs.query({
      windowType: 'normal', // no devtools or panels or popups
    })
    return Boolean(tabs.length)
  }

  async isUsingBrowserTabs() {
    return true
  }

  async getCapabilities(): Promise<ICapabilities> {
    return {
      preserveOrder: true,
      hashFn: ['xxhash3', 'murmur3', 'sha256'],
      supportsTags: false,
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  setHashSettings(hashSettings: IHashSettings): void {
    // noop
  }

  cancel(): void {
    this.queue.clear()
  }

  isAtomic(): boolean {
    return false
  }
}

/**
 * A tab that is still loading may not have committed its URL yet: Chromium
 * then reports an empty url and the one it is loading as pendingUrl (Firefox
 * has no pendingUrl). Tabs restored at browser start are such tabs.
 */
function getTabUrl(tab: { url?: string, pendingUrl?: string }): string | undefined {
  return tab.pendingUrl || tab.url
}

const TABS_SETTLE_POLL_INTERVAL = 1000
const TABS_SETTLE_QUIET_POLLS = 3
const TABS_SETTLE_TIMEOUT = 60 * 1000

/**
 * Resolves once the browser has stopped opening and loading tabs, or after a
 * minute at most. At browser start the session is restored tab by tab, and a
 * sync in the middle of that takes the tabs that aren't back yet for tabs
 * closed on this device and opens them again from the server -- which the
 * restore then duplicates.
 */
export async function waitForTabsToSettle(): Promise<void> {
  const deadline = Date.now() + TABS_SETTLE_TIMEOUT
  let previous = null
  let quietPolls = 0
  while (Date.now() < deadline) {
    const tabs = await browser.tabs.query({ windowType: 'normal' })
    const snapshot = JSON.stringify(
      tabs.map((tab) => [tab.id, tab.windowId, tab.groupId, getTabUrl(tab)])
    )
    const loading = tabs.some((tab) => tab.status === 'loading')
    quietPolls = snapshot === previous && !loading ? quietPolls + 1 : 0
    if (quietPolls >= TABS_SETTLE_QUIET_POLLS) {
      return
    }
    previous = snapshot
    await new Promise((resolve) => setTimeout(resolve, TABS_SETTLE_POLL_INTERVAL))
  }
  Logger.log('Tabs did not settle within ' + TABS_SETTLE_TIMEOUT + 'ms, syncing anyway')
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
