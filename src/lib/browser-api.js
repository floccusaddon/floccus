var b
if ('undefined' === typeof browser && 'undefined' !== typeof chrome) {
  b = new ChromePromise()
  b.alarms = chrome.alarms // Don't promisify alarms -- don't make sense, yo!
}else{
  b = browser
}

export default b
