import browser from '../browser-api'
import { h } from 'hyperapp'
import LocalTree from '../LocalTree'
import { Component as Overlay } from './Overlay'
import * as Basics from './basics'
import picostyle from 'picostyle'

const style = picostyle(h)
const Button = Basics.Button

export const state = {
  picker: {
    tree: null,
    openedFolders: {}
  }
}

export const actions = {
  picker: {
    setTree: tree => ({ tree }),
    loadTree: () => async (state, actions) => {
      let tree = (await browser.bookmarks.getTree())[0]
      actions.setTree(tree)
    },
    toggleFolder: folderId => state => ({
      openedFolders: {
        ...state.openedFolders,
        [folderId]: !state.openedFolders[folderId]
      }
    }),
    openFolder: folderId => state => ({
      openedFolders: { ...state.openedFolders, [folderId]: true }
    }),
    closeFolder: folderId => state => ({
      openedFolders: { ...state.openedFolders, [folderId]: false }
    })
  },
  openPicker: () => async (state, actions) => {
    await actions.picker.loadTree()
    actions.switchView('picker')
  },
  cancelPicker: () => (state, actions) => {
    actions.switchView('options')
  },
  setNodeFromPicker: localRoot => async (state, actions) => {
    const rootPath = decodeURIComponent(
      await LocalTree.getPathFromLocalId(localRoot)
    )
    actions.options.update({ data: { localRoot, rootPath } })
    actions.switchView('options')
  }
}

export const Component = () => (state, actions) => {
  let tree = state.picker.tree
  return (
    <Overlay>
      <div id="picker">
        {tree.id ? (
          <Subtree tree={tree} root={true} />
        ) : (
          tree.children.map(node => <Subtree tree={node} />)
        )}
      </div>
      <Button
        onclick={e => {
          actions.cancelPicker()
        }}
      >
        Cancel
      </Button>
    </Overlay>
  )
}

const Subtree = ({ tree, root }) => (state, actions) => {
  let empty =
    tree.children && !tree.children.filter(child => !!child.children).length
  return !tree.children ? (
    ''
  ) : (
    <Item>
      <ItemLabel
        onclick={e => {
          if (root) return
          if (empty) return
          actions.picker.toggleFolder(tree.id)
        }}
        active={root || state.picker.openedFolders[tree.id]}
        class={empty || root ? 'untoggleable' : ''}
      >
        {root || state.picker.openedFolders[tree.id] ? '📂 ' : '📁 '}
        {tree.title || <i>Untitled folder</i>}
        <Button
          className="choose"
          onclick={e => {
            actions.setNodeFromPicker(tree.id)
            return false
          }}
        >
          select
        </Button>
      </ItemLabel>
      {!empty && (root || state.picker.openedFolders[tree.id]) ? (
        <div className="children">
          {tree.children.map(node => <Subtree tree={node} />)}
        </div>
      ) : (
        ''
      )}
    </Item>
  )
}

const Item = style('div')({
  padding: '.1cm 0',
  margin: '0',
  '> .children': {
    borderLeft: `1px ${Basics.COLORS.primary.light} solid`,
    padding: '.2cm 0 0 .2cm',
    margin: '0'
  }
})
const ItemLabel = style('div')(props => ({
  padding: '.15cm',
  margin: '0',
  ':not(.untoggleable)': {
    cursor: 'pointer'
  },
  position: 'relative',
  borderRadius: '.1cm',
  overflow: 'auto',
  background: props.active ? Basics.COLORS.primary.light : 'transparent',
  color: props.active ? 'white' : Basics.COLORS.primary.dark,
  '::first-letter': {
    fontSize: '.5cm',
    fontWeight: 'bold'
  },
  ':not(.untoggleable):hover': {
    background: Basics.COLORS.primary.light,
    color: 'white'
  },
  '> button': {
    display: 'inline-block',
    float: 'right',
    height: '.6cm',
    padding: '.07cm',
    boxSizing: 'border-box'
  }
}))
