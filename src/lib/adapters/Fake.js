import CachingAdapter from './Caching'

export default class FakeAdapter extends CachingAdapter {
  constructor(server) {
    super()
    this.server = server
  }

  static getDefaultValues() {
    return {
      type: 'fake'
    }
  }

  setData(data) {
    this.server = data
  }

  getData() {
    return JSON.parse(JSON.stringify(this.server))
  }

  getLabel() {
    return 'Fake account (floccus)'
  }

  async getCapabilities() {
    return {
      ...(await super.getCapabilities()),
      // The fake server stands in for tag-capable servers in the test suite
      supportsTags: true,
    }
  }
}
