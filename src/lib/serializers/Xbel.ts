import Serializer from '../interfaces/Serializer'
import { Bookmark, Folder, ItemLocation } from '../Tree'
import { XMLParser, XMLBuilder } from 'fast-xml-parser'

class XbelSerializer implements Serializer {
  serialize(folder: Folder<typeof ItemLocation.SERVER>) {
    const xbelObj = this._serializeFolder(folder)
    const xmlBuilder = new XMLBuilder({format: true, preserveOrder: true, ignoreAttributes: false})
    return xmlBuilder.build(xbelObj)
  }

  deserialize(xbel: string) {
    const parser = new XMLParser({
      preserveOrder: true,
      ignorePiTags: true,
      ignoreAttributes: false,
      parseTagValue: false,
    })
    const xmlObj = parser.parse(xbel)

    if (!Array.isArray(xmlObj[0].xbel)) {
      throw new Error(
        'Parse Error: ' + xbel
      )
    }

    const rootFolder = new Folder({ id: 0, title: 'root', location: ItemLocation.SERVER })
    try {
      this._parseFolder(xmlObj[0].xbel, rootFolder)
    } catch (e) {
      throw new Error(
        'Parse Error: ' + e.message
      )
    }
    return rootFolder
  }

  _parseFolder(xbelObj, folder: Folder<typeof ItemLocation.SERVER>) {
    /* parse depth first */

    xbelObj
      .forEach(node => {
        let item
        if (typeof node.bookmark !== 'undefined') {
          item = new Bookmark({
            id: parseInt(node[':@']['@_id']),
            parentId: folder.id,
            url: node[':@']['@_href'],
            title: '' + (typeof node.bookmark?.[0]?.title?.[0]?.['#text'] !== 'undefined' ? node.bookmark?.[0]?.title?.[0]?.['#text'] : ''), // cast to string
            location: ItemLocation.SERVER,
          })
        } else if (typeof node.folder !== 'undefined') {
          item = new Folder({
            id: parseInt(node[':@']?.['@_id']),
            title: '' + (typeof node.folder?.[0]?.title?.[0]?.['#text'] !== 'undefined' ? node.folder?.[0]?.title?.[0]?.['#text'] : ''), // cast to string
            parentId: folder.id,
            location: ItemLocation.SERVER,
          })
          this._parseFolder(node.folder, item)
        } else {
          return
        }

        folder.children.push(item)
      })
  }

  _serializeFolder(folder: Folder<typeof ItemLocation.SERVER>) {
    return folder.children
      .map(child => {
        if (child instanceof Bookmark) {
          return {
            bookmark: [
              {title: [{'#text': child.title}]}
            ],
            ':@': {
              '@_href': child.url,
              '@_id': String(child.id)
            }
          }
        }

        if (child instanceof Folder) {
          return {
            folder: [
              {title: [{'#text': child.title}]},
              ...this._serializeFolder(child)
            ],
            ':@': {
              ...('id' in child && {'@_id': String(child.id)}),
            }
          }
        }
      })
  }
}

export default new XbelSerializer()
