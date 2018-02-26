/* @jsx el */
function el(el, props, ...children) {
return h(el, props, children);
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

function triggerRender() {
  if (rendering) return rendering.then(triggerRender)
  rendering = (async () => {
    const d = await Promise.all([
      Account.getAllAccounts()
    , browser.bookmarks.getTree() 
    ])

    await Promise.all(
      d[0]
      .map(async (acc) => {
        const localRoot = acc.getData().localRoot
        try {
          acc[$rootPath] = localRoot? decodeURIComponent(await Tree.getPathFromLocalId(localRoot)) : '*newly created*'
        } catch(e) {
          acc[$rootPath] = '*newly created*'
        }
      })
    )
    
    let newTree = render({accounts: d[0], tree: d[1][0]})
    let patches = diff(tree, newTree)
    rootNode = patch(rootNode, patches)
    tree = newTree
    rendering = false
  })()
}

var state = {
  view: 'accounts'
, pickerOpenedFor: null
}
function render(data) {
  return <div id="app">{[
    renderAccounts(data.accounts)
  , state.view === 'picker'? renderPicker((nodeId) => {
      var account = data.accounts.filter((a) => a.id === state.pickerOpenedFor)[0]
      state.view = 'accounts'
      account.setData({...(account.getData()), localRoot: nodeId})
      .then(() => account.init())
      .then(triggerRender)
    }, data.tree) : ''
  ]}</div>
}
function renderAccounts(accounts) {
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
            state.pickerOpenedFor = account.id
            triggerRender()
          }
        }, account[$rootPath])
      })
    }</div>
    <input type="button" className="btn" id="addaccount" value="Add account" ev-click={() => {
      Account.create({type: 'nextcloud', url: 'http://example.org', username: 'bob', password: 'password'})
      .then(() => triggerRender())
    }} />
  </div>
}
function renderPicker(cb, tree) {
  return <div id="overlay" ev-click={function(e) {
    if (e.target !== this) return
    state.view = 'accounts'
    trigerRender()
  }}><div id="picker">{tree.children.map(renderTree.bind(null, cb))}</div></div>
}
function renderTree(cb, tree) {
  return !tree.children? '' :
  <div className={'item ' + (tree.children? 'folder' : '')}>
    <div className="label" ev-click={(e) => {
      if (!tree.children.filter(child => !!child.children).length) return
      var item = e.target.parentNode
      if (item.classList.contains('open'))
        item.classList.remove('open')
      else
        item.classList.add('open')
    }}>{tree.title}<span className="choose btn" ev-click={() => cb(tree.id)}>✓</span></div>
      { tree.children.filter(child => !!child.children).length?
        <div className="children">
            {tree.children.map(renderTree.bind(null, cb))}
        </div>
      : ''}
  </div>
}

triggerRender()
setInterval(() => {
  triggerRender()
}, 500)
