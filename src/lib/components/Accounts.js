import browser from '../browser-api'
import Logger from '../Logger'
import picostyle from 'picostyle'
import { h } from 'hyperapp'
import Account from '../Account'
import * as Basics from './basics'

const style = picostyle(h)

const { Button, InputGroup, Select, Option, Label, Account: AccountEl } = Basics

export const state = {
  accounts: {
    accounts: {},
    secured: false,
    creationType: 'nextcloud'
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
    setCreationType: type => ({ creationType: type })
  },
  createAccount: () => async (state, actions) => {
    let account = await Account.create(
      Account.getDefaultValues(state.accounts.creationType)
    )
    await actions.accounts.load()
    await actions.openOptions(account.id)
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
        <InputGroup fullWidth={true}>
          <Select
            style={{ width: '78%' }}
            onchange={e => {
              actions.accounts.setCreationType(e.currentTarget.value)
            }}
          >
            <option value="nextcloud">Nextcloud Bookmarks</option>
            <option value="webdav">XBEL in WebDAV</option>
          </Select>
          <Button
            onclick={e => {
              actions.createAccount()
            }}
          >
            Add Account
          </Button>
        </InputGroup>
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
            Secure your credentials
          </Label>
        </div>
        <div class="debugging-tools">
          <a
            href="#"
            onclick={e => {
              actions.downloadLogs()
              e.preventDefault()
            }}
          >
            Debug logs
          </a>{' '}
          <a href="./test.html">run tests</a>
        </div>
      </div>
    </AccountsStyle>
  )
}

const AccountsStyle = style('div')({
  ' .debugging-tools': {
    display: 'block',
    margin: '3px',
    float: 'right',
    fontSize: '9px'
  },
  ' .debugging-tools a': {
    color: '#3893cc !important',
    display: 'inline-block',
    marginLeft: '3px'
  },
  ' .wrapper': {
    margin: '0 20px'
  }
})
