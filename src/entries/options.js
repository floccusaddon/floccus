import browser from '../lib/browser-api'

function render() {
  browser.storage.local.get('accounts')
  .then((d) => {
    var accounts = d['accounts']
    var template = document.querySelector('template#account').firstChild
    Object.keys(accounts).forEach(accountId => {
      // create new account element
      template.querySelector('.url').value = accounts[accountId].url
      template.querySelector('.username').value = accounts[accountsId].username
      template.querySelector('.password').value = accounts[accountsId].password
      var newAccount = document.importNode(template, true)
      document.querySelector('#accounts').appendNode(newAccount)
      // setup change listener
      newAccount.firstChild.addEventListener('change', () => {
        accounts[accountId] = {
          url: newAccount.querySelector('.url').value
        , username: newAccount.querySelector('.username').value
        , password: newAccount.querySelector('.password').value
        }
        browser.storage.local.set({accounts: accounts}) 
      })
    })
  })
}

