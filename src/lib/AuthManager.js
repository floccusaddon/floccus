import browser from './browser-api'

// An AuthSession can be used to make API fetch() calls to Nextcloud. It 
// overrides the requests headers to reduce the number of times, the server
// has to validate passwords.
// In order to do that without interfering with the users session cookies, 
// it intercepts relevant requests/responses and stores the cookies in a dedicated 
// CookieJar.
//
// Because a CookieJar does not respect any attributes given to 
// cookies (like "secure" or "expires") and because session timeouts are not
// detected, the follwing rules apply:
//  - Keep the lifetime of an AuthSession short!
//  - Never save an AuthSession to persistent or otherwise insecure memory!
export class AuthSession {

  // @param "https://example.org" This session can only be used for API calls
  //          to this server.
  constructor(serverUrl) {
    if (serverUrl === undefined) {
      throw "AuthSession constructor arg undefined: serverUrl"
    }
    this.alive = true
    this.authman = window.authManager
    this.cookieJar = new CookieJar()
    this.serverUrl = serverUrl
    // AuthManager creates an entry in authManager.requests for every request
    // sent. The entries are deleted if a reponse is received. If no response 
    // is received, the entries have to be removed by authSession.destroy() 
    // because AuthManagers are long lived and should not leak memory. 
    // Therefore an authSession has to know which requests belong to it.
    this.ownedRequests = {} // dict: request.id => true

    // it looks like we only need to send auth 2 times for nextcloud? (we send 3 times now)
    this.needsAuthentication = true 
    // some browsers might not allow us to acces relevant httpOnly cookies
    this.everRecievedCookie = false
  }

  async initialize() {
    if (this.authman === undefined) {
      const background = await browser.runtime.getBackgroundPage()
      this.authman = background.authManager
      window.authManager = this.authman
    }
    this.id = this.authman.newSessionId()
    this.authman.addSession(this)
  }

  destructor() {
    this.authman.removeSession(this)
    this.alive = false
  }

  check() {
    if (!this.alive) {
      throw "Trying to use an AuthSession wich has been destroyed."
    }
  }

  // Mimics behaviour of official fetch, but overwrites certain fields to 
  // contain the request in this AuthSession. Sets a AuthSessionId in the request.
  fetch(url, init) {
    this.check()
    init.credentials = "omit"
    if (!this.needsAuthentication) {
      delete init.headers.Authorization
    }
    init.headers["X-floccus-Session-Id"] = this.id

    let response
    try {
      response = fetch(url, init)
    } catch (e) {
      e.fromFetch = true
      throw e
    }
    return response
  }

  acceptCookies(header) {
    this.check()
    if (!this.cookieJar.storeFromHeader(header)) {
      if (this.everRecievedCookie) {
        // if and only if our browser grants us access to httpOnly cookies,
        // _and_ nextcloud has stopped sending new cookies, stop sending login data
        this.needsAuthentication = false
      }
    } else {
      this.everRecievedCookie = true
    }
  }
}

// Handles listeners for AuthSessions. Should have exactly one global instance.  
export class AuthManager {

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

  // adds or overwrites listeners
  addListeners(filter) {

    let respPerms = ["blocking", "responseHeaders"]
    let reqPerms = ["blocking", "requestHeaders"]

    // "extraHeaders" is required additionally for chrome to show relevant cookies
    if (browser.isChrome) {
      respPerms.push("extraHeaders")
      reqPerms.push("extraHeaders")
    }

    browser.webRequest.onHeadersReceived.addListener(
      this.onResponseListener,
      filter,
      respPerms
    )

    browser.webRequest.onBeforeSendHeaders.addListener(
      this.onRequestListener,
      filter,
      reqPerms
    )
  }

  removeListeners() {
    browser.webRequest.onHeadersReceived.removeListener(this.onResponseListener)
    browser.webRequest.onBeforeSendHeaders.removeListener(this.onRequestListener)
  }

  onResponse(e) {
      let header = e.responseHeaders
      // get authSession by request id
      let authSessionId = this.requests[e.requestId]
      if (authSessionId === undefined) {
        // request wasn't handled by this
        console.info("Detected a response not meant for the bookmarks API. Returning now.")
      } else {
        // save cookie in session
        this.sessions[authSessionId].acceptCookies(header)
        // remove request and its ownership
        delete this.requests[e.requestId]
        delete this.sessions[authSessionId].ownedRequests[e.requestId]
      }
      return {responseHeaders: e.responseHeaders};
  }

  onRequest(e) {
      let header = e.requestHeaders
      // get the authSessionId
      let authSessionId
      for (let object of header) {
        if (object.name.toLowerCase() == "x-floccus-session-id") {
          authSessionId = object.value
        }
      }

      if ( authSessionId === undefined ) {
        // not a request managed by this
        console.info("Detected a request not meant for the bookmarks API. Returning now.")
      } else {
        // assign the requestId a authSession
        this.requests[e.requestId] = authSessionId
        // set ownership of request
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
    let serverurls = Object.values(this.sessions).map(session => session.serverUrl + "/*")

    return {
      urls: serverurls
    }
  }

  addSession(authSession) {
    this.sessions[authSession.id] = authSession
    this.updateListeners()
  }

  removeSession(authSession) {
    // clean up requests owned by authSession
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
    let cookies = header.filter(object => object.name.toLowerCase() == "set-cookie")
    if (cookies.length === 0) {
      return false
    }

    cookies.forEach(cookie => this.store(cookie.value))

    return true
  }

  // @param cookies string: 'cookie1=foobar; param1\ncookie2=foo; etc'
  store(cookie) {
    // in firefox a single cookie can represent multiple cookies (seperated by newline)
    cookie.split("\n").forEach(cookie => {
      cookie = cookie.split("; ")[0].split("=")
      if (cookie[1] === "deleted") {
        // delete cookie
        delete this.cookies[cookie[0]]
      } else {
        // save cookie
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

