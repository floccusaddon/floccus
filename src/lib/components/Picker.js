/* @jsx h */
import browser from '../browser-api'
import {h} from 'hyperapp'

export const state = {
  picker: {
    openedFor: null
    , tree: null
  }
}

export const actions = {
  picker: {
    setOpenedFor: (openedFor) => ({openedFor})
    , setTree: (tree) => ({tree})
    , loadTree: () => async (state, actions) => {
      actions.setTree((await browser.bookmarks.getTree())[0])
    }
  }
  , openPicker: (accountId) => async (state, actions) => {
    await actions.picker.loadTree()
    actions.picker.setOpenedFor(accountId)
    actions.switchView('picker')
  }
  , setNodeFromPicker: (nodeId) => async (state, actions) => {
    var account = state.accounts.accounts[state.picker.openedFor]
    await account.setData({...(account.getData()), localRoot: nodeId})
    await account.init()
    actions.switchView('accounts')
  }
}

export const Component = () => (state, actions) => {
  let tree = state.picker.tree
  return <Overlay>
    <div id="picker">{
      tree.id
        ? <Subtree tree={tree} />
        : tree.children.map((node) => <Subtree tree={node} />)
    }</div>
  </Overlay>
}

const Subtree = ({tree}) => (state, actions) => {
  return !tree.children ? ''
    : <div className={'item ' + (tree.children ? 'folder' : '')}>
      <div className="label" onclick={(e) => {
        if (!tree.children.filter(child => !!child.children).length) return
        var item = e.currentTarget.parentNode
        if (item.classList.contains('open'))
          item.classList.remove('open')
        else
          item.classList.add('open')
      }}>
        {tree.title || <i>Untitled folder</i>}
        <span className="choose btn"
          onclick={(e) => {
            actions.setNodeFromPicker(tree.id)
            return false
          }}>✓</span>
      </div>
      { tree.children.filter(child => !!child.children).length
        ? <div className="children">
          {tree.children.map((node) => <Subtree tree={node} />)}
        </div>
        : ''}
    </div>
}
