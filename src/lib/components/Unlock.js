/* @jsx h */
import browser from '../browser-api'
import {h} from 'hyperapp'
import {Component as Overlay} from './Overlay'

export const state = {
  unlock: {
    error: null
  }
}

export const actions = {
  unlock: {
    setError: (error) => ({error})
  }
  , enterUnlockKey: (key) => async (state, actions) => {
    const background = await browser.runtime.getBackgroundPage()
    await background.controller.unlock(key)
    await actions.switchView('accounts')
  }
}

export const Component = () => (state, actions) => {
  return <Overlay>
    <div id="unlock">
      <h2>Unlock floccus</h2>
      <input value={''} type="password" className="unlockKey" placeholder="Enter your unlock passphrase" />
      <a class="btn" href="#" onclick={(e) => {
        e.preventDefault()
        const key = e.target.parentNode.querySelector('.unlockKey').value
        actions.enterUnlockKey(key)
      }}>Unlock</a>
    </div>
  </Overlay>
}
