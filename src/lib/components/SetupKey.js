/* @jsx h */
import browser from '../browser-api'
import {h} from 'hyperapp'
import {Component as Overlay} from './Overlay'

export const state = {
  setupKey: {
    error: null
  }
}

export const actions = {
  setupKey: {
    setError: (error) => ({error})
  }
  , setKey: ({key, key2}) => async (state, actions) => {
    if (key !== key2) {
      actions.setupKey.setError('Passphrases don\'t match.')
      return
    }
    const background = await browser.runtime.getBackgroundPage()
    try {
      await background.controller.setKey(key)
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
      <h2>Set a passphrase for floccus</h2>
      <p>{state.setupKey.error ? state.setupKey.error : ''}</p>
      <input value={''} type="password" className="unlockKey" placeholder="Enter your unlock passphrase" />
      <input value={''} type="password" className="unlockKey" placeholder="Enter passphrase a second time" />
      <a className="btn" href="#" onclick={(e) => {
        e.preventDefault()
        let inputs = e.target.parentNode.querySelectorAll('.unlockKey')
        actions.setKey(inputs[0].value, inputs[1].value)
      }}>Secure accounts</a>
    </div>
  </Overlay>
}
