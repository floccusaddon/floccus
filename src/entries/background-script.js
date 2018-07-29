import Controller from '../lib/Controller'

window.controller = new Controller()
window.syncAccount = accountId => window.controller.syncAccount(accountId)

const onload = () => {
  window.controller.onLoad()
}
window.addEventListener('load', onload)
