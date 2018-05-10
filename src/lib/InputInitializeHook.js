
export default class InputInitializeHook {
  constructor (initStr) { this.initStr = initStr }
  hook (node, propertyName, previousValue) {
    if (typeof previousValue !== 'undefined') return
    node[propertyName] = this.initStr
  }
}

