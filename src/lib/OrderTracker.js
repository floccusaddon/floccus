export default class OrderTracker {
  constructor({ fromFolder, toFolder }) {
    this.fromFolder = fromFolder
    this.toFolder = toFolder
    this.order = toFolder
      ? toFolder.children.map(child => ({
          type: child.type,
          id: child.id
        }))
      : []
  }

  insert(type, fromId, toId) {
    const entry = {
      type: type,
      id: toId
    }
    this.order.splice(
      this.fromFolder.children.findIndex(
        child => child.id === fromId && child.type === type
      ),
      0,
      entry
    )
  }

  remove(type, toId) {
    this.order.splice(
      this.order.findIndex(item => item.id === toId && item.type === type),
      1
    )
  }

  getOrder() {
    return this.order
  }
}
