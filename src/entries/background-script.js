import Controller from '../lib/Controller'

window.controller = new Controller()

const onload = () => {
  window.controller.onLoad()
}
window.addEventListener('load', onload)
