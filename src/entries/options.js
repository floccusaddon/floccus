(function(browser) {

browser.storage.local.get('owncloud')
.then(d => {
  var owncloud = d.owncloud
  document.querySelector('#url').value = owncloud.url
  document.querySelector('#username').value = owncloud.username
  document.querySelector('#password').value = owncloud.password
})

document.querySelector('#submit').addEventListener('click', () => {
  browser.storage.local.set({
    owncloud: {
      url: document.querySelector('#url').value
    , username: document.querySelector('#username').value
    , password: document.querySelector('#password').value
    }
  })
})

})((function(){
  if ('undefined' === typeof browser && 'undefined' !== typeof chrome) {
    return new ChromePromise()
  }else{
    return browser
  }
})())
