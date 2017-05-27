import browser from '../lib/browser-api'

function render() {
  browser.storage.local.get('accounts')
  .then((d) => {
    var accounts = d['accounts']
    console.log(accounts)
    var $template = document.querySelector('template#account').content.querySelector('.account')
    var $accounts = document.querySelector('#accounts')
    $accounts.innerHTML = ''
    Object.keys(accounts).forEach(accountId => {
      // create new account element
      $template.querySelector('.url').value = accounts[accountId].url
      $template.querySelector('.username').value = accounts[accountId].username
      $template.querySelector('.password').value = accounts[accountId].password
      var $newAccount = document.importNode($template, true)
      $accounts.append($newAccount)
      // setup change listener
      const onchange = () => {
        delete accounts[accountId]
        var account = {
          url: $newAccount.querySelector('.url').value
        , username: $newAccount.querySelector('.username').value
        , password: $newAccount.querySelector('.password').value
        }
        accountId = account.username+'@'+account.url
        accounts[accountId] = account
        browser.storage.local.set({accounts: accounts}) 
      }
      $newAccount.querySelector('.url').addEventListener('change', onchange)
      $newAccount.querySelector('.username').addEventListener('change', onchange)
      $newAccount.querySelector('.password').addEventListener('change', onchange)
      $newAccount.querySelector('.remove').addEventListener('click', () => {
        delete accounts[accountId] 
        browser.storage.local.set({accounts: accounts}) 
        .then(() => render())
      })
      $newAccount.querySelector('.forceSync').addEventListener('click', () => {
        $newAccount.querySelector('.forceSync').classList.add('disabled')
        browser.runtime.getBackgroundPage()
        .then((background) => background.syncAccount(accountId))
        .then(() => render())
      })
    })
  })
}

document.querySelector('#addaccount').addEventListener('click', () => { 
  browser.storage.local.get('accounts')
  .then((d) => {
    var accounts = d['accounts']
    var account = {
      url: 'example.com'
    , username: 'bob'
    , password: 'sssh'
    }
    accounts[account.username+'@'+account.url] = account
    return browser.storage.local.set({accounts: accounts})
  })
  .then(() => render())
})
render()
