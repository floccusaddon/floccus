/* @jsx h */
import {h} from 'hyperapp'

export const state = {}
export const actions = {}

export const Component = (_, children) => (state, actions) => {
  return <div id="overlay" onclick={function (e) {
    if (e.target.id !== 'overlay') return
    actions.switchView('accounts')
  }}>
    {children}
  </div>
}
