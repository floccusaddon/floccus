import Serializer from '../interfaces/Serializer'
import { Bookmark, Folder, ItemLocation } from '../Tree'

class HtmlSerializer implements Serializer {
  serialize(folder) {
    return `<DL><p>${this._serializeFolder(folder, '')}</p></DL>`
  }

  _serializeFolder(folder, indent) {
    return folder.children
      .map(child => {
        if (child instanceof Bookmark) {
          return (
            `${indent}<DT>` +
            `<A HREF="${child.url}" TAGS="${''}" id="${child.id}">${child.title}</A>`
          )
        } else if (child instanceof Folder) {
          const nextIndent = indent + '  '
          return (
            `${indent}<DT><h3 id="${child.id}">${child.title}</h3>\n` +
            `${indent}<DL><p>${this._serializeFolder(
              child,
              nextIndent
            )}</p></DL>`
          )
        }
      })
      .join('\n')
  }

  deserialize(html): Folder {
    const parser = new DOMParser()
    const document = parser.parseFromString(html, 'text/html')
    const rootFolder = new Folder({id: '', title: '', location: ItemLocation.SERVER})
    const dl = document.querySelector('dl')
    const counter = {highestId: 1}
    deserializeDL(dl, rootFolder, counter)
    return rootFolder
  }
}

function deserializeDL(dl:Element, parentFolder:Folder, counter:{highestId: number}) {
  for (let element:Element = dl.querySelector('dt'); element; element = element.nextElementSibling) {
    const child = element.firstElementChild
    if (child instanceof HTMLHeadingElement) {
      const folder = new Folder({
        parentId: parentFolder.id,
        title: child.textContent,
        id: child.id ? parseInt(child.id) : counter.highestId++,
        location: ItemLocation.SERVER
      })
      parentFolder.children.push(folder)
      if (child.nextElementSibling instanceof HTMLDListElement) {
        const dl = child.nextElementSibling
        deserializeDL(dl, folder, counter)
      }
    } else if (child instanceof HTMLAnchorElement) {
      parentFolder.children.push(new Bookmark({
        parentId: parentFolder.id,
        url: child.href,
        title: child.textContent,
        id: child.id ? parseInt(child.id) : counter.highestId++,
        location: ItemLocation.SERVER
      }))
    }
  }
}

export default new HtmlSerializer()
