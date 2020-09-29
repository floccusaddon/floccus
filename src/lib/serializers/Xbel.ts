import Serializer from '../interfaces/Serializer'
import { Bookmark, Folder } from '../Tree'

class XbelSerializer implements Serializer {
  serialize(folder) {
    return this._serializeFolder(folder, '')
  }

  deserialize(xbel) {
    const xmlDoc = new window.DOMParser().parseFromString(
      xbel,
      'application/xml'
    )
    const nodeList = xmlDoc.getElementsByTagName('xbel')
    if (!nodeList.length) {
      throw new Error(
        'Parse Error: ' + new XMLSerializer().serializeToString(xmlDoc)
      )
    }

    const rootFolder = new Folder({ id: 0, title: 'root' })
    this._parseFolder(nodeList[0], rootFolder)
    return rootFolder
  }

  _parseFolder(xbelObj, folder) {
    /* parse depth first */

    xbelObj.childNodes.forEach(node => {
      let item
      if (node.tagName && node.tagName === 'bookmark') {
        item = new Bookmark({
          id: parseInt(node.id),
          parentId: folder.id,
          url: node.getAttribute('href'),
          title: node.firstElementChild.textContent
        })
      } else if (node.tagName && node.tagName === 'folder') {
        item = new Folder({
          id: parseInt(node.getAttribute('id')),
          title: node.firstElementChild.textContent,
          parentId: folder.id
        })
        this._parseFolder(node, item)
      } else {
        return
      }

      folder.children.push(item)
    })
  }

  _serializeFolder(folder, indent) {
    /* Dummy XML document so we can create XML Elements */
    const xmlDocument = new DOMParser().parseFromString(
      '<xml></xml>',
      'application/xml'
    )

    return folder.children
      .map(child => {
        if (child instanceof Bookmark) {
          const bookmark = xmlDocument.createElement('bookmark')
          bookmark.setAttribute('href', child.url)
          bookmark.setAttribute('id', String(child.id))
          const title = xmlDocument.createElement('title')
          title.textContent = child.title
          bookmark.appendChild(title)
          return new XMLSerializer().serializeToString(
            bookmark
          )
        }

        if (child instanceof Folder) {
          const folder = xmlDocument.createElement('folder')
          if ('id' in child) {
            folder.setAttribute('id', String(child.id))
          }

          const title = xmlDocument.createElement('title')
          title.textContent = child.title
          folder.appendChild(title)

          folder.innerHTML += this._serializeFolder(child, indent + '    ')
          return new XMLSerializer().serializeToString(
            folder
          )
        }
      })
      .join('\r\n' + indent)
  }
}

export default new XbelSerializer()
