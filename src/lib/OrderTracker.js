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
    this.pendingOps = 0
  }

  insert(type, fromId, toId) {
    this.pendingOps++
    return () => {
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
      this.pendingOps--
      this.checkFinished()
    }
  }

  remove(type, toId) {
    this.pendingOps++
    return () => {
      this.order.splice(
        this.order.findIndex(item => item.id === toId && item.type === type),
        1
      )
      this.pendingOps--
      this.checkFinished()
    }
  }

  async getOrder() {
    await this.onFinished()
    return this.order
  }

  isFinished() {
    return this.pendingOps === 0
  }

  onFinished() {
    return new Promise(resolve => {
      this.finishedCb = resolve
      this.checkFinished()
    })
  }

  checkFinished() {
    if (this.isFinished() && this.finishedCb) {
      this.finishedCb()
    }
  }
}
