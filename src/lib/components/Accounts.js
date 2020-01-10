import browser from '../browser-api'
import Logger from '../Logger'
import picostyle from 'picostyle'
import { h } from 'hyperapp'
import Account from '../Account'
import * as Basics from './basics'

const FLOCCUS_VERSION = require('../../../package.json').version

const style = picostyle(h)

const {
  H1,
  Button,
  InputGroup,
  Select,
  Option,
  Label,
  P,
  Account: AccountEl
} = Basics

export const state = {
  accounts: {
    accounts: {},
    secured: false
  }
}

export const actions = {
  accounts: {
    setList: accounts => ({
      accounts
    }),
    setSecured: secured => ({ secured }),
    load: () => async (state, actions) => {
      const accountsArray = await Account.getAllAccounts()
      const accounts = {}
      accountsArray.forEach(acc => {
        accounts[acc.id] = acc
      })

      const { accountsLocked } = await browser.storage.local.get({
        accountsLocked: null
      })
      actions.setSecured(accountsLocked)
      actions.setList(accounts)
    },
    sync: accountId => async (state, actions) => {
      const background = await browser.runtime.getBackgroundPage()
      background.syncAccount(accountId)
    },
    cancelSync: accountId => async (state, actions) => {
      const background = await browser.runtime.getBackgroundPage()
      background.controller.cancelSync(accountId)
    },
    setCreationType: type => ({ creationType: type })
  },
  downloadLogs: async () => {
    await Logger.downloadLogs()
  }
}

export const Component = () => (state, actions) => {
  return (
    <AccountsStyle>
      <div id="accounts">
        {Object.keys(state.accounts.accounts).map(accountId => (
          <AccountEl account={state.accounts.accounts[accountId]} />
        ))}
      </div>
      <div class="wrapper">
        <Button
          primary
          fullWidth={true}
          onclick={e => {
            actions.openNewAccount()
          }}
        >
          {browser.i18n.getMessage('LabelAddaccount')}
        </Button>
        <p> </p>
        <div class="security">
          <Label>
            <input
              type="checkbox"
              checked={state.accounts.secured}
              onclick={e => {
                if (e.currentTarget.checked) {
                  actions.switchView('setupKey')
                } else {
                  actions.unsetKey()
                }
              }}
            />{' '}
            {browser.i18n.getMessage('LabelSecurecredentials')}
          </Label>
        </div>
        <div class="footer">
          <div class="debugging-tools">
            <a href="options.html" target="_blank">
              {browser.i18n.getMessage('LabelOpenintab')}
            </a>
            <a
              href="#"
              onclick={e => {
                actions.downloadLogs()
                e.preventDefault()
              }}
            >
              📜 {browser.i18n.getMessage('LabelDebuglogs')}
            </a>
            <a
              href="#"
              onclick={e => {
                actions.openFunding()
                e.preventDefault()
              }}
            >
              💙 {browser.i18n.getMessage('LabelFunddevelopment')}
            </a>
          </div>
          <div class="branding">
            <a href="https://github.com/marcelklehr/floccus" target="_blank">
              <img src="../../icons/logo.svg" border="0" /> floccus
            </a>
          </div>
        </div>
      </div>
    </AccountsStyle>
  )
}

const AccountsStyle = style('div')({
  ' .footer': {
    fontSize: '11px',
    paddingTop: '30px',
    marginBottom: '-20px',
    overflow: 'auto'
  },
  ' .footer a': {
    color: '#3893cc !important',
    textDecoration: 'none'
  },
  ' .footer a:hover': {
    textDecoration: 'underline'
  },
  ' .debugging-tools': {
    float: 'right'
  },
  ' .debugging-tools a': {
    display: 'inline-block',
    marginLeft: '10px'
  },
  ' .branding': {
    float: 'left'
  },
  ' .branding a': {
    textDecoration: 'none !important'
  },
  ' .branding img': {
    width: 'auto',
    height: '3em',
    position: 'relative',
    verticalAlign: 'top',
    top: '-1em'
  },
  ' .wrapper': {
    position: 'relative',
    background: 'white',
    margin: '0',
    padding: '10px 20px 20px 25px' // top is actually 25px as well, because of InputGroup
  }
})
