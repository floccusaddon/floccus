import browser from '../lib/browser-api'
import Account from '../lib/Account'
import {h, diff, patch} from 'virtual-dom'

require('dom-delegator')()

var tree = h('div#accounts')
  , rootNode = document.querySelector('#accounts')
  , rendering = false
function triggerRender() {
  if (rendering) return rendering.then(triggerRender)
  rendering = browser.storage.local.get('accounts')
  .then((d) => {
    let accounts = d['accounts']
    return Promise.all(
      Object.keys(accounts)
      .map(Account.get)
    )
  })
  .then((accounts) => {
    console.log(accounts)
    let newTree = render(accounts)
    let patches = diff(tree, newTree)
    rootNode = patch(rootNode, patches)
    tree = newTree
    rendering = false
  })
}

function render(accounts) {
  return h('div#accounts', accounts.map(account => {
    return account.renderOptions({
      delete: () => {
        account.delete().then(() => triggerRender())
      }
    , sync: () => {
        browser.runtime.getBackgroundPage()
        .then((background) => background.syncAccount(account.id))
        .then(() => triggerRender())
      }
    , update: (data) => {
        account.setData(data)
        .then(() => triggerRender())
      }
    })
  }))
}


document.querySelector('#addaccount').addEventListener('click', () => {
  Account.create({type: 'nextcloud', url: 'http://example.org', username: 'bob', password: 'password'})
  .then(() => triggerRender())
})
triggerRender()
