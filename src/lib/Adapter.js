import Resource from './Resource'
import NextcloudAdapter from './adapters/Nextcloud'
import FakeAdapter from './adapters/Fake'
import WebDavAdapter from './adapters/WebDav'

export default class Adapter extends Resource {
  static factory(data) {
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

  constructor() {
    throw new Error('Cannot instantiate abstract class')
  }

  /**
   * @param Object the account data entered in the options
   */
  setAccountData(data) {
    throw new Error('Not implemented')
  }

  getAccountData() {
    throw new Error('Not implemented')
  }

  /**
   * The label for this account based on the account data
   */
  getLabel() {
    throw new Error('Not implemented')
  }

  /**
   * @return hyperapp-tree The options UI for this adapter
   */
  static renderOptions(state, actions) {
    throw new Error('Not implemented')
  }

  /**
   * @return Object the default values of the account data for this adapter
   */
  static getDefaultValues() {
    throw new Error('Not implemented')
  }

  /**
   * Optional hook to do something on sync start
   */
  async onSyncStart() {}

  /**
   * Optional hook to do something on sync completion
   */
  async onSyncComplete() {}

  /**
   * Optional hook to do something on sync fail
   */
  async onSyncFail() {}
}
