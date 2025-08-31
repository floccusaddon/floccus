import { Bookmark, Folder, TItemLocation } from '../Tree'
import { ICapabilities, IHashSettings, OrderFolderResource } from '../interfaces/Resource'
import Ordering from '../interfaces/Ordering'
import browser from '../browser-api'

interface NativeResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
}

export class SafariTree<L extends TItemLocation> implements OrderFolderResource<L> {
  private readonly APP_ID = 'org.handmadeideas.floccus-macos';
  private abortController = new AbortController();

  setHashSettings(hashSettings: IHashSettings): void {
    // pass
  }

  async getBookmarksTree(loadAll = false): Promise<Folder<L>> {
    const res = await this.sendNative<Folder<L>>({
      cmd: 'getBookmarksTree',
      payload: { loadAll }
    })
    return res.data!
  }

  async createBookmark(bookmark: Bookmark<L>): Promise<string | number> {
    const res = await this.sendNative<string | number>({
      cmd: 'createBookmark',
      payload: bookmark
    })
    return res.data!
  }

  async updateBookmark(bookmark: Bookmark<L>): Promise<void> {
    await this.sendNative({ cmd: 'updateBookmark', payload: bookmark })
  }

  async removeBookmark(bookmark: Bookmark<L>): Promise<void> {
    await this.sendNative({ cmd: 'removeBookmark', payload: bookmark })
  }

  async createFolder(folder: Folder<L>): Promise<string | number> {
    const res = await this.sendNative<string | number>({
      cmd: 'createFolder',
      payload: folder
    })
    return res.data!
  }

  async updateFolder(folder: Folder<L>): Promise<void> {
    await this.sendNative({ cmd: 'updateFolder', payload: folder })
  }

  async removeFolder(folder: Folder<L>): Promise<void> {
    await this.sendNative({ cmd: 'removeFolder', payload: folder })
  }

  async isAvailable(): Promise<boolean> {
    try {
      const res = await this.sendNative<boolean>({ cmd: 'ping' })
      return res.data === true
    } catch {
      return false
    }
  }

  async getCapabilities(): Promise<ICapabilities> {
    return {
      preserveOrder: true,
      hashFn: ['xxhash3', 'murmur3', 'sha256']
    }
  }

  isAtomic(): boolean {
    return false
  }

  async isUsingBrowserTabs(): Promise<boolean> {
    return false
  }

  cancel(): void {
    this.abortController.abort()
    this.abortController = new AbortController()
  }

  async orderFolder(id: string | number, order: Ordering<L>): Promise<void> {
    await this.sendNative({ cmd: 'orderFolder', payload: { id, order } })
  }

  private async sendNative<T>(msg: any): Promise<NativeResponse<T>> {
    return new Promise((resolve, reject) => {
      const signal = this.abortController.signal

      if (signal.aborted) return reject(new Error('Aborted'))

      const listener = (message: any) => {
        const res = message as NativeResponse<T>
        if (!res.success) reject(new Error(res.error || 'Native error'))
        else resolve(res)
      }

      const port = browser.runtime.connectNative(this.APP_ID)
      const onAbort = () => port.disconnect()

      signal.addEventListener('abort', onAbort)

      port.onMessage.addListener(listener)
      port.onDisconnect.addListener(() => reject(new Error('Disconnected')))
      port.postMessage(msg)

      // Clean-up
      Promise.resolve().finally(() => {
        signal.removeEventListener('abort', onAbort)
        port.disconnect()
      })
    })
  }
}
