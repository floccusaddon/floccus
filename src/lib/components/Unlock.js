import browser from '../browser-api'
import { h } from 'hyperapp'
import { Component as Overlay } from './Overlay'
import * as Basics from './basics'

const { Input, Button, H2 } = Basics

export const state = {
  unlock: {
    error: null
  }
}

export const actions = {
  unlock: {
    setError: error => ({ error })
  },
  enterUnlockKey: key => async (state, actions) => {
    const background = await browser.runtime.getBackgroundPage()
    try {
      await background.controller.unlock(key)
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
        <H2>Unlock floccus</H2>
        <Input
          value={''}
          type="password"
          placeholder="Enter your unlock passphrase"
          oninput={e => {
            if (e.which === 13) {
              actions.enterUnlockKey(e.target.value)
            }
          }}
          oncreate={element => element.focus()}
        />
        <Button
          onclick={e => {
            const key = e.target.parentNode.querySelector('input').value
            actions.enterUnlockKey(key)
          }}
        >
          Unlock
        </Button>
      </div>
    </Overlay>
  )
}
