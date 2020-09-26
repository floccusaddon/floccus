
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
      return Diff.sortActions(this.actions[type], type === actions.CREATE)
    }
    return [].concat(
      Diff.sortActions(this.actions.UPDATE),
      Diff.sortActions(this.actions.CREATE, true), // From high to low
      Diff.sortActions(this.actions.MOVE),
      Diff.sortActions(this.actions.REMOVE),
      Diff.sortActions(this.actions.REORDER),
    )
  }

  static sortActions(actions, reverse, tree) {
    // Sort from deep hierarchy to high hierarchy
    actions.slice().sort((action1, action2) => {
      // Tier 1: Relationship in source tree
      if (
        // Move this action down, If it's item contains the other item
        (
          (tree && tree.findItem(action1.payload.type, action1.payload.id) && tree.findItem(action1.payload.type, action1.payload.id).findItem(action2.payload.type, action2.payload.id)) ||
          action1.payload.findItem(action2.payload.type, action2.payload.id) ||
          (action1.oldItem && action2.oldItem && action1.oldItem.findItem(action2.oldItem.type, action2.oldItem.id))
        ) &&
        // and its target is in the other item
        (
          (tree && tree.findItem(action2.payload.type, action2.payload.id) && tree.findItem(action2.payload.type, action2.payload.id).findItem('folder', action1.payload.parentId)) ||
          action2.payload.findItem('folder', action1.payload.parentId) ||
          (action1.oldItem && action2.oldItem && action2.oldItem.findItem('folder', action1.oldItem.parentId))
        )
      ) {
        return -1
      }
      if (
        // Move this action up, if its item is contained in the other item
        (
          (tree && tree.findItem(action2.payload.type, action2.payload.id) && tree.findItem(action2.payload.type, action2.payload.id).findItem(action1.payload.type, action1.payload.id)) ||
          action2.payload.findItem(action1.payload.type, action1.payload.id) ||
          (action1.oldItem && action2.oldItem && action2.oldItem.findItem(action1.oldItem.type, action1.oldItem.id))
        ) &&
        // and  its item contains the other one's target
        (
          (tree && tree.findItem(action1.payload.type, action1.payload.id) && tree.findItem(action1.payload.type, action1.payload.id).findItem('folder', action2.payload.parentId)) ||
          action1.payload.findItem('folder', action2.payload.parentId) ||
          (action1.oldItem && action2.oldItem && action1.oldItem.findItem('folder', action2.oldItem.parentId))
        )
      ) {
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
