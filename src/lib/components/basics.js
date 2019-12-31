import picostyle from 'picostyle'
import humanizeDuration from 'humanize-duration'
import { h } from 'hyperapp'
import browser from '../browser-api'
import PathHelper from '../PathHelper'

const style = picostyle(h)

export const COLORS = {
  primaryContour: '#3893cc',
  primary: {
    plane: '#53a9df',
    light: '#68b4e3',
    dark: '#3893cc',
    background: '#eaf2f7'
  },
  text: '#444'
}

export const HEIGHT_CONTROLS = '33px'
export const PADDING_CONTROLS = '7px'
export const BORDER_RADIUS = '15px'

export const P = style('p')({
  color: COLORS.text
})

export const H1 = style('h1')(props => ({
  color: props.inverted ? 'white' : COLORS.primary.plane,
  marginBottom: '7px',
  marginTop: '25px',
  ':first-child': {
    marginTop: '0'
  }
}))
export const H2 = style('h2')({
  color: COLORS.primary.plane,
  marginBottom: '7px',
  marginTop: '25px',
  ':first-child': {
    marginTop: '0'
  }
})
export const H3 = style('h3')({
  color: COLORS.primary.plane,
  marginBottom: '7px',
  marginTop: '25px'
})
export const H4 = style('h4')({
  color: COLORS.primary.plane,
  marginBottom: '7px',
  marginTop: '25px'
})

export const Input = style('input')({
  '[type=text],[type=password]': {
    width: '100%',
    boxSizing: 'border-box'
  },
  fontSize: '15px !important',
  border: `1px ${COLORS.primary.dark} solid`,
  borderRadius: BORDER_RADIUS,
  background: 'white',
  color: COLORS.text,
  padding: PADDING_CONTROLS,
  margin: '2px'
})

export const InputGroup = style('div')(props => ({
  display: props.fullWidth ? 'block' : 'inline-block',
  width: props.fullWidth ? '100%' : 'auto',
  padding: '0',
  margin: props.fullWidth ? '15px auto' : '3px 3px 3px 0',
  '> *': {
    margin: '3px 0 3px 0 !important',
    borderRadius: '0 !important'
  },
  '> :first-child': {
    borderTopLeftRadius: BORDER_RADIUS + ' !important',
    borderBottomLeftRadius: BORDER_RADIUS + '!important'
  },
  '> :last-child': {
    borderTopRightRadius: BORDER_RADIUS + '!important',
    borderBottomRightRadius: BORDER_RADIUS + '!important'
  }
}))

export const Select = style('select')(props => ({
  display: props.fullWidth ? 'block' : 'inline-block',
  width: props.fullWidth ? '100%' : 'auto',
  height: HEIGHT_CONTROLS,
  cursor: 'pointer',
  padding: PADDING_CONTROLS,
  margin: props.fullWidth ? '15px auto' : '3px 3px 3px 0',
  boxSizing: 'border-box',
  color: 'white',
  textDecoration: 'none',
  textAlign: 'center',
  backgroundColor: props.active ? COLORS.primary.light : COLORS.primary.plane,
  ':hover': {
    backgroundColor: COLORS.primary.light
  },
  border: `1px ${COLORS.primary.dark} solid`,
  borderRadius: BORDER_RADIUS,
  '[disabled]': {
    color: 'white !important',
    backgroundColor: '#999 !important',
    cursor: 'default'
  }
}))

export const Button = style('button')(props => ({
  display: props.fullWidth ? 'block' : 'inline-block',
  width: props.fullWidth ? '100%' : 'auto',
  height: HEIGHT_CONTROLS,
  cursor: 'pointer',
  padding: PADDING_CONTROLS,
  margin: props.fullWidth ? '15px auto' : '3px 3px  3px 0',
  boxSizing: 'border-box',
  color: props.primary ? 'white' : COLORS.primary.dark,
  textDecoration: 'none',
  textAlign: 'center',
  backgroundColor: props.primary
    ? props.active
      ? COLORS.primary.light
      : COLORS.primary.plane
    : props.active
      ? COLORS.primary.background
      : 'white',
  ':hover': {
    backgroundColor: props.primary
      ? COLORS.primary.light
      : COLORS.primary.background
  },
  border: `1px ${COLORS.primary.dark} solid`,
  borderRadius: BORDER_RADIUS,
  '[disabled]': {
    color: 'white !important',
    backgroundColor: '#999 !important',
    cursor: 'default'
  }
}))

export const Label = style('label')({
  color: COLORS.primary.dark
})

