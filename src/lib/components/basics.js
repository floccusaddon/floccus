import picostyle from 'picostyle'
import humanizeDuration from 'humanize-duration'
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
  , marginBottom: '.1cm'
})
export const H2 = style('h2')({
  color: COLORS.primary.plane
  , marginBottom: '.1cm'
})
export const H3 = style('h3')({
  color: COLORS.primary.plane
  , marginBottom: '.1cm'
})
export const H4 = style('h4')({
  color: COLORS.primary.plane
  , marginBottom: '.1cm'
})

export const Input = style('input')({
  width: '90%'
  , fontSize: '.38cm !important'
  , border: `1px ${COLORS.primary.dark} solid`
  , borderRadius: BORDER_RADIUS
  , background: 'white'
  , color: COLORS.text
  , padding: PADDING_CONTROLS
  , margin: '.05cm'
})

export const Button = style('button')(props => ({
  display: props.fullWidth ? 'block' : 'inline-block'
  , width: props.fullWidth ? '95%' : 'auto'
  , cursor: 'pointer'
  , padding: PADDING_CONTROLS
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

export const Account = ({account}, children) => (state, actions) => {
  return <AccountStyle key={account.id}>
    {children}
  </AccountStyle>
}

const AccountStyle = style('div')({
  borderBottom: `1px ${COLORS.primary.dark} solid`
  , padding: '.4cm 0'
  , marginBottom: '.4cm'
  , color: COLORS.text
  , 'table': {
    border: 'none'
    , width: '100%'
    , minWidth: '12cm'
  }
  , 'td': {
    width: 'auto'
  }
  , 'td:first-child': {
    width: '4.5cm'
    , textAlign: 'right'
    , color: COLORS.primary.dark
  }
})

export const AccountStatusDetail = ({account}) => (state, actions) => {
  const data = account
  return <AccountStatusDetailStyle>{
    data.error
      ? data.error
      : data.syncing === 'initial'
        ? 'Syncing from scratch. This may take a longer than usual...'
        : 'Last synchronized: ' + (
          data.lastSync
            ? humanizeDuration(Date.now() - data.lastSync, {largest: 1, round: true}) + ' ago'
            : 'never'
        )
  }</AccountStatusDetailStyle>
}

const AccountStatusDetailStyle = style('div')({
  margin: '.1cm'
  , padding: '.1cm'
  , color: COLORS.primary.dark
})

export const AccountStatus = ({account}) => (state, actions) => {
  const data = account
  return <AccountStatusStyle>{
    data.syncing
      ? '↻ Syncing...'
      : (data.error
        ? <span>✘ Error!</span>
        : <span>✓ all good</span>
      )
  }</AccountStatusStyle>
}

const AccountStatusStyle = style('span')({
  display: 'inline-block'
  , margin: '.1cm .1cm .1cm 0'
  , padding: '.1cm'
  , color: COLORS.primary.dark
})

export const OptionSyncFolder = ({account}) => (state, actions) => {
  return <div>
    <H4>Sync folder</H4>
    <Input type="text" disabled placeholder="*Root folder*" value={account.rootPath} /><br/>
    <Button title="Reset synchronized folder to create a new one" disabled={!!account.syncing} onclick={(e) => {
      e.preventDefault()
      !account.syncing && actions.accounts.update({accountId: account.id, data: {...account, localRoot: null}})
    }}>Reset</Button>
    <Button title="Set an existing folder to sync" disabled={account.syncing} onclick={(e) => {
      e.preventDefault()
      actions.openPicker(account.id)
    }}>Choose folder</Button>
  </div>
}

export const OptionDelete = ({account}) => (state, actions) => {
  return <div>
    <H4>Remove account</H4>
    <Button onclick={(e) => {
      e.preventDefault()
      actions.accounts.delete(account.id)
    }}>Delete this account</Button>
  </div>
}

export const Options = ({show}, children) => (state, actions) => {
  return show
    ? <OptionsStyle>{children}</OptionsStyle>
    : ''
}

const OptionsStyle = style('div')({
  borderLeft: `1px ${COLORS.primary.dark} solid`
  , paddingLeft: '.2cm'
})

export const A = style('a')({
})
