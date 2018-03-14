var b
if ('undefined' === typeof browser && 'undefined' !== typeof chrome) {
  b = new ChromePromise()
  b.alarms = chrome.alarms // Don't promisify alarms -- don't make sense, yo!
  b.browserAction = chrome.browserAction // apparently, they provide no callbacks for these
}else{
  b = browser
}

export default b
