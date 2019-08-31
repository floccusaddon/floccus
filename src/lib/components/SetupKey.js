import browser from '../browser-api'

import { Component as Overlay } from './Overlay'
import * as Basics from './basics'

const { Input, Button, H2 } = Basics

export const state = {
  setupKey: {
    error: null,
    key1: '',
    key2: ''
  }
}

export const actions = {
  setupKey: {
    setError: error => ({ error }),
    updateKey1: key1 => ({ key1 }),
    updateKey2: key2 => ({ key2 })
  },
  setKey: () => async (state, actions) => {
    const { key1, key2 } = state.setupKey
    if (key1 !== key2) {
      actions.setupKey.setError("Passphrases don't match.")
      return
    }
    const background = await browser.runtime.getBackgroundPage()
    try {
      await background.controller.setKey(key1)
      await actions.switchView('accounts')
    } catch (e) {
      actions.setupKey.setError(e.message)
    }
  },
  unsetKey: () => async (state, actions) => {
    const background = await browser.runtime.getBackgroundPage()
    await background.controller.unsetKey()
    await actions.switchView('accounts')
  }
}

export const Component = () => (state, actions) => {
  return (
    <Overlay>
      <div id="setKey">
        <H2>{browser.i18n.getMessage('LabelSetkey')}</H2>
        <p>{browser.i18n.getMessage('DescriptionSetkey')}</p>
        <p>{state.setupKey.error ? state.setupKey.error : ''}</p>
        <Input
          value={state.setupKey.key1}
          type="password"
          placeholder={browser.i18n.getMessage('LabelKey')}
          oninput={e => {
            const key = e.target.value
            actions.setupKey.updateKey1(key)
          }}
        />
        <Input
          value={state.setupKey.key2}
          type="password"
          placeholder={browser.i18n.getMessage('LabelKey2')}
          oninput={e => {
            const key = e.target.value
            actions.setupKey.updateKey2(key)
          }}
        />
        <Button
          onclick={e => {
            actions.setKey()
          }}
        >
          {browser.i18n.getMessage('LabelSecurecredentials')}
        </Button>
      </div>
    </Overlay>
  )
}
