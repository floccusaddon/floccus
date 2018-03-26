import Bookmark from '../Bookmark'

const url = require('url')

export default class FakeAdapter {
  constructor (server) {
    this.server = server
    this.db = new Map()
  }

  setData (data) {
    this.server = data
  }

  getData () {
    return JSON.parse(JSON.stringify(this.server))
  }

  getLabel () {
    let data = this.getData()
    return data.username + '@' + data.url
  }

  async pullBookmarks () {
    console.log('Fetching bookmarks', this.server)

    let bookmarks = Array.from(this.db.values())
      .map(bm => {
        return new Bookmark(bm.id, null, bm.url, bm.title, bm.path)
      })

    console.log('Received bookmarks from server', bookmarks)
    return bookmarks
  }

  async getBookmark (id, autoupdate) {
    console.log('Fetching single bookmark', this.server)
    let bm = this.db.get(id)
    if (!bm) {
      throw new Error('Failed to fetch bookmark')
    }
    let bookmark = new Bookmark(bm.id, null, bm.url, bm.title, bm.path)
    return bookmark
  }

  async createBookmark (bm) {
    if (!~['https:', 'http:', 'ftp:'].indexOf(url.parse(bm.url).protocol)) {
      return false
    }

    const highestId = Array.from(this.db.keys()).reduce((highestId, bm) => {
      return highestId < bm.id ? bm.id : highestId
    }, 0)
    bm.id = highestId + 1
    this.db.set(bm.id, {
      id: bm.id
      , url: bm.url
      , title: bm.title
      , path: bm.path
    })
    return bm
  }

  async updateBookmark (remoteId, newBm) {
    if (!~['https:', 'http:', 'ftp:'].indexOf(url.parse(newBm.url).protocol)) {
      return false
    }
    let bm = await this.getBookmark(remoteId, false)

    this.db.set(bm.id, {
      id: bm.id
      , url: newBm.url
      , title: newBm.title
      , path: newBm.path
    })
    return new Bookmark(remoteId, null, newBm.url, newBm.title, newBm.path)
  }

  async removeBookmark (remoteId) {
    this.db.delete(remoteId)
  }
}
