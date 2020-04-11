import browser from './browser-api'

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
  // @param "https://example.org"
  constructor(authman, serverUrl) {
    this.authman = authman
    this.cookieJar = new CookieJar()
    this.id = authman.newSessionId()
    this.serverUrl = serverUrl
    this.ownedRequests = {} // dict: request.id => true
    this.authman.addSession(this)

    // it looks like we only need to send auth 2 times? (we send 3 times now)
    this.needsAuthentication = true 
    // some browsers (chrome) allow us to acces relevant httpOnly cookies 
    // over chrome.cookies but not by intercepting webRequets
    // TODO this kinda relies on nextcloud only sending our expected set of httpOnly cookies
    this.everRecievedCookie = false
  }

  destructor() {
    this.authman.removeSession(this)
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
      if (this.everRecievedCookie) {
        // if and only if our browser grants us access to httpsOnly cookies,
        // _and_ nextcloud has stopped sending new cookies, stop sending login data
        this.needsAuthentication = false
      }
    } else {
      this.everRecievedCookie = true
    }
  }
}

export class AuthManager {

  // @param server url used by API fetches
  constructor() {
    this.sessions = {} // dict: AuthSessionId => AuthSession
    this.requests = {} // dict: request.requestId => AuthSessionId
    this.sessionIdState = 0

    this.onResponseListener = e => this.onResponse(e)
    this.onRequestListener = e => this.onRequest(e)

  }

  updateListeners() {
    let filter = this.getRequestFilter()
    if (filter.urls.length <= 0) {
      this.removeListeners()
    } else {
      this.addListeners(filter)
    }
  }

  addListeners(filter) {
    browser.webRequest.onHeadersReceived.addListener(
      this.onResponseListener,
      filter,
      ["blocking", "responseHeaders"]
    );

    browser.webRequest.onBeforeSendHeaders.addListener(
      this.onRequestListener,
      filter,
      ["blocking", "requestHeaders"]
    );
  }

  removeListeners() {
    browser.webRequest.onHeadersReceived.removeListener(this.onResponseListener)
    browser.webRequest.onBeforeSendHeaders.removeListener(this.onRequestListener)
  }

  onResponse(e) {
      let header = e.responseHeaders
      // get cookieSession by request id
      let authSessionId = this.requests[e.requestId]
      if (authSessionId === undefined) {
        // request wasn't handled by this
        console.info("Detected a response not meant for the bookmarks API. Returning now.")
      } else {
        // cookie is ignored by browser. no need to remove it.
        // save cookie in session
        this.sessions[authSessionId].acceptCookies(header)
        delete this.requests[e.requestId]
        delete this.sessions[authSessionId].ownedRequests[e.requestId]
      }
      return {responseHeaders: e.responseHeaders};
  }

  onRequest(e) {
      let header = e.requestHeaders
      // get the authSessionId and save the request id for the session
      let authSessionId
      for (let object of header) {
        if (object.name.toLowerCase() == "authsessionid") {
          authSessionId = object.value
        }
      }

      if ( authSessionId === undefined ) {
        // not a request managed by this
        console.info("Detected a request not meant for the bookmarks API. Returning now.")
      } else {
        this.requests[e.requestId] = authSessionId
        this.sessions[authSessionId].ownedRequests[e.requestId] = true
        // offer cookies already present in the session
        let new_cookies = this.sessions[authSessionId].cookieJar.getAsSingleCookie()
        header.push({ name: "Cookie", value: new_cookies})
      }

      return {requestHeaders: e.requestHeaders}
  }

  getRequestFilter() {
    // because background.html doesn't own a window nor a tab, there is little we can do
    //let tab = browser.tabs.getCurrent()
    //let w = browser.windows.getCurrent()
    let serverurls = []
    Object.values(this.sessions).forEach(session => serverurls.push(session.serverUrl + "/*"))

    return {
      urls: serverurls 
    }
  }

  addSession(authSession) {
    this.sessions[authSession.id] = authSession
    this.updateListeners()
  }

  removeSession(authSession) {
    Object.keys(authSession.ownedRequests).forEach(requestId => delete this.requests[requestId])
    delete this.sessions[authSession.id]
    this.updateListeners()
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

