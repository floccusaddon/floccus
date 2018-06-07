import murmur2 from 'murmur2js'

export default class Bookmark {
  constructor(id, localId, url, title, path) {
    this.id = id
    this.localId = localId
    this.url = url
    this.title = title
    this.path = path
  }

  getLocalPath(serverRoot) {
    return this.path.substr(serverRoot.length)
  }

  async hash() {
    if (!this.hashValue) {
      this.hashValue = Bookmark.murmur2(
        JSON.stringify({
          url: this.url,
          title: this.title,
          path: this.path
        })
      )
    }
    return this.hashValue
  }

  static murmur2(message) {
    return murmur2(message)
  }
}
