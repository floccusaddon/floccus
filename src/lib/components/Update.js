import browser from '../browser-api'
import { h } from 'hyperapp'
import { Component as Overlay } from './Overlay'
import { H2, Button, P, Label, FundingOptions, A, H3 } from './basics'
import { version as VERSION } from '../../../package.json'

export const state = {}

export const actions = {
  openUpdate: () => async (state, actions) => {
    actions.switchView('update')
  },
  cancelUpdate: () => (state, actions) => {
    actions.switchView('accounts')
  }
}

export const Component = () => (state, actions) => {
  return (
    <Overlay>
      <H2>{browser.i18n.getMessage('LabelUpdated')}</H2>
      <P>{browser.i18n.getMessage('DescriptionUpdated')}</P>
      <P>
        <A
          href={`https://github.com/marcelklehr/floccus/releases/tag/v${VERSION}`}
        >
          {browser.i18n.getMessage('LabelReleaseNotes')}
        </A>
      </P>

      <H3>{browser.i18n.getMessage('LabelFunddevelopment')}</H3>
      <P>{browser.i18n.getMessage('DescriptionFunddevelopment')}</P>
      <FundingOptions />
      <Button
        onclick={e => {
          actions.cancelUpdate()
        }}
      >
        {browser.i18n.getMessage('LabelCancel')}
      </Button>
    </Overlay>
  )
}
