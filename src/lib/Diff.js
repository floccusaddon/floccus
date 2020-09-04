
export const actions = {
  CREATE: 'CREATE',
  UPDATE: 'UPDATE',
  MOVE: 'MOVE',
  REMOVE: 'REMOVE',
}

export default class Diff {
  constructor() {
    this.actions = {
      [actions.CREATE]: [],
      [actions.UPDATE]: [],
      [actions.MOVE]: [],
      [actions.REMOVE]: []
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

  getActions() {
    return [].concat(
      this.sortActions(this.actions.UPDATE),
      this.sortActions(this.actions.CREATE),
      this.sortActions(this.actions.MOVE),
      this.sortActions(this.actions.REMOVE)
    )
  }

  sortActions(actions) {
    actions.sort((action1, action2) => {
      if (action1.payload.type === 'folder' && action1.payload.findItem(action2.payload.type, action2.payload.id)) {
        return -1
      }
      if (action2.payload.type === 'folder' && action2.payload.findItem(action1.payload.type, action1.payload.id)) {
        return 1
      }
      return 0
    })
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
   */
  map(mappings, isLocalToServer) {
    // Map payloads
    this.getActions().forEach(action => {
      if (action.type === actions.REMOVE && !isLocalToServer) {
        return
      }

      if (action.oldItem && !isLocalToServer) {
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
