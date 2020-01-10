import browser from '../browser-api'
import { h } from 'hyperapp'
import Account from '../Account'
import { Component as Overlay } from './Overlay'
import * as Basics from './basics'

const { H2, Button, P, Label, A } = Basics

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
      {[
        {
          href: 'https://www.paypal.me/marcelklehr1',
          label: browser.i18n.getMessage('LabelPaypal'),
          description: browser.i18n.getMessage('DescriptionPaypal')
        },
        {
          href: 'https://opencollective.com/floccus',
          label: browser.i18n.getMessage('LabelOpencollective'),
          description: browser.i18n.getMessage('DescriptionOpencollective')
        },
        {
          href: 'https://liberapay.com/marcelklehr/donate',
          label: browser.i18n.getMessage('LabelLiberapay'),
          description: browser.i18n.getMessage('DescriptionLiberapay')
        },
        {
          href: 'https://github.com/users/marcelklehr/sponsorship',
          label: browser.i18n.getMessage('LabelGithubsponsors'),
          description: browser.i18n.getMessage('DescriptionGithubsponsors')
        }
      ].map(processor => (
        <div>
          <P>
            <A href={processor.href}>{processor.label}</A>{' '}
            {processor.description}
          </P>
        </div>
      ))}
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
