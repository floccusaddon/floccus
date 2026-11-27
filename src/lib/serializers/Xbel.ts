import Serializer, { IDeserializedFile } from '../interfaces/Serializer'
import { Bookmark, Folder, ItemLocation } from '../Tree'
import { XMLParser, XMLBuilder } from 'fast-xml-parser'
import Logger from '../Logger'
import { XbelParseError } from '../../errors/Error'
import { assignDerivedIds, mustPersistDerivedIds } from './DerivedIds'

/**
 * XBEL has no notion of tags. Its extension point is
 * `<info><metadata owner="URI">`, whose content readers that don't know the
 * owner ignore, so a bookmark's tags go there:
 *
 *   <bookmark href="..."><title>...</title>
 *     <info><metadata owner="https://floccus.org"><tag>a</tag><tag>b</tag></metadata></info>
 *   </bookmark>
 */
export const FLOCCUS_METADATA_OWNER = 'https://floccus.org'

class XbelSerializer implements Serializer {
  serialize(folder: Folder<typeof ItemLocation.SERVER>) {
    const xbelObj = this._serializeFolder(folder)
    const xmlBuilder = new XMLBuilder({format: true, preserveOrder: true, ignoreAttributes: false})
    return xmlBuilder.build(xbelObj)
  }

  deserialize(xbel: string): Folder<typeof ItemLocation.SERVER> {
    return this.deserializeFile(xbel).tree
  }

  deserializeFile(xbel: string): IDeserializedFile {
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
      this._parseFolder(xmlObj[0].xbel, rootFolder)
    } catch (e) {
      Logger.log('Parse Error: ' + e.message)
      throw new XbelParseError()
    }
    // Items without an id (parsed as NaN) get one derived from their content
    const stats = assignDerivedIds(rootFolder)
    return { tree: rootFolder, persistIds: mustPersistDerivedIds(stats) }
  }

  _parseFolder(xbelObj, folder: Folder<typeof ItemLocation.SERVER>) {
    /* parse depth first */

    xbelObj
      .forEach(node => {
        let item
        if (typeof node.bookmark !== 'undefined') {
          item = new Bookmark({
            id: parseInt(node[':@']?.['@_id']),
            parentId: folder.id,
            url: node[':@']['@_href'],
            title: '' + (typeof node.bookmark?.[0]?.title?.[0]?.['#text'] !== 'undefined' ? node.bookmark?.[0]?.title?.[0]?.['#text'] : ''), // cast to string
            tags: this._parseTags(node.bookmark),
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

  /**
   * A file has nothing to hide: a bookmark without floccus metadata has no
   * tags, so this never returns undefined ("unknown") -- otherwise removing
   * the last tag of a bookmark could never reach the other clients.
   */
  _parseTags(bookmarkChildren): string[] {
    const tags: string[] = []
    if (!Array.isArray(bookmarkChildren)) {
      return tags
    }
    for (const child of bookmarkChildren) {
      if (!Array.isArray(child.info)) continue
      for (const infoChild of child.info) {
        if (!Array.isArray(infoChild.metadata) || infoChild[':@']?.['@_owner'] !== FLOCCUS_METADATA_OWNER) continue
        for (const metadataChild of infoChild.metadata) {
          if (!Array.isArray(metadataChild.tag)) continue
          tags.push(metadataChild.tag.map(text => typeof text['#text'] !== 'undefined' ? '' + text['#text'] : '').join(''))
        }
      }
    }
    return tags
  }

  _serializeTags(tags?: string[]) {
    if (!tags || !tags.length) {
      return []
    }
    return [{
      info: [{
        metadata: tags.map(tag => ({tag: [{'#text': tag}]})),
        ':@': {'@_owner': FLOCCUS_METADATA_OWNER},
      }],
    }]
  }

  _serializeFolder(folder: Folder<typeof ItemLocation.SERVER>) {
    return folder.children
      .map(child => {
        if (child instanceof Bookmark) {
          return {
            bookmark: [
              {title: [{'#text': child.title}]},
              ...this._serializeTags(child.tags),
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
