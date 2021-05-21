import { Device } from '@capacitor/device'
import browser from './browser-api'
import IController from './interfaces/Controller'
import NativeController from './native/NativeController'

export default class Controller {
  static singleton: IController

  static async getSingleton():Promise<IController> {
    if (!this.singleton) {
      if ((await Device.getInfo().platform) === 'web') {
        const background = await browser.runtime.getBackgroundPage()
        this.singleton = background.controller
      } else {
        this.singleton = NativeController.getSingleton()
      }
    }
    return this.singleton
  }
}
