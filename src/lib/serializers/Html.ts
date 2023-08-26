import Serializer from '../interfaces/Serializer'
import { Bookmark, Folder, ItemLocation } from '../Tree'
import { DOMParser as LinkeDOMParser } from 'linkedom'

class HtmlSerializer implements Serializer {
  serialize(folder: Folder) {
    return `<DL><p>\n${this._serializeFolder(folder, '    ')}\n</p></DL>\n`
  }

  _serializeFolder(folder, indent) {
    return folder.children
      .map(child => {
        if (child instanceof Bookmark) {
          return (
            `${indent}<DT>` +
            `<A HREF="${child.url}" TAGS="${''}" ID="${child.id}">${child.title}</A>`
          )
        } else if (child instanceof Folder) {
          const nextIndent = indent + '    '
          return (
            `${indent}<DT><h3 ID="${child.id}">${child.title}</h3>\n` +
            `${indent}<DL><p>\n${indent}${this._serializeFolder(
              child,
              nextIndent
            )}\n${indent}</p></DL>\n`
          )
        }
      })
      .join('\n')
  }

  deserialize(html): Folder {
    const parser = /* typeof DOMParser !== 'undefined' ? new DOMParser() : */ new LinkeDOMParser()
    const document = parser.parseFromString(html, 'text/html')
    const rootFolder = new Folder({id: '', title: '', location: ItemLocation.SERVER})
    const dl = document.querySelector('dl')
    const counter = {highestId: 1}
    deserializeDL(dl, rootFolder, counter)
    return rootFolder
  }
}

function deserializeDL(dl, parentFolder:Folder, counter:{highestId: number}) {
  for (let element = dl.querySelector('dt'); element; element = element.nextElementSibling) {
    const child = element.firstElementChild
    if (child.tagName === 'H3') {
      const folder = new Folder({
        parentId: parentFolder.id,
        title: child.textContent,
        id: child.getAttribute('ID') || child.getAttribute('id') ? parseInt(child.getAttribute('ID') || child.getAttribute('id')) : counter.highestId++,
        location: ItemLocation.SERVER
      })
      parentFolder.children.push(folder)
      if (child.nextElementSibling.tagName === 'DL') {
        const dl = child.nextElementSibling
        deserializeDL(dl, folder, counter)
      }
    } else if (child.tagName === 'A') {
      parentFolder.children.push(new Bookmark({
        parentId: parentFolder.id,
        url: child.getAttribute('HREF'),
        title: child.textContent,
        id: child.getAttribute('ID') || child.getAttribute('id') ? parseInt(child.getAttribute('ID') || child.getAttribute('id')) : counter.highestId++,
        location: ItemLocation.SERVER
      }))
    }
  }
}

export default new HtmlSerializer()
