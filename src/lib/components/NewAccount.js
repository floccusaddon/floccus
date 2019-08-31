import browser from '../browser-api'

import Account from '../Account'
import { Component as Overlay } from './Overlay'
import * as Basics from './basics'
import picostyle from 'picostyle'

const style = picostyle(h)
const { H2, Button, P, Label } = Basics

export const state = {
  newAccount: {
    type: null
  }
}

export const actions = {
  newAccount: {
    setType: type => ({ type })
  },
  openNewAccount: () => async(state, actions) => {
    actions.switchView('newAccount')
  },
  createAccount: () => async(state, actions) => {
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
      <P>
        <Label>
          <input
            type="radio"
            name="type"
            value="nextcloud-folders"
            onchange={e => {
              actions.newAccount.setType(e.currentTarget.value)
            }}
          />
          {browser.i18n.getMessage('LabelAdapternextcloudfolders')}
        </Label>
        <br />
        {browser.i18n.getMessage('DescriptionAdapternextcloudfolders')}
      </P>
      <P>
        <Label>
          <input
            type="radio"
            name="type"
            value="nextcloud-legacy"
            onchange={e => {
              actions.newAccount.setType(e.currentTarget.value)
            }}
          />
          {browser.i18n.getMessage('LabelAdapternextcloud')}
        </Label>
        <br />

        {browser.i18n.getMessage('DescriptionAdapternextcloud')}
      </P>
      <P>
        <Label>
          <input
            type="radio"
            name="type"
            value="webdav"
            onchange={e => {
              actions.newAccount.setType(e.currentTarget.value)
            }}
          />
          {browser.i18n.getMessage('LabelAdapterwebdav')}
        </Label>
        <br />

        {browser.i18n.getMessage('DescriptionAdapterwebdav')}
      </P>

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
