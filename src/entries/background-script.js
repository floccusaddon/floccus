import BrowserController from '../lib/browser/BrowserController'

window.controller = new BrowserController()

const onbeforeunload = () => {
  window.controller.cancelAll()
}
const onload = () => {
  window.controller.onLoad()
}
window.addEventListener('load', onload)
window.addEventListener('beforeunload', onbeforeunload)
