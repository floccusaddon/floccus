import Resource from './Resource'

export default class Adapter extends Resource {
  static register(type, constructor) {
    if (!this.registry) {
      this.registry = {}
    }
    this.registry[type] = constructor
  }

  static factory(data) {
    const constructor = this.registry[data.type]
    let adapter
    if (constructor) {
      adapter = new constructor(data)
    } else {
      throw new Error('Unknown account type')
    }
    return adapter
  }

  constructor() {
    super()
    if (this.constructor === Adapter) {
      throw new Error('Cannot instantiate abstract class')
    }
  }

  /**
   * @param data
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
   * @return Boolean true if the bookmark type can be handled by the adapter
   */
  acceptsBookmark(bookmark) {
    return true
  }

  /**
   * run this.f(...args) between onSyncStart and onSyncComplete
   */
  async withHooks(f, ...args) {
    if (this.onSyncStart) await this.onSyncStart()
    let ret = await f.call(this, ...args)
    if (this.onSyncComplete) await this.onSyncComplete()
    return ret
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
