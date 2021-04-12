import BrowserController from '../lib/browser/BrowserController'

window.controller = new BrowserController()

const onload = () => {
  window.controller.onLoad()
}
window.addEventListener('load', onload)
