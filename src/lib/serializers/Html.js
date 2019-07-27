import Serializer from '../interfaces/Serializer'
import { Bookmark, Folder } from '../Tree'

class HtmlSerializer extends Serializer {
  serialize(folder) {
    return this._serializeFolder(folder, '')
  }

  _serializeFolder(folder, indent) {
    return folder.children
      .map(child => {
        if (child instanceof Bookmark) {
          return (
            `${indent}<DT>` +
            `<A HREF="${child.url}" TAGS="${''}">${child.title}</A>`
          )
        } else if (child instanceof Folder) {
          const nextIndent = indent + '  '
          return (
            `${indent}<DT><h3>${child.title}</h3>\n` +
            `${indent}<DL><p>${this._serializeFolder(
              child,
              nextIndent
            )}</p></DL>`
          )
        }
      })
      .join('\n')
  }

  /* deserialize not implemented */
}

export default new HtmlSerializer()
