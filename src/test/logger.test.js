import { expect } from './utils'
import util from 'util'
import Logger, { MAX_LINE_LENGTH, truncateLogLine } from '../lib/Logger'
import { Bookmark, Folder, ItemLocation } from '../lib/Tree'
import Diff, { ActionType } from '../lib/Diff'

function bigTree() {
  let id = 1
  const root = new Folder({ id: id++, title: 'root', location: ItemLocation.LOCAL })
  for (let i = 0; i < 10; i++) {
    const folder = new Folder({ id: id++, parentId: root.id, title: 'folder' + i, location: ItemLocation.LOCAL })
    root.children.push(folder)
    for (let j = 0; j < 200; j++) {
      folder.children.push(new Bookmark({
        id: id++,
        parentId: folder.id,
        title: 'bookmark' + j,
        url: 'http://example.com/' + id,
        location: ItemLocation.LOCAL,
      }))
    }
  }
  return root
}

describe('Logger', function() {
  let messages
  beforeEach(function() {
    messages = Logger.messages
    Logger.messages = []
  })
  afterEach(function() {
    Logger.messages = messages
  })

  it('logs a folder as itself rather than its whole subtree', function() {
    const root = bigTree()
    Logger.log('Executing action ', { type: 'UPDATE', payload: root, oldItem: root })
    const line = Logger.messages[Logger.messages.length - 1]
    expect(line).to.contain('#1[root]')
    expect(line).to.contain('children: 10')
    expect(line).to.not.contain('bookmark0')
    expect(line.length).to.be.below(1000)
  })

  it('summarizes a folder for util.inspect in node and in the browser polyfill', function() {
    const root = bigTree()
    expect(util.inspect(root)).to.equal(root.summarize())
    // The browser's util polyfill calls inspect(recurseTimes, ctx)
    expect(root.inspect(2, { seen: [] })).to.equal(root.summarize())
  })

  it('still prints the whole subtree when asked explicitly', function() {
    const root = bigTree()
    const full = root.inspect()
    expect(full).to.contain('bookmark199')
    // one line per bookmark, folder and the root
    expect(full.split('\n')).to.have.lengthOf(2000 + 10 + 1)
  })

  it('truncates overlong lines', function() {
    Logger.log('x'.repeat(MAX_LINE_LENGTH * 3))
    const line = Logger.messages[Logger.messages.length - 1]
    expect(line.length).to.be.below(MAX_LINE_LENGTH + 100)
    expect(line).to.match(/more characters truncated\]$/)
  })

  it('logs a whole tree over several lines, none of them truncated', function() {
    const root = bigTree()
    const full = root.inspect()
    Logger.logLines('localTreeRoot', full)
    const parts = Logger.messages
    expect(parts.length).to.be.above(1)
    const header = /^\S+ localTreeRoot \((\d+)\/(\d+)\):\n/
    const bodies = parts.map((line, i) => {
      const match = line.match(header)
      expect(match, line.slice(0, 80)).to.not.equal(null)
      expect(Number(match[1])).to.equal(i + 1)
      expect(Number(match[2])).to.equal(parts.length)
      expect(line).to.not.contain('truncated]')
      return line.replace(header, '')
    })
    expect(bodies.join('\n')).to.equal(full)
  })

  it('logs every action of a plan, without the payloads\' subtrees', function() {
    const root = bigTree()
    const diff = new Diff()
    for (const folder of root.children) {
      diff.commit({ type: ActionType.UPDATE, payload: folder, oldItem: folder })
      for (const bookmark of folder.children) {
        diff.commit({ type: ActionType.CREATE, payload: bookmark })
      }
    }
    const text = diff.inspect()
    // Too long for a single line of the log, which would cut it off
    expect(text.length).to.be.above(MAX_LINE_LENGTH)
    Logger.logLines('serverPlan', text)
    const logged = Logger.messages.join('\n')
    expect(logged).to.not.contain('truncated]')
    for (const folder of root.children) {
      expect(logged).to.contain(`#${folder.id}[${folder.title}]`)
    }
    expect(logged).to.contain('bookmark199')
    // One line per action: the folders' children appear as their own CREATEs,
    // not a second time inside their parents' UPDATEs
    expect(logged.split('[bookmark0]').length - 1).to.equal(root.children.length)
  })

  it('logs a short text as a single part', function() {
    Logger.logLines('cacheTreeRoot', 'null')
    expect(Logger.messages).to.have.lengthOf(1)
    expect(Logger.messages[0]).to.match(/ cacheTreeRoot \(1\/1\):\nnull$/)
  })

  it('leaves short lines alone', function() {
    expect(truncateLogLine('short')).to.equal('short')
    expect(truncateLogLine(undefined)).to.equal(undefined)
  })
})
