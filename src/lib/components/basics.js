import picostyle from 'picostyle'
import {h} from 'hyperapp'

const style = picostyle(h)

export const COLORS = {
  primaryContour: '#3893cc'
  , primary: {
    plane: '#53a9df'
    , light: '#68b4e3'
    , dark: '#3893cc'
  }
  , text: '#444'
}
export const PADDING_CONTROLS = '.15cm'
export const BORDER_RADIUS = '.1cm'

export const H1 = style('h1')({
  color: COLORS.primary.plane
})
export const H2 = style('h2')({
  color: COLORS.primary.plane
})
export const H3 = style('h3')({
  color: COLORS.primary.plane
})
export const H4 = style('h4')({
  color: COLORS.primary.plane
})

export const Input = style('input')({
  width: '90%'
  , fontSize: '.38cm !important'
  , border: `1px ${COLORS.primary.dark} solid`
  , borderRadius: BORDER_RADIUS
  , background: 'white'
  , color: COLORS.text
  , padding: PADDING_CONTROLS
})

export const Button = style('button')(props => ({
  display: props.fullWidth ? 'block' : 'inline-block'
  , width: props.fullWidth ? '95%' : 'auto'
  , cursor: 'pointer'
  , padding: '.15cm'
  , margin: props.fullWidth ? '.4cm auto' : '.1cm .1cm .1cm 0'
  , color: 'white'
  , textDecoration: 'none'
  , textAlign: 'center'
  , backgroundColor: props.active ? COLORS.primary.light : COLORS.primary.plane
  , ':hover': {
    backgroundColor: COLORS.primary.light
  }
  , border: `1px ${COLORS.primary.dark} solid`
  , borderRadius: BORDER_RADIUS
  , '[disabled]': {
    color: 'white !important'
    , backgroundColor: '#999 !important'
    , cursor: 'default'
  }
}))

export const Label = style('label')({
  color: COLORS.primary.dark
})

export const A = style('a')({
})
