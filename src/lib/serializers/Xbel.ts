import Serializer from '../interfaces/Serializer'
import { Bookmark, Folder, ItemLocation } from '../Tree'
import { XMLParser, XMLBuilder } from 'fast-xml-parser'
import Logger from '../Logger'
import { XbelParseError } from '../../errors/Error'

class XbelSerializer implements Serializer {
  private _nextId: number

  // The highest id assigned during the last deserialize() call -- includes both the ids found in
  // the document and any fallback ids handed out below. Callers that track their own id counter
  // (e.g. adapters reading a "highestId" marker from the file) should adopt this value afterwards
  // so ids they assign to newly created items don't collide with the fallback ids just issued.
  highestId = 0

  serialize(folder: Folder<typeof ItemLocation.SERVER>) {
    const xbelObj = this._serializeFolder(folder)
    const xmlBuilder = new XMLBuilder({format: true, preserveOrder: true, ignoreAttributes: false})
    return xmlBuilder.build(xbelObj)
  }

  deserialize(xbel: string, highestId = 0) {
    const parser = new XMLParser({
      preserveOrder: true,
      ignorePiTags: true,
      ignoreAttributes: false,
      parseTagValue: false,
      processEntities: {
        maxTotalExpansions: Infinity,
        maxEntityCount: Infinity,
      },
    })
    let xmlObj
    try {
      xmlObj = parser.parse(xbel)
    } catch (e) {
      Logger.log('Parse Error: ' + e.message)
      throw new XbelParseError()
    }

    if (!Array.isArray(xmlObj[0].xbel)) {
      throw new XbelParseError()
    }

    const rootFolder = new Folder({ id: 0, title: 'root', location: ItemLocation.SERVER })
    try {
      // Items without a resolvable numeric id (e.g. missing/malformed @id attribute) must not be
      // parsed to NaN: NaN ids break identity matching against the cache/local tree on the next sync
      // (duplicate folders, spurious delete+create diffs). Assign them the next id in the same
      // positive, ever-incrementing id space that's used for genuinely new items (see
      // CachingAdapter), continuing from the caller's highestId, so they behave exactly like a
      // freshly created bookmark instead of a separate id scheme.
      this._nextId = highestId + 1
      this._parseFolder(xmlObj[0].xbel, rootFolder)
    } catch (e) {
      Logger.log('Parse Error: ' + e.message)
      throw new XbelParseError()
    }
    this.highestId = this._nextId - 1
    return rootFolder
  }

  _parseId(rawId: string): number {
    const id = parseInt(rawId)
    if (Number.isNaN(id)) {
      return this._nextId++
    }
    if (id >= this._nextId) {
      this._nextId = id + 1
    }
    return id
  }

  _parseFolder(xbelObj, folder: Folder<typeof ItemLocation.SERVER>) {
    /* parse depth first */

    xbelObj
      .forEach(node => {
        let item
        if (typeof node.bookmark !== 'undefined') {
          item = new Bookmark({
            id: this._parseId(node[':@']['@_id']),
            parentId: folder.id,
            url: node[':@']['@_href'],
            title: '' + (typeof node.bookmark?.[0]?.title?.[0]?.['#text'] !== 'undefined' ? node.bookmark?.[0]?.title?.[0]?.['#text'] : ''), // cast to string
            location: ItemLocation.SERVER,
          })
        } else if (typeof node.folder !== 'undefined') {
          item = new Folder({
            id: this._parseId(node[':@']?.['@_id']),
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
