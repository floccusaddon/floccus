let b
if (typeof browser === 'undefined' && typeof chrome !== 'undefined') {
  b = new ChromePromise()
  b.alarms = chrome.alarms // Don't promisify alarms -- don't make sense, yo!
  b.browserAction = chrome.browserAction // apparently, they provide no callbacks for these
  b.i18n = chrome.i18n
} else {
  b = browser
}

export default b
