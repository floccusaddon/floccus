import Serializer from '../interfaces/Serializer'
import { Bookmark, Folder, ItemLocation, TItem } from '../Tree'
import * as cheerio from 'cheerio'

class HtmlSerializer implements Serializer {
  serialize(folder) {
    return `<DL><p>\n${this._serializeFolder(folder, '')}</DL><p>\n`
  }

  _htmlentities_encode(string) {
    return string.replace(/[<>&"']/g, char => '&#' + char.charCodeAt(0) + ';')
  }

  _serializeFolder(folder, indent) {
    return folder.children
      .map(child => {
        if (child instanceof Bookmark) {
          return (
            `${indent}<DT><A HREF="${this._htmlentities_encode(child.url)}" TAGS="${''}" ID="${child.id}">${this._htmlentities_encode(child.title)}</A>\n`
          )
        } else if (child instanceof Folder) {
          const nextIndent = indent + '  '
          return (
            `${indent}<DT><H3 ID="${child.id}">${this._htmlentities_encode(child.title)}</H3>\n` +
            `${indent}<DL><p>\n${this._serializeFolder(
              child,
              nextIndent
            )}${indent}</DL><p>\n`
          )
        }
      })
      .join('')
  }

  deserialize(html): Folder<typeof ItemLocation.SERVER> {
    const items: TItem<typeof ItemLocation.SERVER>[] = parseByString(html)
    items.forEach(f => { f.parentId = '0' })
    return new Folder({id: '0', title: 'root', children: items, location: ItemLocation.SERVER, isRoot: true})
  }
}

export default new HtmlSerializer()

// The following code is based on https://github.com/hold-baby/bookmark-file-parser
// Copyright (c) 2019 hold-baby
// MIT License

export const getRootFolder = (body: cheerio.Cheerio<any>) => {
  const h3 = body.find('h3').first()

  const isChrome = typeof h3.attr('personal_toolbar_folder') === 'string'

  if (isChrome) {
    return body.children('dl').first()
  }

  const isSafari = typeof h3.attr('folded') === 'string'

  if (isSafari) {
    return body
  }

  const isIE = typeof h3.attr('item_id') === 'string'

  if (isIE) {
    return body.children('dl').first()
  }

  const isFireFox = h3.text() === 'Mozilla Firefox'

  if (isFireFox) {
    return body.children('dl').first()
  }

  return body.children('dl').first()
}

export const parseByString = (content: string) => {
  const $ = cheerio.load(content)

  const body = $('body')
  const root: TItem<typeof ItemLocation.SERVER>[] = []
  const rdt = getRootFolder(body).children('dt')

  const parseNode = (node: cheerio.Cheerio<any>, parentId?: string|number) => {
    const eq0 = node.children().eq(0)
    const title = typeof eq0.text() !== 'undefined' ? eq0.text() : ''
    let url = ''
    const id = typeof eq0.attr('id') !== 'undefined' ? eq0.attr('id') : ''
    let children: TItem<typeof ItemLocation.SERVER>[] = []

    switch (eq0[0].name) {
      case 'h3':
        // folder
        const dl = node.children('dl').first()
        const dts = dl.children()

        const ls = dts.toArray().map((ele) => {
          if (ele.name !== 'dt') return null
          return parseNode($(ele), id)
        })
        children = ls.filter((item) => item !== null) as TItem<typeof ItemLocation.SERVER>[]
        return new Folder({id, title, parentId, children, location: ItemLocation.SERVER})
      case 'a':
        // site
        url = eq0.attr('href') || ''
        return new Bookmark({id, title, url, parentId, location: ItemLocation.SERVER})
    }
    throw new Error('Failed to parse')
  }

  rdt.each((_, item) => {
    const node = $(item)
    const child = parseNode(node)
    root.push(child)
  })

  return root
}
