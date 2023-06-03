import IController from './interfaces/Controller'
import { Capacitor } from '@capacitor/core'

interface FloccusWorker {
  postMessage(data: any): void
  addEventListener(fn: (data: any) => void): void
  removeEventListener(fn: (data: any) => void): void
}

export default class Controller implements IController {
  public static singleton: IController
  private worker: FloccusWorker|null

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
    if (navigator.serviceWorker?.controller) {
      return navigator.serviceWorker.ready.then((registration) => ({
        postMessage: (...args) => registration.active.postMessage(...args),
        addEventListener: (fn) => navigator.serviceWorker.addEventListener('message', (event) => fn(event.data)),
        removeEventListener: (fn) => navigator.serviceWorker.removeEventListener('message', fn)
      }))
    }
    if (Capacitor.getPlatform() === 'web') {
      const browser = (await import('../lib/browser-api')).default
      return {
        postMessage: (data) => browser.runtime.sendMessage(data),
        addEventListener: (fn) => browser.runtime.onMessage.addListener(fn),
        removeEventListener: (fn) => browser.runtime.onMessage.addListener(fn)
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
    let worker
    this.getWorker().then(w => {
      worker = w
      worker.addEventListener(eventListener)
    })
    return function() {
      worker.removeEventListener(eventListener)
    }
  }

  async scheduleSync(accountId, wait): Promise<void> {
    console.log('Waiting for service worker readiness')
    const worker = await this.getWorker()
    const message = {type: 'scheduleSync', params: [accountId, wait]}
    worker.postMessage(message)
    console.log('Sending message to service worker: ', message)
  }

  async setEnabled(enabled: boolean): Promise<void> {
    const worker = await this.getWorker()
    const message = {type: 'setEnabled', params: [enabled]}
    worker.postMessage(message)
    console.log('Sending message to service worker: ', message)
  }

  async setKey(key): Promise<void> {
    console.log('Waiting for service worker readiness')
    const worker = await this.getWorker()
    const message = {type: 'setKey', params: [key]}
    worker.postMessage(message)
    console.log('Sending message to service worker: ', message)
  }

  async syncAccount(accountId, strategy): Promise<void> {
    console.log('Waiting for service worker readiness')
    const worker = await this.getWorker()
    const message = {type: 'syncAccount', params: [accountId, strategy]}
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

  async unsetKey(): Promise<void> {
    console.log('Waiting for service worker readiness')
    const worker = await this.getWorker()
    const message = {type: 'unsetKey', params: []}
    worker.postMessage(message)
    console.log('Sending message to service worker: ', message)
  }

  async getKey(): Promise<string|null> {
    console.log('Waiting for service worker readiness')
    const worker = await this.getWorker()
    // eslint-disable-next-line no-async-promise-executor
    return new Promise((resolve) => {
      const eventListener = (data) => {
        if (data.type === 'getKeyResponse') {
          console.log('Message response received', data)
          resolve(data.params[0])
          worker.removeEventListener(eventListener)
        }
      }
      worker.addEventListener(eventListener)
      const message = { type: 'getKey', params: [] }
      worker.postMessage(message)
      console.log('Sending message to service worker: ', message)
    })
  }

  async getUnlocked(): Promise<boolean> {
    console.log('Waiting for service worker readiness')
    const worker = await this.getWorker()

    return new Promise((resolve) => {
      const eventListener = (data) => {
        if (data.type === 'getUnlockedResponse') {
          resolve(data.params[0])
          console.log('Message response received', data)
          worker.removeEventListener(eventListener)
        }
      }
      worker.addEventListener(eventListener)
      const message = { type: 'getUnlocked', params: [] }
      worker.postMessage(message)
      console.log('Sending message to service worker: ', message)
    })
  }

  onLoad() {
    // noop
  }
}
