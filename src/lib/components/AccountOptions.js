import browser from '../browser-api'
import { h } from 'hyperapp'
import LocalTree from '../LocalTree'
import { Component as Overlay } from './Overlay'
import * as Basics from './basics'
import picostyle from 'picostyle'

const style = picostyle(h)
const { Button, H2 } = Basics

export const state = {
  options: {
    account: null,
    data: {}
  }
}

export const actions = {
  options: {
    setData: data => ({ data }),
    setAccount: account => ({ account }),
    update: ({ data }) => (state, actions) => {
      return {
        data: {
          ...state.data,
          ...data
        }
      }
    },
    updateAccount: () => async(state, actions) => {
      const account = state.account
      const data = state.data
      const originalData = account.getData()
      if (data.serverRoot === '/') data.serverRoot = ''
      data.syncInterval = parseInt(data.syncInterval)
      const newData = { ...originalData, ...data }
      if (JSON.stringify(newData) === JSON.stringify(originalData)) return
      if (
        originalData.serverRoot !== newData.serverRoot ||
        originalData.localRoot !== newData.localRoot ||
        newData.reset
      ) {
        await account.storage.initCache()
        await account.storage.initMappings()
      }
      await account.setData({ ...newData, reset: null })
    },
    delete: () => async(state, actions) => {
      const account = state.account
      await account.delete()
    }
  },
  openOptions: accountId => async(state, actions) => {
    const account = state.accounts.accounts[accountId]
    const data = account.getData()
    const localRoot = data.localRoot
    try {
      data.rootPath = localRoot
        ? decodeURIComponent(await LocalTree.getPathFromLocalId(localRoot))
        : '*newly created*'
    } catch (e) {
      data.rootPath = '*newly created*'
    }
    actions.options.setAccount(account)
    actions.options.setData(data)
    actions.switchView('options')
  },
  saveOptions: () => async(state, actions) => {
    await actions.options.updateAccount()
    actions.closeOptions()
  },
  deleteAndCloseOptions: () => async(state, actions) => {
    await actions.options.delete()
    actions.closeOptions()
  },
  closeOptions: () => (state, actions) => {
    actions.switchView('accounts')
  }
}

export const Component = () => (state, actions) => {
  const account = state.options.account
  return (
    <Overlay>
      <AccountOptionsStyle>
        <H2>
          {browser.i18n.getMessage(
            'LabelOptionsscreen',
            state.options.data.type
          )}
        </H2>
        {account.server.constructor.renderOptions(
          {
            account: state.options.data
          },
          data => actions.options.update({ data })
        )}
        <div class="actions">
          <Button onclick={() => actions.closeOptions()}>
            {browser.i18n.getMessage('LabelCancel')}
          </Button>
          <Button primary onclick={() => actions.saveOptions()}>
            {browser.i18n.getMessage('LabelSave')}
          </Button>
        </div>
      </AccountOptionsStyle>
    </Overlay>
  )
}
const AccountOptionsStyle = style('div')({
  color: Basics.COLORS.text,
  ' input': {
    marginBottom: '10px'
  },
  ' .actions': {
    float: 'right'
  }
})
