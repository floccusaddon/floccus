import browser from '../lib/browser-api'
import {h, diff, patch} from 'virtual-dom'

var tree = h('div#accounts')
  , rootNode = document.querySelector('#accounts')

function triggerRender() {
  browser.storage.local.get('accounts')
  .then((d) => {
    let accounts = d['accounts']
    console.log(accounts)
    let newTree = render(accounts)
    let patches = diff(tree, newTree)
    rootNode = patch(rootNode, patches)
    tree = newTree
  })
}

function render(accounts) {
  return Object.keys(accounts)
  .map(Account.get)
  .map(account => {
    return account.renderOptions({
      delete: account.delete().then(() => triggerRender())
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
  })
}

triggerRender()
