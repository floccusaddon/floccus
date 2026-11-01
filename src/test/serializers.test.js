import { expect } from './utils'
import Html from '../lib/serializers/Html'
import XbelSerializer from '../lib/serializers/Xbel'

const html = (body) => `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
<DL><p>
${body}
</DL><p>`

const xbel = (body) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE xbel PUBLIC "+//IDN python.org//DTD XML Bookmark Exchange Language 1.0//EN//XML" "http://pyxml.sourceforge.net/topics/dtds/xbel.dtd">
<xbel version="1.0">
${body}
</xbel>`

// Flattens a tree to "title|url" -> id, which is what has to stay put
function idsByContent(folder, prefix = '') {
  const ids = {}
  for (const child of folder.children) {
    const key = prefix + '/' + child.title + (child.type === 'bookmark' ? '|' + child.url : '')
    expect(ids[key]).to.equal(undefined)
    ids[key] = String(child.id)
    expect(String(child.parentId)).to.equal(String(folder.id))
    if (child.type === 'folder') {
      Object.assign(ids, idsByContent(child, key))
    }
  }
  return ids
}

function allIds(folder) {
  return folder.children.flatMap(child =>
    [String(child.id), ...(child.type === 'folder' ? allIds(child) : [])]
  )
}

const formats = {
  html: {
    serializer: Html,
    bookmark: (title, url, id) => `<DT><A HREF="${url}"${id ? ` ID="${id}"` : ''}>${title}</A>`,
    folder: (title, children, id) => `<DT><H3${id ? ` ID="${id}"` : ''}>${title}</H3>\n<DL><p>\n${children.join('\n')}\n</DL><p>`,
    wrap: html,
    // serialize() already emits the outer <DL>, like WebDav's createHTML expects
    document: (serialized) => `<!DOCTYPE NETSCAPE-Bookmark-file-1>\n<TITLE>Bookmarks</TITLE>\n${serialized}`,
  },
  xbel: {
    serializer: XbelSerializer,
    bookmark: (title, url, id) => `<bookmark href="${url}"${id ? ` id="${id}"` : ''}><title>${title}</title></bookmark>`,
    folder: (title, children, id) => `<folder${id ? ` id="${id}"` : ''}><title>${title}</title>\n${children.join('\n')}\n</folder>`,
    wrap: xbel,
    document: xbel,
  },
}

describe('Bookmark file serializers', function() {
  Object.entries(formats).forEach(([name, { serializer, bookmark, folder, wrap, document }]) => {
    describe(name + ': files without ids', function() {
      const parse = (items) => serializer.deserialize(wrap(items.join('\n')))

      it('gives every item a distinct negative id', function() {
        const tree = parse([
          bookmark('A', 'https://a.example/'),
          folder('F', [bookmark('B', 'https://b.example/'), folder('G', [])]),
        ])
        const ids = allIds(tree)
        expect(ids).to.have.lengthOf(4)
        expect(new Set(ids).size).to.equal(4)
        ids.forEach(id => {
          expect(Number(id)).to.be.below(0)
          expect(Number.isSafeInteger(Number(id))).to.equal(true)
        })
        idsByContent(tree) // checks parentIds
      })

      it('keeps ids when items are inserted, removed or reordered elsewhere', function() {
        const before = idsByContent(parse([
          bookmark('A', 'https://a.example/'),
          folder('F', [bookmark('B', 'https://b.example/'), folder('G', [bookmark('C', 'https://c.example/')])]),
          bookmark('D', 'https://d.example/'),
        ]))
        const after = idsByContent(parse([
          bookmark('New', 'https://new.example/'),
          bookmark('D', 'https://d.example/'),
          folder('F', [folder('G', [bookmark('C', 'https://c.example/')]), bookmark('Other', 'https://other.example/'), bookmark('B', 'https://b.example/')]),
        ]))
        for (const key of ['/D|https://d.example/', '/F', '/F/B|https://b.example/', '/F/G', '/F/G/C|https://c.example/']) {
          expect(after[key]).to.equal(before[key])
        }
      })

      it('keeps a bookmark\'s id when it moves to another folder', function() {
        const before = idsByContent(parse([
          folder('F', [bookmark('B', 'https://b.example/')]),
          folder('G', []),
        ]))
        const after = idsByContent(parse([
          folder('F', []),
          folder('G', [bookmark('B', 'https://b.example/')]),
        ]))
        expect(after['/G/B|https://b.example/']).to.equal(before['/F/B|https://b.example/'])
      })

      it('gives a renamed folder a new id', function() {
        const before = idsByContent(parse([folder('F', [])]))
        const after = idsByContent(parse([folder('Renamed', [])]))
        expect(after['/Renamed']).to.not.equal(before['/F'])
      })

      it('tells duplicates apart', function() {
        const tree = parse([
          bookmark('A', 'https://a.example/'),
          bookmark('A again', 'https://a.example/'),
          folder('F', [bookmark('A in F', 'https://a.example/')]),
          folder('F', []),
        ])
        expect(new Set(allIds(tree)).size).to.equal(5)
      })

      it('never reuses an id the file already contains', function() {
        const derived = String(parse([bookmark('A', 'https://a.example/')]).children[0].id)
        const tree = parse([
          bookmark('Has the id already', 'https://other.example/', derived),
          bookmark('A', 'https://a.example/'),
        ])
        expect(String(tree.children[0].id)).to.equal(derived)
        expect(String(tree.children[1].id)).to.not.equal(derived)
      })

      it('leaves explicit ids alone and reads its own ids back unchanged', function() {
        const tree = parse([
          bookmark('A', 'https://a.example/', '5'),
          folder('F', [bookmark('B', 'https://b.example/')], '7'),
        ])
        expect(String(tree.children[0].id)).to.equal('5')
        expect(String(tree.children[1].id)).to.equal('7')
        const ids = idsByContent(tree)

        const roundTripped = serializer.deserialize(document(serializer.serialize(tree)))
        expect(idsByContent(roundTripped)).to.deep.equal(ids)
      })

      it('asks for the file to be written only if some items had ids and others didn\'t', function() {
        const persistIds = (items) => serializer.deserializeFile(wrap(items.join('\n'))).persistIds
        // another program's file: it would strip the ids again anyway
        expect(persistIds([
          bookmark('A', 'https://a.example/'),
          folder('F', [bookmark('B', 'https://b.example/')]),
        ])).to.equal(false)
        // floccus' own file: nothing to store
        expect(persistIds([
          bookmark('A', 'https://a.example/', '1'),
          folder('F', [bookmark('B', 'https://b.example/', '3')], '2'),
        ])).to.equal(false)
        // floccus' file with items added by a program that keeps ids
        expect(persistIds([
          bookmark('A', 'https://a.example/', '1'),
          folder('F', [bookmark('New', 'https://new.example/')], '2'),
        ])).to.equal(true)
        // deserialize() is the same tree
        const items = [bookmark('A', 'https://a.example/', '1'), bookmark('New', 'https://new.example/')]
        expect(idsByContent(serializer.deserialize(wrap(items.join('\n')))))
          .to.deep.equal(idsByContent(serializer.deserializeFile(wrap(items.join('\n'))).tree))
      })

      it('needs no further write once the derived ids are stored', function() {
        const tree = serializer.deserializeFile(wrap([
          bookmark('A', 'https://a.example/', '1'),
          folder('F', [bookmark('New', 'https://new.example/')], '2'),
        ].join('\n'))).tree
        const reread = serializer.deserializeFile(document(serializer.serialize(tree)))
        expect(reread.persistIds).to.equal(false)
        expect(idsByContent(reread.tree)).to.deep.equal(idsByContent(tree))
      })

      it('derives the same ids again after another program strips them', function() {
        const items = [
          bookmark('A', 'https://a.example/'),
          folder('F', [bookmark('B', 'https://b.example/'), folder('G', [])]),
        ]
        const first = parse(items)
        // floccus wrote the file with the derived ids...
        const written = idsByContent(serializer.deserialize(document(serializer.serialize(first))))
        // ...and another program rewrote it without any
        expect(idsByContent(parse(items))).to.deep.equal(written)
      })
    })
  })
})
