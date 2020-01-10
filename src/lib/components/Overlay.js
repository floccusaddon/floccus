import { h } from 'hyperapp'
import picostyle from 'picostyle'
import * as Basics from './basics'

const style = picostyle(h)

export const state = {}
export const actions = {}

export const Component = (_, children) => (state, actions) => {
  return (
    <StyleComponent
      id="overlay"
      onclick={function(e) {
        if (e.target.id !== 'overlay') return
        actions.switchView('accounts')
      }}
    >
      <div style={{ background: Basics.COLORS.primary.background }}>
        {children}
      </div>
    </StyleComponent>
  )
}

const StyleComponent = style('div')({
  position: 'fixed',
  top: 0,
  bottom: 0,
  right: 0,
  left: 0,
  background: 'rgba(130, 130, 130, .6)',
  '> *': {
    position: 'absolute',
    top: '.5cm',
    right: '.5cm',
    bottom: '.5cm',
    left: '.5cm',
    padding: '.5cm',
    background: 'white',
    overflowY: 'scroll',
    overflowX: 'hidden'
  }
})
