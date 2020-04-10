import Logger from '../Logger'

const Parallel = require('async-parallel')

// An AuthSession can be used to make API fetch() calls to Nextcloud. It 
// overrides the requests headers to reduce the number of times, the server
// has to validate passwords.
// In order to do that without interfering with the users session cookies, 
// it intercepts relevant requests/responses and stores the cookies in a dedicated 
// CookyJar.
//
// Because a CookieJar does not respect any attributes given to 
// cookies (like "secure" or "expires") and because session timeouts are not
// detected, the follwing rules apply:
//  - Keep the lifetime of an AuthSession short!
//  - Never save an AuthSession to persistent or otherwise insecure memory!
export class AuthSession {

  // @param AuthManager
  constructor(authman) {
    this.authman = authman
    this.cookieJar = new CookieJar()
    this.id = authman.newSessionId() // why use ids? just save a reference to the object TODO
    this.authman.addSession(this)
    this.needsAuthentication = true // it looks like we only need to send auth 2 times? (we send 3 times now)
  }

  // copys behaviour of official fetch, but overwrites certain fields to contain the request in this auth session
  // set a AuthSessionId in the request
  fetch(url, init) {
    init.credentials = "omit"
    if (!this.needsAuthentication) {
      delete init.headers.Authorization
    }
    init.headers.AuthSessionId = this.id
    return fetch(url, init)
  }

  acceptCookies(header) {
    if (!this.cookieJar.storeFromHeader(header)) {
      // no new cookies recieved
      this.needsAuthentication = false
    }
  }
}

export class AuthManager {

  constructor() {
    this.sessions = {} // dict: cookieJarId => CookieJar
    this.requests = {} // prevent memory leaks (epecially on request timeouts etc) TODO
    this.sessionIdState = 0

    let onResponse = function(e) {
      let header = e.responseHeaders
      // get cookieSession by request id
      let authSessionId = window.authmanager.requests[e.requestId]
      if (authSessionId === undefined) {
        // request wasn't handled by this
        console.warn("did not recognize response")
      } else {
        // cookie is ignored by browser. no need to remove it.
        // save cookie in session
        window.authmanager.sessions[authSessionId].acceptCookies(header)
      }
      return {responseHeads: e.responseHeaders};
    }

    let onRequest = function(e) {
      let header = e.requestHeaders
      // get the authSessionId and save the request id for the session
      let authSessionId = header.find(object => object.name.toLowerCase() == "authsessionid").value
      if ( authSessionId === undefined ) {
        // not a request managed by this
        console.warn("did not recognize this request")
      } else {
        window.authmanager.requests[e.requestId] = authSessionId
        // offer cookies already present in the session
        let new_cookies = window.authmanager.sessions[authSessionId].cookieJar.getAsSingleCookie()
        // TODO dont overwrite all cookies
        header.push({ name: "Cookie", value: new_cookies})
      }

      return {requestHeaders: e.requestHeaders}
    }

    browser.webRequest.onHeadersReceived.addListener(
      onResponse,
      {urls: ["<all_urls>"]},
      ["blocking", "responseHeaders"]
    );

    browser.webRequest.onBeforeSendHeaders.addListener(
      onRequest,
      {urls: ["<all_urls>"]},
      ["blocking", "requestHeaders"]
    );

  }

  addSession(authSession) {
    this.sessions[authSession.id] = authSession
  }

  newSessionId() {
    this.sessionIdState++
    return this.sessionIdState
  }
}

class CookieJar {
  constructor() {
    this.cookies = {} // dict of cookiename => value
  }

  // @param webRequest.HttpHeaders
  // @return false if no cookie was found
  storeFromHeader(header) {
    // in firefox cookies arrive colleted in one objects value seperated by newline
    // `[{name: "Set-Cookie", value: "cookie1; httpOnly\ncookie2; httpOnly"}]
    let cookies = header.filter(object => object.name.toLowerCase() == "set-cookie")
    if (cookies.length === 0) {
      return false
    }
    if (cookies.length > 1) {
      console.warn("Unexpected Cookie layout!")
    }
    cookies = cookies[0].value
    this.store(cookies)
    return true
  }

  // @param string: 'cookie1=foobar; param1\ncookie2=foo; etc'
  store(cookies) {
    cookies = cookies.split("\n").forEach(cookie => { 
      cookie = cookie.split("; ")[0].split("=")
      if (cookie[1] === "deleted") {
        delete this.cookies[cookie[0]]
      } else {
        this.cookies[cookie[0]] = cookie[1]
      }
    })
  }

  getAsSingleCookie() {
    let cook = ""
    Object.entries(this.cookies).forEach(entry => {
      cook = cook + entry[0] + "=" + entry[1] + "; "
    })
    return cook.substr(0, cook.length-2)
  }
}

