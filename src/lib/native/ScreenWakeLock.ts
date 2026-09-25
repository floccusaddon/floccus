import { KeepAwake } from '@capacitor-community/keep-awake'
import Logger from '../Logger'

/**
 * Keeps the screen on while a sync is running.
 *
 * On native there is no background service: the sync runs in the WebView, so
 * once the screen turns off the runtime is throttled and the sync stalls
 * halfway through.
 *
 * Locks are counted, because multiple accounts can sync at the same time, and
 * we re-assert the lock when we become visible again -- iOS drops the idle
 * timer override while the app is in the background.
 */
class ScreenWakeLock {
  private count = 0
  private listening = false

  async acquire(): Promise<void> {
    this.count++
    if (this.count > 1) {
      return
    }
    this.listen()
    await this.keepAwake()
  }

  async release(): Promise<void> {
    this.count = Math.max(0, this.count - 1)
    if (this.count > 0) {
      return
    }
    try {
      await KeepAwake.allowSleep()
    } catch (e) {
      Logger.log('Could not release screen wake lock: ' + String(e))
    }
  }

  private async keepAwake(): Promise<void> {
    try {
      await KeepAwake.keepAwake()
    } catch (e) {
      // The platform may refuse, e.g. in battery saver mode
      Logger.log('Could not acquire screen wake lock: ' + String(e))
    }
  }

  private listen(): void {
    if (this.listening) {
      return
    }
    this.listening = true
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && this.count > 0) {
        this.keepAwake()
      }
    })
  }
}

export default new ScreenWakeLock()
