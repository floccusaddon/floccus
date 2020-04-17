import browser from './browser-api'
import api_versions from './api_versions'
const url = require('url')

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
    this.serverUrl = this.normalizeServerURL(serverUrl)
    // AuthManager creates an entry in authManager.requests for every request
    // sent. The entries are deleted if a reponse is received. If no response 
    // is received, the entries have to be removed by authSession.destroy() 
    // because AuthManagers are long lived and should not leak memory. 
    // Therefore an authSession has to know which requests belong to it.
    this.ownedRequests = {} // dict: request.id => true

    this.needsAuthorizations
    this.setAuthBuildUpRequired()

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

  // @param init param of fetch to manage by this
  manageRequest(init) {
    // not quite sure if this an actual fix or just a workaround for this 
    // specific test: Floccus%20nextcloud-folders%20standard-root%20Sync%20with%20one%20client%20should%20not%20fail%20when%20both%20moving%20folders%20and%20deleting%20their%20contents
    //
    // https://docs.nextcloud.com/server/latest/developer_manual//app/requests/controllers.html
    // ^ "The session is closed automatically for writing, unless you add the @UseSession annotation!"
    // PUT may be considered writing by nextcloud and could cause the session to close. 
    // Hence authBuildUp is required for PUTs. 
    if (init.method == "PUT") {
      this.setAuthBuildUpRequired()
    }

    // adjust headers
    init.credentials = "omit"
    if (!this.needsAuthorization()) {
      delete init.headers.Authorization
    } else {
      this.needsAuthorizations--
    }
    init.headers["X-floccus-Session-Id"] = this.id

    return init
  }

  // Mimics behaviour of official fetch, but overwrites certain fields to 
  // contain the request in this AuthSession. Sets a AuthSessionId in the request.
  fetch(url, init) {
    this.check()

    // Modify headers to manage request by this if the api endpoint has a 
    // sufficient version.
    if (api_versions.lessEqual(
      this.authman.API_MIN_REQUIRED_VERSION, api_versions.extractVersion(url)
    )) {
      init = this.manageRequest(init)
    }

    // fetch request
    let response
    try {
      response = fetch(url, init)
    } catch (e) {
      e.fromFetch = true
      throw e
    }
    return response
  }

  /**
   * From testing it looks like building up valid auth cookies requires at 
   * least two Authorizations in sequence. 
   * Additionally it looks like PUT requests need an additional 
   * auth build up.
   */
  setAuthBuildUpRequired() {
    this.needsAuthorizations = 2
  }

  needsAuthorization() {
    return this.needsAuthorizations > 0
  }

  onResponse(header) {
    this.check()

    if (this.cookieJar.storeFromHeader(header)) {
      this.everRecievedCookie = true
    }
    if (!this.everRecievedCookie) {
      // never received cookie
      this.setAuthBuildUpRequired()
    }

  }

  normalizeServerURL(input) {
    let serverURL = url.parse(input)
    let indexLoc = serverURL.pathname.indexOf('index.php')
    return url.format({
      protocol: serverURL.protocol,
      auth: serverURL.auth,
      host: serverURL.host,
      port: serverURL.port,
      pathname:
        serverURL.pathname.substr(0, ~indexLoc ? indexLoc : undefined) +
        (!~indexLoc && serverURL.pathname[serverURL.pathname.length - 1] !== '/'
          ? '/'
          : '')
    })
  }
}

// Handles listeners for AuthSessions. Should have exactly one global instance.  
export class AuthManager {

  constructor() {
    this.sessions = {} // dict: AuthSessionId => AuthSession
    this.requests = {} // dict: request.requestId => AuthSessionId
    this.sessionIdState = 0

    this.API_MIN_REQUIRED_VERSION = "v3"

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
        this.sessions[authSessionId].onResponse(header)
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
    let serverurls = Object.values(this.sessions).map(session => 
      session.serverUrl + "*")
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

