import browser from '../browser-api'
import { h } from 'hyperapp'
import Account from '../Account'
import LocalTree from '../LocalTree'
import * as Basics from './basics'

const { Input, Button, InputGroup, Select, Option, Label } = Basics

export const state = {
  accounts: {
    list: [],
    secured: false,
    creationType: 'nextcloud',
    writes: {}, // for debouncing writes
    shownOptions: {}
  }
}

const $rootPath = Symbol('$rootPath')

export const actions = {
  accounts: {
    setList: accounts => ({
      accounts,
      list: Object.keys(accounts).reduce((obj, accId) => {
        obj[accId] = {
          ...accounts[accId].getData(),
          id: accId,
          rootPath: accounts[accId][$rootPath]
        }
        return obj
      }, {})
    }),
    setSecured: secured => ({ secured }),
    load: () => async (state, actions) => {
      const accountsArray = await Account.getAllAccounts()
      const accounts = {}
      await Promise.all(
        accountsArray.map(async acc => {
          const localRoot = acc.getData().localRoot
          try {
            acc[$rootPath] = localRoot
              ? decodeURIComponent(
                  await LocalTree.getPathFromLocalId(localRoot)
                )
              : '*newly created*'
          } catch (e) {
            acc[$rootPath] = '*newly created*'
          }
          accounts[acc.id] = acc
        })
      )

      const { accountsLocked } = await browser.storage.local.get({
        accountsLocked: null
      })
      actions.setSecured(accountsLocked)
      actions.setList(accounts)
    },
    delete: accountId => async (state, actions) => {
      const account = state.accounts[accountId]
      await account.delete()
      await actions.load()
    },
    sync: accountId => async (state, actions) => {
      const background = await browser.runtime.getBackgroundPage()
      background.syncAccount(accountId)
    },
    update: ({ accountId, data }) => (state, actions) => {
      actions.updateAccount({ accountId, data })
      return {
        list: {
          ...state.list,
          [accountId]: { ...state.list[accountId], ...data }
        }
      }
    },
    updateAccount: ({ accountId, data }) => async (state, actions) => {
      const account = state.accounts[accountId]
      await new Promise(resolve =>
        actions.debounceWrite({
          accountId,
          data,
          timeout: setTimeout(resolve, 500)
        })
      )
      const originalData = account.getData()
      if (data.serverRoot === '/') data.serverRoot = ''
      const newData = Object.assign({}, originalData, data)
      if (JSON.stringify(newData) === JSON.stringify(originalData)) return
      if (originalData.serverRoot !== newData.serverRoot) {
        await account.storage.initCache()
        await account.storage.initMappings()
      }
      await account.setData(newData)
      await actions.load()
    },
    setCreationType: type => ({ creationType: type }),
    create: () => async (state, actions) => {
      await Account.create(Account.getDefaultValues(state.creationType))
      await actions.load()
    },
    debounceWrite: ({ accountId, data, timeout }) => state => {
      if (
        state.writes[accountId] &&
        state.writes[accountId][Object.keys(data).join(',')]
      ) {
        clearTimeout(state.writes[accountId][Object.keys(data).join(',')])
      }
      return {
        writes: {
          ...state.writes,
          [accountId]: {
            ...(state.writes[accountId] || {}),
            [Object.keys(data).join(',')]: timeout
          }
        }
      }
    },
    toggleOptions: accountId => state => ({
      shownOptions: {
        ...state.shownOptions,
        [accountId]: !state.shownOptions[accountId]
      }
    })
  }
}

export const Component = () => (state, actions) => {
  return (
    <div>
      <div id="accounts">
        {Object.keys(state.accounts.list).map(accountId =>
          state.accounts.accounts[accountId].server.constructor.renderOptions(
            {
              account: state.accounts.list[accountId],
              showOptions: state.accounts.shownOptions[accountId]
            },
            actions
          )
        )}
      </div>
      <InputGroup fullWidth={true}>
        <Select
          style={{ width: '75%' }}
          onchange={e => {
            actions.accounts.setCreationType(e.currentTarget.value)
          }}
          value="nextcloud"
        >
          <option value="nextcloud">Nextcloud Bookmarks</option>
          <option value="webdav">XBEL in WebDAV</option>
        </Select>
        <Button
          onclick={e => {
            actions.accounts.create()
          }}
        >
          Add Account
        </Button>
      </InputGroup>
      <div className="security">
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
          Secure your credentials with a passphrase (entered on browser start)
        </Label>
      </div>
      <a className="test-link" href="./test.html">
        run tests
      </a>
    </div>
  )
}
