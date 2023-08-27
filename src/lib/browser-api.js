/* global chrome browser */

const ChromePromise = (function(root) {
  'use strict'
  var push = Array.prototype.push,
    hasOwnProperty = Object.prototype.hasOwnProperty

  function ChromePromise(chrome, Promise) {
    chrome = chrome || root.chrome
    Promise = Promise || root.Promise

    var runtime = chrome.runtime

    fillProperties(chrome, this)

    /// /////////////

    function setPromiseFunction(fn, thisArg) {
      return function() {
        var args = arguments

        return new Promise(function(resolve, reject) {
          function callback() {
            var err = runtime.lastError
            if (err) {
              reject(err)
            } else {
              resolve.apply(null, arguments)
            }
          }

          push.call(args, callback)

          fn.apply(thisArg, args)
        })
      }
    }

    function fillProperties(source, target) {
      for (var key in source) {
        if (hasOwnProperty.call(source, key)) {
          var val = source[key]
          var type = typeof val

          if (type === 'object' && !(val instanceof ChromePromise) && key.indexOf('on') !== 0) {
            target[key] = {}
            fillProperties(val, target[key])
          } else if (type === 'function') {
            target[key] = setPromiseFunction(val, source)
          } else {
            target[key] = val
          }
        }
      }
    }
  }

  return ChromePromise
})(typeof window !== 'undefined' ? window : self)

let b
if (typeof browser === 'undefined' && typeof chrome !== 'undefined') {
  b = new ChromePromise(chrome, Promise)
  b.alarms = chrome.alarms // Don't promisify alarms -- don't make sense, yo!
  b.browserAction = chrome.browserAction // apparently, they provide no callbacks for these
  b.action = chrome.action // apparently, they provide no callbacks for these
  b.i18n = chrome.i18n
} else {
  b = browser
}

export default b
