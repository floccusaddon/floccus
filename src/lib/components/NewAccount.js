import browser from '../browser-api'
import { h } from 'hyperapp'
import Account from '../Account'
import { Component as Overlay } from './Overlay'
import * as Basics from './basics'
import picostyle from 'picostyle'

const style = picostyle(h)
const { H2, Button, P, Label } = Basics

export const state = {
  newAccount: {
    type: 'nextcloud-folders'
  }
}

export const actions = {
  newAccount: {
    setType: type => ({ type })
  },
  openNewAccount: () => async (state, actions) => {
    actions.switchView('newAccount')
  },
  createAccount: () => async (state, actions) => {
    let account = await Account.create(
      Account.getDefaultValues(state.newAccount.type)
    )
    await actions.accounts.load()
    await actions.openOptions(account.id)
  },
  cancelNewAccount: () => (state, actions) => {
    actions.switchView('accounts')
  }
}

export const Component = () => (state, actions) => {
  return (
    <Overlay>
      <H2>{browser.i18n.getMessage('LabelChooseadapter')}</H2>
      {[
        {
          type: 'nextcloud-folders',
          label: browser.i18n.getMessage('LabelAdapternextcloudfolders'),
          description: browser.i18n.getMessage(
            'DescriptionAdapternextcloudfolders'
          )
        },
        {
          type: 'nextcloud-legacy',
          label: browser.i18n.getMessage('LabelAdapternextcloud'),
          description: browser.i18n.getMessage('DescriptionAdapternextcloud')
        },
        {
          type: 'webdav',
          label: browser.i18n.getMessage('LabelAdapterwebdav'),
          description: browser.i18n.getMessage('DescriptionAdapterwebdav')
        }
      ].map(adapter => (
        <div>
          <P>
            <Label>
              <input
                type="radio"
                name="type"
                value={adapter.type}
                checked={state.newAccount.type === adapter.type}
                onchange={e => {
                  actions.newAccount.setType(adapter.type)
                }}
              />
              {adapter.label}
            </Label>
          </P>
          <P style={{ paddingLeft: '20px' }}>{adapter.description}</P>
        </div>
      ))}

      <Button
        primary
        onclick={e => {
          actions.createAccount()
        }}
      >
        {browser.i18n.getMessage('LabelAddaccount')}
      </Button>
      <Button
        onclick={e => {
          actions.cancelNewAccount()
        }}
      >
        {browser.i18n.getMessage('LabelCancel')}
      </Button>
    </Overlay>
  )
}
