import IController from './interfaces/Controller'
import { Capacitor } from '@capacitor/core'

export default class Controller implements IController {
  static singleton: IController

  static async getSingleton():Promise<IController> {
    if (!this.singleton) {
      // eslint-disable-next-line no-undef
      if (typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope) {
        if (Capacitor.getPlatform() === 'web') {
          this.singleton = new (await import('./browser/BrowserController')).default
        } else {
          this.singleton = new (await import('./native/NativeController')).default
        }
        return this.singleton
      } else {
        this.singleton = new Controller
      }
    }
    return this.singleton
  }

  cancelSync(accountId, keepEnabled): Promise<void> {
    return navigator.serviceWorker.ready.then((registration) => {
      const worker = registration.active
      worker.postMessage({type: 'cancelSync', params: [accountId, keepEnabled]})
    })
  }

  onStatusChange(listener): () => void {
    const eventListener = (event) => {
      const {type} = event.data
      if (type === 'onStatusChange') {
        listener()
      }
    }
    navigator.serviceWorker.addEventListener('message', eventListener)
    return function() {
      navigator.serviceWorker.removeEventListener('message', eventListener)
    }
  }

  scheduleSync(accountId, wait): Promise<void> {
    return navigator.serviceWorker.ready.then((registration) => {
      const worker = registration.active
      worker.postMessage({type: 'scheduleSync', params: [accountId, wait]})
    })
  }

  setEnabled(enabled: boolean): void {
    navigator.serviceWorker.ready.then((registration) => {
      const worker = registration.active
      worker.postMessage({type: 'setEnabled', params: [enabled]})
    })
  }

  setKey(key): Promise<void> {
    return navigator.serviceWorker.ready.then((registration) => {
      const worker = registration.active
      worker.postMessage({type: 'setKey', params: [key]})
    })
  }

  syncAccount(accountId, strategy): Promise<void> {
    return navigator.serviceWorker.ready.then((registration) => {
      const worker = registration.active
      worker.postMessage({type: 'syncAccount', params: [accountId, strategy]})
    })
  }

  unlock(key): Promise<void> {
    return navigator.serviceWorker.ready.then((registration) => {
      const worker = registration.active
      worker.postMessage({type: 'unlock', params: [key]})
    })
  }

  unsetKey(): Promise<void> {
    return navigator.serviceWorker.ready.then((registration) => {
      const worker = registration.active
      worker.postMessage({type: 'unsetKey', params: []})
    })
  }

  getKey(): Promise<string|null> {
    return new Promise((resolve) => {
      const eventListener = (event) => {
        if (event.data.type === 'getKeyResponse') {
          resolve(event.data.params[0])
          navigator.serviceWorker.removeEventListener('message', eventListener)
        }
      }
      navigator.serviceWorker.addEventListener('message', eventListener)
      navigator.serviceWorker.ready.then((registration) => {
        const worker = registration.active
        worker.postMessage({ type: 'getKey', params: [] })
      })
    })
  }

  getUnlocked(): Promise<boolean> {
    return new Promise((resolve) => {
      const eventListener = (event) => {
        if (event.data.type === 'getUnlockedResponse') {
          resolve(event.data.params[0])
          navigator.serviceWorker.removeEventListener('message', eventListener)
        }
      }
      navigator.serviceWorker.addEventListener('message', eventListener)
      navigator.serviceWorker.ready.then((registration) => {
        const worker = registration.active
        worker.postMessage({ type: 'getUnlocked', params: [] })
      })
    })
  }
}
