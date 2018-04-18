/* @jsx el */
function el (el, props, ...children) {
  return h(el, props, children)
};
import browser from '../lib/browser-api'
import Account from '../lib/Account'
import Tree from '../lib/Tree'
import {h, diff, patch} from 'virtual-dom'
require('dom-delegator')()

let $rootPath = Symbol('$rootPath')

var tree = h('div#app')
  , rootNode = document.querySelector('#app')
  , rendering = false

async function triggerRender () {
  if (rendering) return
  rendering = true
  const accounts = await Account.getAllAccounts()

  await Promise.all(
    accounts
      .map(async (acc) => {
        const localRoot = acc.getData().localRoot
        try {
          acc[$rootPath] = localRoot
            ? decodeURIComponent(await Tree.getPathFromLocalId(localRoot))
            : '*newly created*'
        } catch (e) {
          acc[$rootPath] = '*newly created*'
        }
      })
  )

  let background = await browser.runtime.getBackgroundPage()
  if (!background.controller.unlocked) {
    state.view = 'unlock'
  } else if (state.view === 'unlock') {
    state.view = 'accounts'
  }
  let secured = !!background.controller.key

  let bmTree
  if (state.view === 'picker') {
    bmTree = (await browser.bookmarks.getTree())[0]
  }

  let newTree = render({accounts, tree: bmTree, secured})
  let patches = diff(tree, newTree)
  rootNode = patch(rootNode, patches)
  tree = newTree
  rendering = false
}

var state = {
  view: 'accounts' // accounts | picker | set_key | unlock
  , picker: {
    openedFor: null
  }
  , setKey: {
    error: null
  }
}
function render (data) {
  return <div id="app">{[
    renderAccounts(data.accounts, data.secured)
    , state.view === 'picker' ?
      renderPicker((nodeId) => {
        var account = data.accounts.filter((a) => a.id === state.picker.openedFor)[0]
        state.view = 'accounts'
        account.setData({...(account.getData()), localRoot: nodeId})
          .then(() => account.init())
          .then(triggerRender)
      }, data.tree)
      : state.view === 'unlock' ?
        renderUnlock()
        : state.view === 'set_key' ?
          renderSetKey()
          : ''
  ]}</div>
}
function renderAccounts (accounts, secured) {
  return <div>
    <div id="accounts">{
      accounts.map(account => {
        return account.renderOptions({
          delete: () => {
            account.delete().then(() => triggerRender())
          }
          , sync: () => {
            browser.runtime.getBackgroundPage()
              .then((background) => {
                background.syncAccount(account.id)
                triggerRender()
              })
              .then(() => triggerRender())
          }
          , update: (data) => {
            account.setData(data)
              .then(() => triggerRender())
          }
          , pickFolder: () => {
            state.view = 'picker'
            state.picker.openedFor = account.id
            triggerRender()
          }
        }, account[$rootPath])
      })
    }</div>
    <a href="" className="btn" id="addaccount" ev-click={() => {
      Account.create({type: 'nextcloud', url: 'http://example.org', username: 'bob', password: 'password'})
        .then(() => triggerRender())
    }}>Add account</a>
    <div className="security">
      <label><input type="checkbox" checked={secured} ev-click={() => {
        state.view = 'set_key'
        triggerRender()
      }} /> Secure your credentials with a passphrase (entered on browser start)</label>
    </div>
    <a className="test-link" href="./test.html">run tests</a>
  </div>
}
function wrapOverlay (fn) {
  return <div id="overlay" ev-click={function (e) {
    if (e.target.id !== 'overlay') return
    state.view = 'accounts'
    triggerRender()
  }}>
    {fn()}
  </div>
}
function renderSetKey (data) {
  return wrapOverlay(() => {
    return <div id="setKey">
      <h2>Set a passphrase for floccus</h2>
      <p>{state.setKey.error ? state.setKey.error : ''}</p>
      <input value={new InputInitializeHook('')} type="password" className="unlockKey" placeholder="Enter your unlock passphrase" />
      <input value={new InputInitializeHook('')} type="password" className="unlockKey" placeholder="Enter passphrase a second time" />
      <a className="btn" href="#" ev-click={(e) => {
        e.preventDefault()
        browser.runtime.getBackgroundPage()
          .then((background) => {
            let inputs = e.target.parentNode.querySelectorAll('.unlockKey')
            if (inputs[0].value !== inputs[1].value) {
              state.setKey.error = 'Passphrases don\'t match'
              return
            }
            return background.controller.setKey(e.target.parentNode.querySelector('.unlockKey').value)
          })
          .then(() => triggerRender())
      }}>Secure accounts</a>
    </div>
  })
}
function renderUnlock () {
  return wrapOverlay(() => {
    return <div id="unlock">
      <h2>Unlock floccus</h2>
      <input value={new InputInitializeHook('')} type="password" className="unlockKey" placeholder="Enter your unlock passphrase" />
      <a className="btn" href="#" ev-click={(e) => {
        e.preventDefault()
        browser.runtime.getBackgroundPage()
          .then((background) => {
            return background.controller.unlock(e.target.parentNode.querySelector('.unlockKey').value)
          })
          .then(() => triggerRender())
      }}>Unlock</a>
    </div>
  })
}
function renderPicker (cb, tree) {
  return wrapOverlay(() => {
    return <div id="picker">{
      tree.id
        ? renderTree(cb, tree)
        : tree.children.map(renderTree.bind(null, cb))
    }</div>
  })
}
function renderTree (cb, tree) {
  return !tree.children ? ''
    : <div className={'item ' + (tree.children ? 'folder' : '')}>
      <div className="label" ev-click={(e) => {
        if (!tree.children.filter(child => !!child.children).length) return
        var item = e.currentTarget.parentNode
        if (item.classList.contains('open'))
          item.classList.remove('open')
        else
          item.classList.add('open')
      }}>{tree.title || <i>Untitled folder</i>}<span className="choose btn" ev-click={() => cb(tree.id)}>✓</span></div>
      { tree.children.filter(child => !!child.children).length
        ? <div className="children">
          {tree.children.map(renderTree.bind(null, cb))}
        </div>
        : ''}
    </div>
}
class InputInitializeHook {
  constructor (initStr) { this.initStr = initStr }
  hook (node, propertyName, previousValue) {
    if (typeof previousValue !== 'undefined') return
    node[propertyName] = this.initStr
  }
}

triggerRender()
setInterval(() => {
  triggerRender()
}, 500)
