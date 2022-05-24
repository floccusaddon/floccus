import Serializer from '../interfaces/Serializer'
import { Bookmark, Folder, ItemLocation } from '../Tree'

class HtmlSerializer implements Serializer {
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

  deserialize(html): Folder {
    const parser = new DOMParser()
    const document = parser.parseFromString(html, 'text/html')
    const rootFolder = new Folder({id: '', title: '', location: ItemLocation.SERVER})
    const dt = document.querySelector('dt')
    deserializeDT(dt, rootFolder)
    return rootFolder
  }
}

function deserializeDT(dt:Element, parentFolder:Folder) {
  const child = dt.firstElementChild
  if (child instanceof HTMLHeadingElement) {
    const folder = new Folder({
      parentId: parentFolder.id,
      title: child.textContent,
      id: child.id,
      location: ItemLocation.SERVER
    })
    parentFolder.children.push(folder)
    if (child.nextElementSibling instanceof HTMLDListElement) {
      const dl = child.nextElementSibling
      let element: Element = dl.querySelector('dt')
      for (;element !== dl.lastElementChild; element = element.nextElementSibling) {
        deserializeDT(element, folder)
      }
    }
  } else if (child instanceof HTMLAnchorElement) {
    parentFolder.children.push(new Bookmark({
      parentId: parentFolder.id,
      url: child.href,
      title: child.textContent,
      id: child.id,
      location: ItemLocation.SERVER
    }))
  }
}

export default new HtmlSerializer()
