import PathParse from '../PathParse'
import Bookmark from '../Bookmark'
import * as Basics from '../components/basics'
const { h } = require('hyperapp')
const url = require('url')

export default class WebDavAdapter {
  constructor(server) {
    console.log('Webdav constructor')
    console.log(server)

    this.server = server
    this.db = new Map()

    // keep highestID associated with the object
    this.highestID = 0
  }

  static getDefaultValues() {
    return {
      type: 'webdav',
      url: 'https://example.org',
      username: 'bob',
      password: 's3cret',
      bookmark_file: 'bookmarks.xbel'
    }
  }

  setData(data) {
    this.server = data
  }

  getData() {
    return JSON.parse(JSON.stringify(this.server))
  }

  getLabel() {
    let data = this.getData()
    return data.username + '@' + data.url
  }

  getBookmarksAsJSON() {
    let bookmarksList = []
    let values = Array.from(this.db.values())

    for (var i = 0; i < values.length; ++i) {
      let value = values[i]
      bookmarksList.push({
        id: value.id,
        path: value.path,
        url: value.url,
        title: value.title
      })
    }

    return JSON.stringify(bookmarksList, null, 4)
  }

  getBookmarkURL() {
    return this.server.url + this.server.bookmark_file
  }

  getBookmarkLockURL() {
    return this.getBookmarkURL() + '.lock'
  }

  async downloadFile(fullURL) {
    let response

    try {
      response = await fetch(fullURL, {
        method: 'GET',
        headers: {
          Authorization:
            'Basic ' + btoa(this.server.username + ':' + this.server.password)
        }
      })
    } catch (e) {
      response = { status: 500 }
    }

    return response
  }

  async checkLock() {
    let fullURL = this.getBookmarkLockURL()
    console.log(fullURL)

    let rStatus
    let rBody
    let response

    response = await this.downloadFile(fullURL)
    rStatus = response.status

    return rStatus
  }

