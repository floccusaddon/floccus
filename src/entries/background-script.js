import Controller from '../lib/Controller'
import BrowserController from '../lib/browser/BrowserController'

const controller = new BrowserController
controller.onLoad()
Controller.singleton = controller
