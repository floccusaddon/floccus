/* @jsx h */
import browser from '../browser-api'
import {h} from 'hyperapp'
import {Component as Overlay} from './Overlay'
import * as Basics from './basics'
import picostyle from 'picostyle'

const style = picostyle(h)
const Button = Basics.Button

export const state = {
  picker: {
    openedFor: null
    , tree: null
    , openedFolders: {}
  }
}

export const actions = {
  picker: {
    setOpenedFor: (openedFor) => ({openedFor})
    , setTree: (tree) => ({tree})
    , loadTree: () => async (state, actions) => {
      actions.setTree((await browser.bookmarks.getTree())[0])
    }
    , toggleFolder: (folderId) => state => ({
      openedFolders: {...state.openedFolders, [folderId]: !state.openedFolders[folderId]}
    })
    , openFolder: (folderId) => state => ({
      openedFolders: {...state.openedFolders, [folderId]: true}
    })
    , closeFolder: (folderId) => state => ({
      openedFolders: {...state.openedFolders, [folderId]: false}
    })
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
    : <Item>
      <ItemLabel onclick={(e) => {
        if (!tree.children.filter(child => !!child.children).length) return
        actions.picker.toggleFolder(tree.id)
      }}
      active={state.picker.openedFolders[tree.id]}>
        {state.picker.openedFolders[tree.id]
          ? '− '
          : '+ '}
        {tree.title || <i>Untitled folder</i>}
        <Button className="choose"
          onclick={(e) => {
            actions.setNodeFromPicker(tree.id)
            return false
          }}>✓</Button>
      </ItemLabel>
      { tree.children.filter(child => !!child.children).length &&
        state.picker.openedFolders[tree.id]
        ? <div className="children">
          {tree.children.map((node) => <Subtree tree={node} />)}
        </div>
        : ''}
    </Item>
}

const Item = style('div')({
  padding: '.1cm'
  , '> .children': {
    borderLeft: `1px ${Basics.COLORS.primary.light} solid`
    , padding: '.2cm 0 0 .2cm'
  }
})
const ItemLabel = style('div')(props => ({
  padding: '.15cm'
  , cursor: 'pointer'
  , position: 'relative'
  , borderRadius: '.1cm'
  , background: props.active ? Basics.COLORS.primary.light : 'transparent'
  , color: props.active ? 'white' : Basics.COLORS.primary.dark
  , '::first-letter': {
    fontSize: '.5cm'
    , fontWeight: 'bold'
  }
  , '> button': {
    display: 'none'
    , position: 'absolute'
    , right: 0
    , top: 0
  }
  , ':hover': {
    background: Basics.COLORS.primary.light
    , color: 'white'
  }
  , ':hover button': {
    display: 'inline-block'
  }
}))