export const Account = ({ account }) => (state, actions) => {
  const data = account.getData()
  const pathArray = PathHelper.pathToArray(
    data.rootPath || browser.i18n.getMessage('LabelRootfolder')
  )
  const folderName = pathArray[pathArray.length - 1]
  return (
    <AccountStyle key={account.id}>
      <div class="controls">
        <AccountStatus account={account} />
      </div>
      <H2>{folderName}</H2>
      <div class="small">
        <code style={{ color: COLORS.primary.light }}>
          {data.type + '://' + account.getLabel()}
        </code>
      </div>
      <AccountStatusDetail account={account} />
      <div class="controls">
        <Button
          onclick={e => {
            e.preventDefault()
            actions.openOptions(account.id)
          }}
        >
          {browser.i18n.getMessage('LabelOptions')}
        </Button>
        <Button
          disabled={!data.enabled}
          onclick={e => {
            e.preventDefault()
            if (!data.syncing) actions.accounts.sync(account.id)
            if (data.syncing) actions.accounts.cancelSync(account.id)
          }}
        >
          {!data.syncing
            ? browser.i18n.getMessage('LabelSyncnow')
            : browser.i18n.getMessage('LabelCancelsync')}
        </Button>
      </div>
      <Label>
        <Input
          type="checkbox"
          checked={!!data.enabled}
          title={'Enable or disable account'}
          onclick={async e => {
            actions.options.setAccount(state.accounts.accounts[account.id])
            actions.options.setData(
              state.accounts.accounts[account.id].getData()
            )
            actions.options.update({ data: { enabled: e.target.checked } })
            await actions.saveOptions()
          }}
        />{' '}
        {browser.i18n.getMessage('LabelEnabled')}
      </Label>
    </AccountStyle>
  )
}

const AccountStyle = style('div')({
  boxShadow: 'rgba(0, 0,0, 0.15) 0px 2px 10px',
  borderRadius: BORDER_RADIUS,
  backgroundColor: 'white',
  padding: '15px',
  paddingTop: '-10px',
  margin: '20px',
  color: COLORS.text,
  overflow: 'auto',
  ' h2': {
    marginTop: '0'
  },
  ' input[type=text]': {
    width: '100%'
  },
  ' .small': {
    fontSize: '.85em'
  },
  'input[type=checkbox]': {
    marginTop: '10px'
  },
  ' .controls': {
    float: 'right'
  },
  ' .controls :last-child': {
    marginRight: '0'
  }
})

export const AccountStatusDetail = ({ account }) => (state, actions) => {
  const data = account.getData()
  return (
    <AccountStatusDetailStyle>
      {data.error ? (
        data.error
      ) : data.syncing ? (
        <Progress value={data.syncing} />
      ) : data.lastSync ? (
        browser.i18n.getMessage(
          'StatusLastsynced',
          humanizeDuration(Date.now() - data.lastSync, {
            largest: 1,
            round: true
          })
        )
      ) : (
        browser.i18n.getMessage('StatusNeversynced')
      )}
    </AccountStatusDetailStyle>
  )
}

const AccountStatusDetailStyle = style('div')({
  margin: '10px 0',
  color: COLORS.primary.dark
})

export const AccountStatus = ({ account }) => (state, actions) => {
  const data = account.getData()
  return (
    <AccountStatusStyle>
      {data.syncing ? (
        '↻ ' + browser.i18n.getMessage('StatusSyncing')
      ) : data.error ? (
        <span style={{ color: '#8e3939' }}>
          ✘ {browser.i18n.getMessage('StatusError')}
        </span>
      ) : !data.enabled ? (
        <span style={{ color: 'rgb(139, 39, 164)' }}>
          ∅ {browser.i18n.getMessage('StatusDisabled')}
        </span>
      ) : (
        <span style={{ color: '#3d8e39' }}>
          ✓ {browser.i18n.getMessage('StatusAllgood')}
        </span>
      )}
    </AccountStatusStyle>
  )
}

const AccountStatusStyle = style('span')({
  display: 'inline-block',
  margin: '3px 3px 3px 0',
  padding: '3px',
  color: COLORS.primary.dark
})

export const OptionSyncFolder = ({ account }) => (state, actions) => {
  return (
    <div>
      <H4>{browser.i18n.getMessage('LabelLocalfolder')}</H4>
      <p>{browser.i18n.getMessage('DescriptionLocalfolder')} </p>
      <Input
        type="text"
        disabled
        placeholder={browser.i18n.getMessage('LabelRootfolder')}
        value={account.rootPath}
      />
      <br />
      <Button
        title={browser.i18n.getMessage('DescriptionReset')}
        disabled={!!account.syncing}
        onclick={e => {
          e.preventDefault()
          !account.syncing &&
            actions.options.update({
              data: { ...account, localRoot: null, rootPath: '*newly created*' }
            })
        }}
      >
        {browser.i18n.getMessage('LabelReset')}
      </Button>
      <Button
        title={browser.i18n.getMessage('DescriptionChoosefolder')}
        disabled={account.syncing}
        onclick={e => {
          e.preventDefault()
          actions.openPicker()
        }}
      >
        {browser.i18n.getMessage('LabelChoosefolder')}
      </Button>
    </div>
  )
}

