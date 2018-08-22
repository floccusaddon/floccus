import * as Tree from '../Tree'
import Adapter from '../Adapter'
import CachingAdapter from '../adapters/Caching'

import { Bookmark, Folder } from '../Tree'
import * as Basics from '../components/basics'
const { h } = require('hyperapp')
const url = require('url')

const {
  P,
  Input,
  Button,
  Label,
  Options,
  OptionSyncFolder,
  OptionDelete,
  OptionResetCache
} = Basics

export default class WebDavAdapter extends CachingAdapter {
  constructor(server) {
    super(server)
    console.log('Webdav constructor')
    console.log(server)

    this.server = server
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
        credentials: 'omit',
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
        credentials: 'omit',
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
        credentials: 'omit',
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

  outputFolderXBEL(myFolder, indent) {
    let output = ''

    myFolder.children.forEach(bm => {
      if (bm instanceof Bookmark) {
        output += indent + '<bookmark href='
        output += '"' + this.htmlEncode(bm.url) + '"'
        output +=
          ' id="' +
          bm.id +
          `">
`
        output +=
          indent +
          '<title>' +
          this.htmlEncode(bm.title) +
          `</title>
`
        output +=
          indent +
          `</bookmark>
`
      }
    })

    myFolder.children.forEach(folder => {
      if (folder instanceof Folder) {
        output += indent + '<folder'
        if ('id' in folder) {
          output += ' id="' + folder.id + '"'
        }
        output += `>
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
      }
    })

    return output
  }

  createXBEL(myTopFolder) {
    let output = `<?xml version="1.0" encoding="ISO-8859-1"?>
<!DOCTYPE xbel PUBLIC "+//IDN python.org//DTD XML Bookmark Exchange Language 1.0//EN//XML" "http://www.python.org/topics/xml/dtds/xbel-1.0.dtd">
<xbel version="1.0">
`

    output +=
      '<!--- highestId :' +
      this.highestId +
      `: for Floccus bookmark sync browser extension -->
`

    output += this.outputFolderXBEL(myTopFolder, '')

    output += `
</xbel>`

    return output
  }

  async onSyncFail() {
    console.log('onSyncFail')
    await this.freeLock()
  }

  async onSyncComplete() {
    console.log('onSyncComplete')
    let cacheClone = this.bookmarksCache.clone()
    console.log(cacheClone)

    let fullUrl = this.server.bookmark_file
    fullUrl = this.server.url + fullUrl
    console.log('fullURL :' + fullUrl + ':')
    let xbel = this.createXBEL(this.bookmarksCache)
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

  _parseFolder(xbelObj, folder) {
    /* parse bookmarks first, breadth first */

    let bookmarkList = this._getElementsByNodeName(
      xbelObj.childNodes,
      'bookmark',
      1 /* element type */
    )

    bookmarkList.forEach(bookmark => {
      let bm = new Bookmark({
        id: parseInt(bookmark.id),
        parentId: folder.id,
        url: bookmark.getAttribute('href'),
        title: bookmark.firstElementChild.innerHTML
      })

      folder.children.push(bm)
    })

    let folderList = this._getElementsByNodeName(
      xbelObj.childNodes,
      'folder',
      1 /* element type */
    )

    folderList.forEach(bmFolder => {
      let sTitle = bmFolder.firstElementChild.innerHTML
      console.log('Adding folder :' + sTitle + ':')
      let newFolder = new Folder({
        id: parseInt(bmFolder.getAttribute('id')),
        title: sTitle,
        parentId: folder.id
      })
      folder.children.push(newFolder)
      this._parseFolder(bmFolder, newFolder)
    })
  }

  _parseXbelDoc(xbelDoc) {
    let bookmarksCache = new Folder({ id: 0, title: 'root' })
    let nodeList = this._getElementsByNodeName(
      xbelDoc.childNodes,
      'xbel',
      1 /* element type */
    )
    this._parseFolder(nodeList[0], bookmarksCache)

    this.bookmarksCache = bookmarksCache.clone()

    console.log('parseXbel')
    console.log(bookmarksCache)
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

      /* let's get the highestId */
      let byNL = xmlDocText.split('\n')
      byNL.forEach(line => {
        if (line.indexOf('<!--- highestId :') >= 0) {
          let idxStart = line.indexOf(':') + 1
          let idxEnd = line.lastIndexOf(':')

          this.highestId = parseInt(line.substring(idxStart, idxEnd))
        }
      })

      this._parseXbelDoc(xmlDoc)
    }

    return {
      status: response.status,
      db: this.db
    }
  }

  async onSyncStart() {
    console.log('onSyncStart: begin')
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

      this.bookmarksCache = new Folder({ id: 0, title: 'root' })
    }

    console.log('onSyncStart: completed')
  }

  static renderOptions(state, actions) {
    let data = state.account
    let onchange = (prop, e) => {
      actions.options.update({
        data: { [prop]: e.target.value }
      })
    }
    return (
      <form>
        <table>
          <tr>
            <td>
              <Label for="url">WebDAV URL:</Label>
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
            <td />
            <td>
              e.g. with nextcloud:{' '}
              <i>
                <code>https://your-domain.com/remote.php/webdav/</code>
              </i>
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
              <Label for="bookmark_file">Bookmarks file path:</Label>
            </td>
            <td>
              <Input
                value={data.bookmark_file || ''}
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
              a path to the bookmarks file relative to your WebDAV URL (all
              folders in the path must already exist). e.g.{' '}
              <i>
                <code>personal_stuff/bookmarks.xbel</code>
              </i>
            </td>
          </tr>
          <tr>
            <td />
            <td>
              <OptionSyncFolder account={state.account} />
              <OptionResetCache account={state.account} />
              <OptionDelete account={state.account} />
            </td>
          </tr>
        </table>
      </form>
    )
  }
}
