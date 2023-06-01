import IController from './interfaces/Controller'
import { Capacitor } from '@capacitor/core'
export default class Controller implements IController {
  public static singleton: IController
  private worker: Worker|null

  static async getSingleton():Promise<IController> {
    if (!this.singleton) {
      if (Capacitor.getPlatform() === 'web') {
        // eslint-disable-next-line no-undef
        if (typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope) {
          // If we're on the web and inside a service worker
          // load the actual implementation
          this.singleton = new (await import('./browser/BrowserController')).default
        } else {
          // otherwise load the proxy
          this.singleton = new Controller
        }
      } else {
        // If we're not on the web, laod the implementation directly
        this.singleton = new (await import('./native/NativeController')).default
      }
    }
    return this.singleton
  }

  constructor(worker?: Worker) {
    this.worker = worker
  }

  async getWorker(): Promise<Worker|ServiceWorker> {
    return this.worker
      ? Promise.resolve(this.worker)
      : navigator.serviceWorker.ready.then((registration) => registration.active)
  }

  async cancelSync(accountId, keepEnabled): Promise<void> {
    console.log('Waiting for service worker readiness')
    const worker = await this.getWorker()
    const message = {type: 'cancelSync', params: [accountId, keepEnabled]}
    worker.postMessage(message)
    console.log('Sending message to service worker: ', message)
  }

  onStatusChange(listener): () => void {
    const eventListener = (event) => {
      const {type} = event.data
      if (type === 'onStatusChange') {
        listener()
      }
    }
    let worker
    this.getWorker().then(w => {
      worker = w
      worker.addEventListener('message', eventListener)
    })
    return function() {
      worker.removeEventListener('message', eventListener)
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
      const eventListener = (event) => {
        if (event.data.type === 'getKeyResponse') {
          resolve(event.data.params[0])
          worker.removeEventListener('message', eventListener)
        }
      }
      worker.addEventListener('message', eventListener)
      const message = { type: 'getKey', params: [] }
      worker.postMessage(message)
      console.log('Sending message to service worker: ', message)
    })
  }

  async getUnlocked(): Promise<boolean> {
    console.log('Waiting for service worker readiness')
    const worker = await this.getWorker()

    return new Promise((resolve) => {
      const eventListener = (event) => {
        if (event.data.type === 'getUnlockedResponse') {
          resolve(event.data.params[0])
          worker.removeEventListener('message', eventListener)
        }
      }
      worker.addEventListener('message', eventListener)
      const message = { type: 'getUnlocked', params: [] }
      worker.postMessage(message)
      console.log('Sending message to service worker: ', message)
    })
  }

  onLoad() {
    // noop
  }
}
