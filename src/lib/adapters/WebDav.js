import * as Tree from '../Tree'
import Adapter from '../Adapter'
import CachingAdapter from '../adapters/Caching'
import Logger from '../Logger'
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
    this.server = server
  }

  static getDefaultValues() {
    return {
      type: 'webdav',
      url: 'https://example.org',
      username: 'bob',
      password: 's3cret',
      bookmark_file: '/bookmarks.xbel'
    }
  }

  getBookmarkURL() {
    return this.server.url + this.server.bookmark_file
  }

  getBookmarkLockURL() {
    return this.getBookmarkURL() + '.lock'
  }

  async downloadFile(fullURL) {
    let res

    try {
      res = await fetch(fullURL, {
        method: 'GET',
        credentials: 'omit',
        headers: {
          Authorization:
            'Basic ' + btoa(this.server.username + ':' + this.server.password)
        }
      })
    } catch (e) {
      throw new Error(
        'Network error: Check your network connection and your account details'
      )
    }

    if (res.status === 401) {
      throw new Error("Couldn't authenticate with the server")
    }
    if (!res.ok && res.status !== 404) {
      throw new Error(
        `Error ${res.status}. Failed request. Check your server configuration.`
      )
    }

    return res
  }

  async checkLock() {
    let fullURL = this.getBookmarkLockURL()
    Logger.log(fullURL)

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
      var res = await fetch(url, {
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
      Logger.log('Error Caught')
      Logger.log(e)
      throw new Error(
        'Network error: Check your network connection and your account details'
      )
    }
    if (res.status === 401) {
      throw new Error("Couldn't authenticate with the server")
    }
    if (!res.ok) {
      throw new Error(
        `Error ${
          res.status
        }. Failed to upload XBEL file. Check your server configuration.`
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
      Logger.log(fullURL)
      await this.uploadFile(
        fullURL,
        'text/html',
        '<html><body>I am a lock file</body></html>'
      )
    } else {
      throw new Error(
        `Error ${rStatus} while trying to determine status of lock file ` +
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
      Logger.log('Error Caught')
      Logger.log(e)
    }
  }

  async pullFromServer() {
    let fullUrl = this.server.bookmark_file
    fullUrl = this.server.url + fullUrl

    let response = await this.downloadFile(fullUrl)

    if (response.status === 401) {
      throw new Error("Couldn't authenticate with the server.")
    }

    if (response.status === 404) {
      return {
        status: response.status,
        db: new Map()
      }
    }

    if (response.status == 200) {
      let xmlDocText = await response.text()
      let xmlDoc = new window.DOMParser().parseFromString(
        xmlDocText,
        'application/xml'
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

      let bookmarksCache = new Folder({ id: 0, title: 'root' })
      parseXbelDoc(xmlDoc, bookmarksCache)
      this.bookmarksCache = bookmarksCache.clone()

      Logger.log('parseXbel')
      Logger.log(bookmarksCache)
    }

    return {
      status: response.status,
      db: this.db
    }
  }

  async onSyncStart() {
    Logger.log('onSyncStart: begin')

    if (this.server.bookmark_file[0] !== '/') {
      throw new Error("Bookmarks file setting must start with a slash: '/'")
    }

    await this.obtainLock()

    try {
      let resp = await this.pullFromServer()

      if (resp.status !== 200) {
        if (resp.status !== 404) {
          throw new Error('Failed to fetch bookmarks :' + resp.status + ':')
        }
      }
    } catch (e) {
      throw e
    }

    Logger.log('onSyncStart: completed')
  }

  async onSyncFail() {
    Logger.log('onSyncFail')
    await this.freeLock()
  }

  async onSyncComplete() {
    Logger.log('onSyncComplete')
    let cacheClone = this.bookmarksCache.clone()
    Logger.log(cacheClone)

    let fullUrl = this.server.bookmark_file
    fullUrl = this.server.url + fullUrl
    Logger.log('fullURL :' + fullUrl + ':')
    let xbel = createXBEL(this.bookmarksCache, this.highestId)
    await this.uploadFile(fullUrl, 'application/xml', xbel)
    await this.freeLock()
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

function parseXbelDoc(xbelDoc, rootFolder) {
  let nodeList = getElementsByNodeName(
    xbelDoc.childNodes,
    'xbel',
    1 /* element type */
  )
  if (!nodeList.length) {
    throw new Error(
      'Parse Error: ' + new XMLSerializer().serializeToString(xbelDoc)
    )
  }
  parseXbelFolder(nodeList[0], rootFolder)
}

function parseXbelFolder(xbelObj, folder) {
  /* parse bookmarks first, breadth first */

  let bookmarkList = getElementsByNodeName(
    xbelObj.childNodes,
    'bookmark',
    1 /* element type */
  )

  bookmarkList.forEach(bookmark => {
    let bm = new Bookmark({
      id: parseInt(bookmark.id),
      parentId: folder.id,
      url: bookmark.getAttribute('href'),
      title: bookmark.firstElementChild.textContent
    })

    folder.children.push(bm)
  })

  let folderList = getElementsByNodeName(
    xbelObj.childNodes,
    'folder',
    1 /* element type */
  )

  folderList.forEach(bmFolder => {
    Logger.log('Adding folder :' + bmFolder.firstElementChild.textContent + ':')
    let newFolder = new Folder({
      id: parseInt(bmFolder.getAttribute('id')),
      title: bmFolder.firstElementChild.textContent,
      parentId: folder.id
    })
    folder.children.push(newFolder)
    parseXbelFolder(bmFolder, newFolder)
  })
}

function getElementsByNodeName(nodes, nodeName, nodeType) {
  let elements = []

  nodes.forEach(node => {
    if (node.nodeName == nodeName && node.nodeType == nodeType) {
      elements.push(node)
    }
  })

  return elements
}

function outputFolderXBEL(myFolder, indent) {
  let xmlDocument = new DOMParser().parseFromString(
    '<xml></xml>',
    'application/xml'
  )

  return myFolder.children
    .map(child => {
      if (child instanceof Bookmark) {
        let bookmark = xmlDocument.createElement('bookmark')
        bookmark.setAttribute('href', child.url)
        bookmark.setAttribute('id', child.id)
        let title = xmlDocument.createElement('title')
        title.textContent = child.title
        bookmark.appendChild(title)
        return new XMLSerializer().serializeToString(
          bookmark,
          'application/xml'
        )
      }

      if (child instanceof Folder) {
        let folder = xmlDocument.createElement('folder')
        if ('id' in child) {
          folder.setAttribute('id', child.id)
        }

        let title = xmlDocument.createElement('title')
        title.textContent = child.title
        folder.appendChild(title)

        folder.innerHTML += outputFolderXBEL(child, indent + '    ')
        return new XMLSerializer().serializeToString(folder, 'application/xml')
      }
    })
    .join('\r\n' + indent)
}

function createXBEL(myTopFolder, highestId) {
  let output = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE xbel PUBLIC "+//IDN python.org//DTD XML Bookmark Exchange Language 1.0//EN//XML" "http://pyxml.sourceforge.net/topics/dtds/xbel.dtd">
<xbel version="1.0">
`

  output +=
    '<!--- highestId :' +
    highestId +
    `: for Floccus bookmark sync browser extension -->
`

  output += outputFolderXBEL(myTopFolder, '')

  output += `
</xbel>`

  return output
}