  timeout(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  async uploadFile(url, content_type, data) {
    try {
      await fetch(url, {
        method: 'PUT',
        headers: {
          'Content-Type': content_type,
          Authorization:
            'Basic ' + btoa(this.server.username + ':' + this.server.password)
        },
        body: data
      })
    } catch (e) {
      console.log('Error Caught')
      console.log(e)
      throw new Error(
        'Network error: Check your network connection and your account details'
      )
    }
  }

  async obtainLock() {
    let rStatus
    let maxTimeout = 30
    let increment = 5
    let idx = 0

    for (idx = 0; idx < maxTimeout; idx += increment) {
      rStatus = await this.checkLock()
      if (rStatus == 200) {
        await this.timeout(increment * 1000)
      } else if (rStatus == 404) {
        break
      }
    }

    if (rStatus == 200) {
      throw new Error(
        'Lock Error: Unable to clear lock file, consider deleting ' +
          this.server.bookmark_file +
          '.lock'
      )
    } else if (rStatus == 404) {
      let fullURL = this.getBookmarkLockURL()
      console.log(fullURL)
      await this.uploadFile(
        fullURL,
        'text/html',
        '<html><body>I am a lock file</body></html>'
      )
    } else {
      throw new Error(
        'Network Error: Unable to determine status of lock file ' +
          this.server.bookmark_file +
          '.lock'
      )
    }

    return 1
  }

  async freeLock() {
    let fullUrl = this.server.bookmark_file
    fullUrl = this.server.url + fullUrl + '.lock'

    let rStatus = 500
    let response

    try {
      response = await fetch(fullUrl, {
        method: 'DELETE',
        headers: {
          Authorization:
            'Basic ' + btoa(this.server.username + ':' + this.server.password)
        }
      })

      rStatus = response.status
    } catch (e) {
      console.log('Error Caught')
      console.log(e)
    }
  }

  htmlEncode(content) {
    return document
      .createElement('a')
      .appendChild(document.createTextNode(content)).parentNode.innerHTML
  }

  htmlDecode(content) {
    let a = document.createElement('a')
    a.innerHTML = html
    return a.textContent
  }

  outputFolderXBEL(myStructure, indent) {
    let output = ''

    myStructure.bookmarks.forEach(bm => {
      output += indent + '<bookmark href='
      output += '"' + this.htmlEncode(bm.url) + '"'
      output +=
        ' id="' +
        bm.id +
        `">
        `
      output +=
        indent +
        '    <title>' +
        this.htmlEncode(bm.title) +
        `</title>
        `
      output +=
        indent +
        `</bookmark>
        `
    })

    let keys = Object.keys(myStructure.folders)
    let values = keys.map(v => {
      return myStructure.folders[v]
    })

    values.forEach(folder => {
      output +=
        indent +
        `<folder>
        `
      output +=
        indent +
        '    <title>' +
        this.htmlEncode(folder.title) +
        `</title>
        `

      output += this.outputFolderXBEL(folder, indent + '    ')

      output +=
        indent +
        `</folder>
        `
    })

    return output
  }

  createXBEL(myStructure) {
    let output = `<?xml version="1.0" encoding="ISO-8859-1"?>
      <!DOCTYPE xbel PUBLIC "+//IDN python.org//DTD XML Bookmark Exchange Language 1.0//EN//XML" "http://www.python.org/topics/xml/dtds/xbel-1.0.dtd">
      <xbel version="1.0">
      `

    output +=
      '<!--- highestID :' +
      this.highestID +
      `: for Floccus bookmark sync browser extension -->
      `

    output += this.outputFolderXBEL(myStructure, '')

    output += `
      </xbel>`

    return output
  }

  /* private routine */
  _addBookmark(myStructure, bm) {
    let myArray = PathParse.parsePathIntoAnArray(bm.path)
    let idx
    let current = myStructure
    let current_path = ''

    for (idx = 1; idx < myArray.length; ++idx) {
      let item = myArray[idx]
      if (item in current.folders) {
        current = current.folders[item]
      } else {
        let newpath

        if (current.path == '/') {
          newpath = current.path + item
        } else {
          newpath = current.path + '/' + item
        }

        current.folders[item] = {
          title: item,
          path: newpath,
          bookmarks: [],
          folders: {}
        }

        current = current.folders[item]
      }
    }

    current.bookmarks.push({
      title: bm.title,
      id: bm.id,
      path: bm.path,
      url: bm.url
    })
  }

  convertToStructure() {
    let myStructure = {
      title: '',
      path: '',
      bookmarks: [],
      folders: {}
    }

    try {
      let myBookmarks = Array.from(this.db.values())
      myBookmarks.forEach(bm => {
        this._addBookmark(myStructure, bm)
      })
    } catch (e) {
      console.log('error')
      console.log(e)
    }

    let xbel = this.createXBEL(myStructure)

    return xbel
  }

  async syncFail() {
    await this.freeLock()
  }

  async syncComplete() {
    console.log('WebDav: Uploading JSON file to server')
    this.bookmarksAsJSON = this.getBookmarksAsJSON()

    let fullUrl = this.server.bookmark_file
    fullUrl = this.server.url + fullUrl
    console.log('fullURL :' + fullUrl + ':')
    let xbel = this.convertToStructure()
    await this.uploadFile(fullUrl, 'application/xml', xbel)
    await this.freeLock()
  }

  _getElementsByNodeName(nodes, nodeName, nodeType) {
    let elements = []

    nodes.forEach(node => {
      if (node.nodeName == nodeName && node.nodeType == nodeType) {
        elements.push(node)
      }
    })

    return elements
  }

  _parseFolder(xbelObj, path) {
    /* parse bookmarks first, breadth first */

    let bookmarkList = this._getElementsByNodeName(
      xbelObj.childNodes,
      'bookmark',
      1 /* element type */
    )

    bookmarkList.forEach(bookmark => {
      this.db.set(
        parseInt(bookmark.id),
        new Bookmark(
          parseInt(bookmark.id),
          null,
          bookmark.getAttribute('href'),
          bookmark.firstElementChild.innerHTML,
          path
        )
      )
    })

    let folderList = this._getElementsByNodeName(
      xbelObj.childNodes,
      'folder',
      1 /* element type */
    )

    folderList.forEach(folder => {
      let newpath = path + '/' + folder.firstElementChild.innerHTML
      console.log('Adding folder :' + newpath + ':')
      this._parseFolder(folder, newpath)
    })
  }

  _parseXbelDoc(xbelDoc) {
    this.db = new Map()
    let nodeList = this._getElementsByNodeName(
      xbelDoc.childNodes,
      'xbel',
      1 /* element type */
    )
    this._parseFolder(nodeList[0], '')

    // for debugging so that it does not change later in the console
    let xdb = new Map(this.db)
    console.log('_parseXbelDoc')
    console.log(xdb)
  }

  async pullFromServer() {
    let fullUrl = this.server.bookmark_file
    fullUrl = this.server.url + fullUrl

    let response = await this.downloadFile(fullUrl)

    if (response.status === 401) {
      throw new Error(
        "Couldn't authenticate for removing bookmarks from the server."
      )
    }

    if (response.status !== 200) {
      return {
        status: response.status,
        db: new Map()
      }
    }

    if (response.status == 200) {
      let xmlDocText = await response.text()
      let xmlDoc = new window.DOMParser().parseFromString(
        xmlDocText,
        'text/xml'
      )

      /* let's get the highestID */
      let byNL = xmlDocText.split('\n')
      byNL.forEach(line => {
        if (line.indexOf('<!--- highestID :') >= 0) {
          let idxStart = line.indexOf(':') + 1
          let idxEnd = line.lastIndexOf(':')

          this.highestID = parseInt(line.substring(idxStart, idxEnd))
        }
      })

      this._parseXbelDoc(xmlDoc)
    }

    return {
      status: response.status,
      db: this.db
    }
  }

  async syncStart() {
    await this.obtainLock()

    try {
      let resp = await this.pullFromServer()

      if (resp.status !== 200) {
        if (resp.status !== 404) {
          throw new Error('Failed to fetch bookmarks :' + resp.status + ':')
        }
      }
    } catch (e) {
      console.log('caught error')
      console.log(e)

      this.db = new Map()
    }

    console.log('syncStart: completed')
  }

  async pullBookmarks() {
    console.log('Fetching bookmarks', this.server)

    let myBookmarks = Array.from(this.db.values()).map(bm => {
      return new Bookmark(bm.id, null, bm.url, bm.title, bm.path)
    })

    console.log('Received bookmarks from server')
    console.log(myBookmarks)

    return myBookmarks
  }

  async getBookmark(id, autoupdate) {
    console.log('Fetching single bookmark', this.server)
    let bm = this.db.get(id)
    if (!bm) {
      throw new Error('Failed to fetch bookmark')
    }
    let bookmark = new Bookmark(bm.id, null, bm.url, bm.title, bm.path)
    return bookmark
  }

  async createBookmark(bm) {
    console.log('Create bookmark: 001 ', bm, this.server)

    // if highestID is zero than we have a new situation

    if (this.highestID < 1) {
      this.db.forEach((value, key) => {
        if (value && value.id && highestID < value.id) this.highestID = value.id
      })
    }

    bm.id = ++this.highestID

    this.db.set(bm.id, new Bookmark(bm.id, null, bm.url, bm.title, bm.path))

    console.log('Create bookmark: OUT ', bm, this.server)

    return bm
  }

  async updateBookmark(remoteId, newBm) {
    console.log('Update bookmark', newBm, remoteId, this.server)

    this.db.set(
      remoteId,
      new Bookmark(remoteId, null, newBm.url, newBm.title, newBm.path)
    )

    console.log('THIS')
    console.log(this)

    return new Bookmark(remoteId, null, newBm.url, newBm.title, newBm.path)
  }

  async removeBookmark(remoteId) {
    console.log('Remove bookmark', remoteId, this.server)
    this.db.delete(remoteId)
    console.log('THIS')
    console.log(this)
  }

  static renderOptions(state, actions) {
    let data = state.account
    let onchange = (prop, e) => {
      actions.accounts.update({
        accountId: state.account.id,
        data: { [prop]: e.target.value }
      })
    }
    return (
      <Account account={state.account}>
        <form>
          <table>
            <tr>
              <td>
                <Label for="url">Nextcloud server URL:</Label>
              </td>
              <td>
                <Input
                  value={data.url}
                  type="text"
                  name="url"
                  onkeyup={onchange.bind(null, 'url')}
                  onblur={onchange.bind(null, 'url')}
                />
              </td>
            </tr>
            <tr>
              <td>
                <Label for="username">User name:</Label>
              </td>
              <td>
                <Input
                  value={data.username}
                  type="text"
                  name="username"
                  onkeyup={onchange.bind(null, 'username')}
                  onblur={onchange.bind(null, 'username')}
                />
              </td>
            </tr>
            <tr>
              <td>
                <Label for="password">Password:</Label>
              </td>
              <td>
                <Input
                  value={data.password}
                  type="password"
                  name="password"
                  onkeyup={onchange.bind(null, 'password')}
                  onblur={onchange.bind(null, 'password')}
                />
              </td>
            </tr>
            <tr>
              <td>
                <Label for="bookmar_file">Server path:</Label>
              </td>
              <td>
                <Input
                  value={data.serverRoot || ''}
                  type="text"
                  name="bookmark_file"
                  placeholder="Path on the server to the bookmarks file"
                  onkeyup={onchange.bind(null, 'bookmark_file')}
                  onblur={onchange.bind(null, 'serverRoot')}
                />
              </td>
            </tr>
            <tr>
              <td />
              <td>
                <AccountStatus account={state.account} />
                <Button
                  onclick={e => {
                    e.preventDefault()
                    actions.accounts.toggleOptions(state.account.id)
                  }}
                >
                  Options
                </Button>
                <Button
                  disabled={!!data.syncing}
                  onclick={e => {
                    e.preventDefault()
                    !data.syncing && actions.accounts.sync(state.account.id)
                  }}
                >
                  Sync now
                </Button>
                <AccountStatusDetail account={state.account} />
                <Options show={state.showOptions}>
                  <OptionSyncFolder account={state.account} />
                  <OptionDelete account={state.account} />
                </Options>
              </td>
            </tr>
          </table>
        </form>
      </Account>
    )
  }
}
