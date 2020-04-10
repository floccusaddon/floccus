import Logger from '../Logger'

const Parallel = require('async-parallel')

// TODO rename to CookieJarManager
export class CookieManager {

  constructor(name) {
    this.name = name
    this.sessions = {} // dict: cookieJarId => CookieJar
    this.requests = {} // prevent memory leaks (epecially on request timeouts etc) TODO
    this.sessionIdState = 0

    let onResponse = function(e) {
      console.log(name);
      console.log("response set-cookies: ")
      let header = e.responseHeaders
      console.log(header)
      
      //cookies = cookies
        //.map(object => object.value)
      //console.log(cookies)
      // get cookieSession by request id
      let cookieSessionId = window.cookiemanager.requests[e.requestId]
      if (cookieSessionId === undefined) {
        // request wasn't handled by this
        console.warn("did not recognize response")
      } else {
        // cookie is ignored by browser. no need to remove it.
        // save cookie in session
        window.cookiemanager.sessions[cookieSessionId].acceptCookies(header)
      }
      return {responseHeads: e.responseHeaders};
    }

    let onRequest = function(e) {
      console.log("request cookies")
      let header = e.requestHeaders
      console.log(header)
      // get the cookieJarId and save the request id for the session
      let cookieSessionId = header.find(object => object.name.toLowerCase() == "cookiesessionid").value
      if ( cookieSessionId === undefined ) {
        // not a request managed by this
        console.warn("did not recognize this request")
      } else {
        window.cookiemanager.requests[e.requestId] = cookieSessionId
        // offer cookies already present in the session
        let new_cookies = window.cookiemanager.sessions[cookieSessionId].cookieJar.getAsSingleCookie()
        //for (var h of e.requestHeaders) {
          //if (h.name.toLowerCase() === "cookie") {
            //h.value = new_cookies
          //}
        //}
        // TODO dont overwrite all cookies
        header.push({ name: "Cookie", value: new_cookies})
        console.log(header)
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

  addSession(cookieSession) {
    this.sessions[cookieSession.id] = cookieSession
  }

  newSessionId() {
    this.sessionIdState++
    return this.sessionIdState
  }

  dosmth() {
    console.log(this.name);
  }
}

export class CookieSession {
  constructor(cookieman) {
    this.cookieman = cookieman
    this.cookieJar = new CookieJar(cookieman)
    this.id = cookieman.newSessionId()
    this.cookieman.addSession(this)
    this.needsAuthentication = true // it looks like we only need to send auth 2 times? (we send 3 times now)
  }

  // copys behaviour of official fetch, but overwrites certain fields
  // set a cookieJarId in the request
  fetch(url, init) {
    init.credentials = "omit"
    //init.credentials = "same-origin"
    //console.log("cookiesession.fetch:")
    //console.log(init.headers)
    if (!this.needsAuthentication) {
      delete init.headers.Authorization
    } else {
      //this.needsAuthentication = false
    }
    init.headers.CookieSessionId = this.id
    //console.log(init)
    //console.log(init.headers)
    return fetch(url, init)
  }

  acceptCookies(header) {
    if (!this.cookieJar.storeFromHeader(header)) {
      // no new cookies recieved
      this.needsAuthentication = false
    }
  }
    
}

// Because a CookieJar does not respect any attributes given to 
// cookies (like "secure" or "expires") follow the follwing rules:
//  - Keep the lifetime of a CookieJar short!
//  - Never save a CookieJar to persistent or otherwise insecure memory!
//  also: if cookiejar.isEmpty but doesnt contain valid auth session cookie,
//  fetch will fail to authenticate.
class CookieJar {
  constructor(CookieManager) {
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
    //console.log(cookies)
    this.store(cookies)
    return true
  }

  // 'cookie1=foobar; param1\ncookie2=foo; etc'
  store(cookies) {
    console.log("save cookies")
    cookies = cookies.split("\n").forEach(cookie => { 
      cookie = cookie.split("; ")[0].split("=")
      console.log(cookie)
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

  isEmpty() {
    return this.cookies.length === 0
  }

}

//export class Bookmark {
  //constructor({ id, parentId, url, title }) {
    //this.type = 'bookmark'
    //this.id = id
    //this.parentId = parentId
    //this.title = title

    //not a regular bookmark
    //if (STRANGE_PROTOCOLS.some(proto => url.indexOf(proto) === 0)) {
      //this.url = url
      //return
    //}

    //try {
      //let urlObj = new URL(url)
      //this.url = urlObj.href
    //} catch (e) {
      //Logger.log('Failed to normalize', url)
      //this.url = url
    //}
  //}

  //canMergeWith(otherItem) {
    //return this.type === otherItem.type && this.url === otherItem.url
  //}

  //async hash() {
    //if (!this.hashValue) {
      //this.hashValue = await Crypto.sha256(
        //JSON.stringify({ title: this.title, url: this.url })
      //)
    //}
    //return this.hashValue
  //}

  //clone() {
    //return new Bookmark(this)
  //}

  //createIndex() {
    //return { [this.id]: this }
  //}

  //inspect(depth) {
    //return (
      //Array(depth)
        //.fill('  ')
        //.join('') +
      //`- #${this.id}[${this.title}](${this.url}) parentId: ${this.parentId}`
    //)
  //}

  //visitCreate(syncProcess, ...args) {
    //return syncProcess.createBookmark(...args)
  //}

  //visitUpdate(syncProcess, ...args) {
    //return syncProcess.updateBookmark(...args)
  //}

  //visitRemove(syncProcess, ...args) {
    //return syncProcess.removeBookmark(...args)
  //}

  //static hydrate(obj) {
    //return new Bookmark(obj)
  //}
//}

