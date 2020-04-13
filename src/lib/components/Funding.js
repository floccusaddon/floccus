import browser from '../browser-api'
import { h } from 'hyperapp'
import { Component as Overlay } from './Overlay'
import { H2, Button, P, Label, FundingOptions } from './basics'

export const state = {}

export const actions = {
  openFunding: () => async (state, actions) => {
    actions.switchView('funding')
  },
  cancelFunding: () => (state, actions) => {
    actions.switchView('accounts')
  }
}

export const Component = () => (state, actions) => {
  return (
    <Overlay>
      <H2>{browser.i18n.getMessage('LabelFunddevelopment')}</H2>
      <P>
        <Label>{browser.i18n.getMessage('DescriptionFunddevelopment')}</Label>
      </P>
      <FundingOptions />
      <Button
        onclick={e => {
          actions.cancelFunding()
        }}
      >
        {browser.i18n.getMessage('LabelCancel')}
      </Button>
    </Overlay>
  )
}
