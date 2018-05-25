import NextcloudAdapter from './adapters/Nextcloud'
import FakeAdapter from './adapters/Fake'
import WebDavAdapter from './adapters/WebDav'

export default class Adapter {
  static factory (data) {
    var adapter
    switch (data.type) {
      case 'nextcloud':
        adapter = new NextcloudAdapter(data)
        break
      case 'fake':
        adapter = new FakeAdapter(data)
        break
      case 'webdav':
        adapter = new WebDavAdapter(data)
        break
      default:
        throw new Error('Unknown account type')
    }
    return adapter
  }

  constructor () {
    throw new Error('Cannot instantiate abstract class')
  }

  setData () {
    throw new Error('Not implemented')
  }

  getData () {
    throw new Error('Not implemented')
  }

  getLabel () {
    throw new Error('Not implemented')
  }

  renderOptions () {
    throw new Error('Not implemented')
  }

  pullBookmarks () {
    throw new Error('Not implemented')
  }

  getBookmark () {
    throw new Error('Not implemented')
  }

  createBookmark () {
    throw new Error('Not implemented')
  }

  updateBookmark () {
    throw new Error('Not implemented')
  }

  removeBookmark () {
    throw new Error('Not implemented')
  }
}
