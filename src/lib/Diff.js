
export const actions = {
  CREATE: 'CREATE',
  UPDATE: 'UPDATE',
  MOVE: 'MOVE',
  REMOVE: 'REMOVE',
  REORDER: 'REORDER',
}

export default class Diff {
  constructor() {
    this.actions = {
      [actions.CREATE]: [],
      [actions.UPDATE]: [],
      [actions.MOVE]: [],
      [actions.REMOVE]: [],
      [actions.REORDER]: []
    }
  }

  commit(action) {
    this.actions[action.type].push({...action})
  }

  retract(action) {
    if (this.actions[action.type]) {
      this.actions[action.type].splice(this.actions[action.type].indexOf(action), 1)
    }
  }

  add(diff) {
    diff.getActions().forEach(action => this.commit(action))
  }

  getActions(type) {
    if (type) {
      return this.sortActions(this.actions[type], type === actions.CREATE)
    }
    return [].concat(
      this.sortActions(this.actions.UPDATE),
      this.sortActions(this.actions.CREATE, true), // From high to low
      this.sortActions(this.actions.MOVE),
      this.sortActions(this.actions.REMOVE),
      this.sortActions(this.actions.REORDER),
    )
  }

  sortActions(actions, reverse) {
    // Sort from deep hierarchy to high hierarchy
    actions.slice().sort((action1, action2) => {
      if (action1.payload.findItem(action2.payload.type, action2.payload.id) ||
        (action1.oldItem && action2.oldItem && action1.oldItem.findItem(action2.oldItem.type, action2.oldItem.id))) {
        return -1
      }
      if (action2.payload.findItem(action1.payload.type, action1.payload.id) ||
        (action1.oldItem && action2.oldItem && action2.oldItem.findItem(action1.oldItem.type, action1.oldItem.id))) {
        return 1
      }
      return 0
    })
    if (reverse) {
      actions.reverse()
    }
    return actions
  }

  inspect() {
    return this.getActions()
  }

  /**
   * on ServerToLocal: don't map removals
   * on LocalToServer:
   * @param mappings
   * @param isLocalToServer
   * @param filter
   */
  map(mappings, isLocalToServer, filter = () => true) {
    // Map payloads
    this.getActions().forEach(action => {
      if (action.type === actions.REMOVE && !isLocalToServer) {
        return
      }

      if (!filter(action)) {
        return
      }

      if (action.type === actions.REORDER) {
        action.oldOrder = action.order
        action.order = action.order.slice().map(item => {
          return {...item, id: mappings[item.type + 's'][item.id]}
        })
      }

      if (action.oldItem && !isLocalToServer && action.type !== actions.MOVE) {
        const payload = action.payload.clone()
        payload.id = action.oldItem.id
        payload.parentId = action.oldItem.parentId
        const oldItem = action.oldItem.clone()
        oldItem.id = action.payload.id
        oldItem.parentId = action.payload.parentId
        action.oldItem = oldItem
        action.payload = payload
      } else {
        const item = action.payload.clone()
        item.id = mappings[item.type + 's'][item.id]
        item.parentId = mappings.folders[item.parentId]

        action.oldItem = action.payload
        action.payload = item
      }
    })
  }
}
