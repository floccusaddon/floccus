import IController from './interfaces/Controller'
import { Capacitor } from '@capacitor/core'

interface FloccusWorker {
  postMessage(data: any): void
  addEventListener(fn: (data: any) => void): () => void
}

export default class Controller implements IController {
  public static singleton: IController
  private worker: FloccusWorker|null
  private key: string|null|undefined

  static async getSingleton():Promise<IController> {
    if (!this.singleton) {
      if (Capacitor.getPlatform() === 'web') {
        // otherwise load the proxy
        this.singleton = new Controller
      } else {
        // If we're not on the web, laod the implementation directly
        this.singleton = new (await import('./native/NativeController')).default
      }
    }
    return this.singleton
  }

  constructor(worker?: FloccusWorker) {
    this.worker = worker
  }

  async getWorker(): Promise<FloccusWorker> {
    if (this.worker) {
      return Promise.resolve(this.worker)
    }
    if (!navigator.userAgent.includes('Firefox') && navigator.serviceWorker?.controller) {
      return navigator.serviceWorker.ready.then((registration) => ({
        postMessage: (...args) => registration.active.postMessage(...args),
        addEventListener: (fn) => {
          const listener = (event) => fn(event.data)
          navigator.serviceWorker.addEventListener('message', listener)
          return () => navigator.serviceWorker.removeEventListener('message', listener)
        },
      }))
    }
    if (Capacitor.getPlatform() === 'web') {
      const browser = (await import('../lib/browser-api')).default
      return {
        postMessage: (data) => {
          try {
            browser.runtime.sendMessage(data)
          } catch (e) {
            console.warn(e)
          }
        },
        addEventListener: (fn) => {
          try {
            browser.runtime.onMessage.addListener(fn)
          } catch (e) {
            console.warn(e)
          }
          return () => {
            try {
              browser.runtime.onMessage.removeListener(fn)
            } catch (e) {
              console.warn(e)
            }
          }
        },
      }
    }
  }

  async cancelSync(accountId, keepEnabled): Promise<void> {
    console.log('Waiting for service worker readiness')
    const worker = await this.getWorker()
    const message = {type: 'cancelSync', params: [accountId, keepEnabled]}
    worker.postMessage(message)
    console.log('Sending message to service worker: ', message)
  }

  onStatusChange(listener): () => void {
    const eventListener = (data) => {
      const {type} = data
      if (type === 'status:update') {
        listener()
      }
    }
    let worker, removeListener
    this.getWorker().then(w => {
      worker = w
      removeListener = worker.addEventListener(eventListener)
    })
    return () => {
      removeListener && removeListener()
    }
  }

  async scheduleSync(accountId, wait): Promise<void> {
    console.log('Waiting for service worker readiness')
    const worker = await this.getWorker()
    const message = {type: 'scheduleSync', params: [accountId, wait]}
    worker.postMessage(message)
    console.log('Sending message to service worker: ', message)
  }

  async scheduleAll(): Promise<void> {
    console.log('Waiting for service worker readiness')
    const worker = await this.getWorker()
    const message = {type: 'scheduleAll', params: []}
    worker.postMessage(message)
    console.log('Sending message to service worker: ', message)
  }

  async setEnabled(enabled: boolean): Promise<void> {
    const worker = await this.getWorker()
    const message = {type: 'setEnabled', params: [enabled]}
    worker.postMessage(message)
    console.log('Sending message to service worker: ', message)
  }

  async syncAccount(accountId, strategy, forceSync = false): Promise<void> {
    console.log('Waiting for service worker readiness')
    const worker = await this.getWorker()
    const message = {type: 'syncAccount', params: [accountId, strategy, forceSync]}
    worker.postMessage(message)
    console.log('Sending message to service worker: ', message)
  }

  async unlock(key): Promise<void> {
    console.log('Waiting for service worker readiness')
    const worker = await this.getWorker()
    const message = {type: 'unlock', params: [key]}
    worker.postMessage(message)
    console.log('Sending message to service worker: ', message)
  }

  async getUnlocked(): Promise<boolean> {
    console.log('Waiting for service worker readiness')
    const worker = await this.getWorker()

    return new Promise((resolve) => {
      const eventListener = (data) => {
        if (data.type === 'getUnlockedResponse') {
          resolve(data.params[0])
          console.log('Message response received', data)
          removeEventListener()
        }
      }
      const removeEventListener = worker.addEventListener(eventListener)
      const message = { type: 'getUnlocked', params: [] }
      worker.postMessage(message)
      console.log('Sending message to service worker: ', message)
    })
  }

  async onLoad() {
    // noop
  }
}
