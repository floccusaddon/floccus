/* @jsx h */
import browser from '../browser-api'
import {h} from 'hyperapp'
import {Component as Overlay} from './Overlay'
import * as Basics from './basics'

const {Input, Button, H2} = Basics

export const state = {
  setupKey: {
    error: null
  }
}

export const actions = {
  setupKey: {
    setError: (error) => ({error})
  }
  , setKey: ({key1, key2}) => async (state, actions) => {
    if (key1 !== key2) {
      actions.setupKey.setError('Passphrases don\'t match.')
      return
    }
    const background = await browser.runtime.getBackgroundPage()
    try {
      await background.controller.setKey(key1)
      await actions.switchView('accounts')
    } catch (e) {
      actions.setupKey.setError(e.message)
    }
  }
  , unsetKey: () => async (state, actions) => {
    const background = await browser.runtime.getBackgroundPage()
    await background.controller.unsetKey()
    await actions.switchView('accounts')
  }
}

export const Component = () => (state, actions) => {
  return <Overlay>
    <div id="setKey">
      <H2>Set a passphrase for floccus</H2>
      <p>{state.setupKey.error ? state.setupKey.error : ''}</p>
      <Input value={''} type="password" placeholder="Enter your unlock passphrase" />
      <Input value={''} type="password" placeholder="Enter passphrase a second time" />
      <Button onclick={(e) => {
        let inputs = e.target.parentNode.querySelectorAll('input')
        actions.setKey({key1: inputs[0].value, key2: inputs[1].value})
      }}>Secure accounts</Button>
    </div>
  </Overlay>
}
