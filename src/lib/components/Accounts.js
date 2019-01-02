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
  Account: AccountEl
} = Basics

export const state = {
  accounts: {
    accounts: {},
    secured: false,
    creationType: 'nextcloud-folders'
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
            <option value="nextcloud-folders">
              Nextcloud Bookmarks (with folders)
            </option>
            <option value="nextcloud">Nextcloud Bookmarks (legacy)</option>
            <option value="webdav">XBEL in WebDAV</option>
          </Select>
          <Button
            primary
            onclick={e => {
              actions.createAccount()
            }}
          >
            Add Account
          </Button>
        </InputGroup>
        <p>
          {state.accounts.creationType === 'nextcloud-folders'
            ? 'The option "Nextcloud Bookmarks with folders" is compatible with version 0.14 of the Bookmarks app (and upwards). It creates actual folders in the app.'
            : state.accounts.creationType === 'nextcloud'
            ? 'The legacy option is compatible with version 0.11 of the Bookmarks app (and upwards). It will emulate folders by assigning tags containing the folder path to the bookmarks.'
            : "The WebDAV option syncs your bookmarks by storing them in an XBEL file in the provided WebDAV share. There is no accompanying web UI for this option and you don't need nextcloud for this."}
        </p>
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
          </a>
          <a
            target="_blank"
            href="https://github.com/marcelklehr/floccus#donate"
          >
            Fund development
          </a>
        </div>
      </div>
    </AccountsStyle>
  )
}

const AccountsStyle = style('div')({
  ' .debugging-tools': {
    position: 'absolute',
    right: '20px',
    bottom: '10px',
    fontSize: '9px'
  },
  ' .debugging-tools a': {
    color: '#3893cc !important',
    display: 'inline-block',
    marginLeft: '3px'
  },
  ' .wrapper': {
    position: 'relative',
    background: 'white',
    margin: '0',
    padding: '10px 20px 20px 25px' // top is actually 25px as well, because of InputGroup
  }
})
