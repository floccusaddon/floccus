import { Device } from '@capacitor/device'
import IController from './interfaces/Controller'

export default class Controller {
  static singleton: IController

  static async getSingleton():Promise<IController> {
    if (!this.singleton) {
      if ((await Device.getInfo()).platform === 'web') {
        const browser = (await import('./browser-api')).default
        const background = await browser.runtime.getBackgroundPage()
        this.singleton = background.controller
      } else {
        const NativeController = await import('./native/NativeController')
        this.singleton = NativeController.default.getSingleton()
      }
    }
    return this.singleton
  }
}
