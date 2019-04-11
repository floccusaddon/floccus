import browser from '../browser-api'
import { h } from 'hyperapp'
import { Component as Overlay } from './Overlay'
import * as Basics from './basics'

const { Input, Button, H2 } = Basics

export const state = {
  unlock: {
    error: null,
    key: ''
  }
}

export const actions = {
  unlock: {
    setError: error => ({ error }),
    updateKey: key => ({ key })
  },
  submitUnlockKey: () => async (state, actions) => {
    const background = await browser.runtime.getBackgroundPage()
    try {
      await background.controller.unlock(state.unlock.key)
    } catch (e) {
      console.log(e.message)
      return
    }
    await actions.switchView('accounts')
  }
}

export const Component = () => (state, actions) => {
  return (
    <Overlay>
      <div id="unlock">
        <H2>{browser.i18n.getMessage('LabelUnlock')}</H2>
        <Input
          value={state.unlock.key}
          type="password"
          placeholder={browser.i18n.getMessage('LabelKey')}
          onkeydown={e => {
            if (e.which === 13) {
              actions.enterUnlockKey(e.target.value)
            }
          }}
          oninput={e => {
            const key = e.target.value
            actions.unlock.updateKey(key)
          }}
          oncreate={element => element.focus()}
        />
        <Button
          onclick={e => {
            actions.submitUnlockKey()
          }}
        >
          {browser.i18n.getMessage('LabelUnlock')}
        </Button>
      </div>
    </Overlay>
  )
}