export const OptionDelete = ({ account }) => (state, actions) => {
  return (
    <div>
      <H4>🗑 {browser.i18n.getMessage('LabelRemoveaccount')}</H4>
      <Button
        onclick={e => {
          e.preventDefault()
          actions.deleteAndCloseOptions()
        }}
      >
        {browser.i18n.getMessage('DescriptionRemoveaccount')}
      </Button>
    </div>
  )
}

export const OptionResetCache = ({ account }) => (state, actions) => {
  return (
    <div>
      <H4>🔁 {browser.i18n.getMessage('LabelResetCache')}</H4>
      <p>{browser.i18n.getMessage('DescriptionResetCache')}</p>
      <Label>
        <Input
          type="checkbox"
          onclick={e => {
            actions.options.update({
              data: {
                ...account,
                reset: e.target.checked
              }
            })
          }}
        />
        {browser.i18n.getMessage('LabelResetCache')}
      </Label>
    </div>
  )
}

export const OptionParallelSyncing = ({ account }) => (state, actions) => {
  return (
    <div>
      <H4>🚴 {browser.i18n.getMessage('LabelParallelsync')}</H4>
      <p>{browser.i18n.getMessage('DescriptionParallelsync')}</p>
      <Label>
        <Input
          type="checkbox"
          onclick={e => {
            actions.options.update({
              data: {
                ...account,
                parallel: e.target.checked
              }
            })
          }}
          checked={state.options.data.parallel}
        />
        {browser.i18n.getMessage('LabelParallelsync')}
      </Label>
    </div>
  )
}

export const OptionSyncInterval = ({ account }) => (state, actions) => {
  return (
    <div>
      <H4>⏱ {browser.i18n.getMessage('LabelSyncinterval')}</H4>
      <p>{browser.i18n.getMessage('DescriptionSyncinterval')}</p>
      <Input
        type="number"
        oninput={e => {
          actions.options.update({
            data: {
              ...account,
              syncInterval: e.target.value
            }
          })
        }}
        value={state.options.data.syncInterval}
      />
    </div>
  )
}

export const OptionSyncStrategy = ({ account }) => (state, actions) => {
  const setStrategy = strategy => {
    actions.options.update({
      data: {
        ...account,
        strategy
      }
    })
  }
  return (
    <OptionSyncStrategyStyle>
      <H4>⚖ {browser.i18n.getMessage('LabelStrategy')}</H4>
      <p>{browser.i18n.getMessage('DescriptionStrategy')}</p>
      <Label>
        <Input
          type="radio"
          name="syncstrategy"
          onclick={e => setStrategy('default')}
          checked={
            state.options.data.strategy === 'default' ||
            !state.options.data.strategy
          }
        />
        {browser.i18n.getMessage('LabelStrategydefault')}
      </Label>
      <Label>
        <Input
          type="radio"
          name="syncstrategy"
          onclick={e => setStrategy('slave')}
          checked={state.options.data.strategy === 'slave'}
        />
        {browser.i18n.getMessage('LabelStrategyslave')}
      </Label>
      <Label>
        <Input
          type="radio"
          name="syncstrategy"
          onclick={e => setStrategy('overwrite')}
          checked={state.options.data.strategy === 'overwrite'}
        />
        {browser.i18n.getMessage('LabelStrategyoverwrite')}
      </Label>
    </OptionSyncStrategyStyle>
  )
}
const OptionSyncStrategyStyle = style('div')(props => ({
  '> label': {
    display: 'block'
  }
}))

export const A = style('a')({
  color: '#3893cc !important',
  textDecoration: 'none',
  ':hover': {
    textDecoration: 'underline'
  }
})

export const Progress = ({ value }) => {
  return (
    <ProgressStyle value={value}>
      <div />
    </ProgressStyle>
  )
}
const ProgressStyle = style('div')(props => ({
  display: 'inline-block',
  margin: '3px 3px 3px 0',
  padding: '0',
  height: '1em',
  width: '90%',
  border: `1px solid ${COLORS.primary.dark}`,
  borderRadius: BORDER_RADIUS,
  '> div': {
    height: '100%',
    margin: '0',
    background: COLORS.primary.plane,
    display: 'inline-block',
    transition: 'width .5s',
    width: props.value * 100 + '%'
  }
}))
