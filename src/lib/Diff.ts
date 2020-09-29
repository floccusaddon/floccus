import { Folder, TItem, ItemType } from './Tree'
import { Mapping } from './Mappings'
import Ordering from './interfaces/Ordering'

export const ActionType = {
  CREATE: 'CREATE',
  UPDATE: 'UPDATE',
  MOVE: 'MOVE',
  REMOVE: 'REMOVE',
  REORDER: 'REORDER',
} as const

export type TActionType = (typeof ActionType)[keyof typeof ActionType];

export interface CreateAction {
  type: 'CREATE',
  payload: TItem,
  oldItem?: TItem,
}

export interface UpdateAction {
  type: 'UPDATE',
  payload: TItem,
  oldItem?: TItem,
}

export interface RemoveAction {
  type: 'REMOVE',
  payload: TItem,
  oldItem?: TItem,
  index?: number,
  oldIndex?: number,
}

export interface ReorderAction {
  type: 'REORDER',
  payload: TItem,
  oldItem?: TItem,
  order?: Ordering,
  oldOrder?: Ordering,
}

export interface MoveAction {
  type: 'MOVE',
  payload: TItem,
  oldItem: TItem,
  index?: number,
  oldIndex?: number,
}

export type Action = CreateAction|UpdateAction|RemoveAction|ReorderAction|MoveAction

export default class Diff {
  private readonly actions: {
    [ActionType.CREATE]: CreateAction[],
    [ActionType.UPDATE]: UpdateAction[],
    [ActionType.MOVE]: MoveAction[],
    [ActionType.REMOVE]: RemoveAction[],
    [ActionType.REORDER]: ReorderAction[]
  }

  constructor() {
    this.actions = {
      [ActionType.CREATE]: [],
      [ActionType.UPDATE]: [],
      [ActionType.MOVE]: [],
      [ActionType.REMOVE]: [],
      [ActionType.REORDER]: []
    }
  }

  commit(action: Action):void {
    switch (action.type) {
      case ActionType.CREATE:
        this.actions[action.type].push({ ...action })
        break
      case ActionType.UPDATE:
        this.actions[action.type].push({ ...action })
        break
      case ActionType.MOVE:
        this.actions[action.type].push({ ...action })
        break
      case ActionType.REMOVE:
        this.actions[action.type].push({ ...action })
        break
      case ActionType.REORDER:
        this.actions[action.type].push({ ...action })
    }
  }

  retract(action: Action):void {
    switch (action.type) {
      case ActionType.CREATE:
        this.actions[action.type].splice(this.actions[action.type].indexOf(action), 1)
        break
      case ActionType.UPDATE:
        this.actions[action.type].splice(this.actions[action.type].indexOf(action), 1)
        break
      case ActionType.MOVE:
        this.actions[action.type].splice(this.actions[action.type].indexOf(action), 1)
        break
      case ActionType.REMOVE:
        this.actions[action.type].splice(this.actions[action.type].indexOf(action), 1)
        break
      case ActionType.REORDER:
        this.actions[action.type].splice(this.actions[action.type].indexOf(action), 1)
        break
    }
  }

  add(diff: Diff):void {
    diff.getActions().forEach(action => this.commit(action))
  }

  getActions(type?: TActionType):Action[] {
    if (type) {
      return Diff.sortActions(this.actions[type], type === ActionType.CREATE)
    }
    return [].concat(
      Diff.sortActions(this.actions[ActionType.UPDATE]),
      Diff.sortActions(this.actions[ActionType.CREATE], true), // From high to low
      Diff.sortActions(this.actions[ActionType.MOVE]),
      Diff.sortActions(this.actions[ActionType.REMOVE]),
      Diff.sortActions(this.actions[ActionType.REORDER]),
    )
  }

  static sortActions(actions: Action[], reverse = false, tree?: Folder) :Action[] {
    // Sort from deep hierarchy to high hierarchy
    actions.slice().sort((action1, action2) => {
      // Tier 1: Relationship in source tree
      if (
        // Move this action down, If it's item contains the other item
        (
          (tree && tree.findItem(action1.payload.type, action1.payload.id) && tree.findItem(action1.payload.type, action1.payload.id).findItem(action2.payload.type, action2.payload.id)) ||
          action1.payload.findItem(action2.payload.type, action2.payload.id) ||
          ('oldItem' in action1 && 'oldItem' in action2 && action1.oldItem.findItem(action2.oldItem.type, action2.oldItem.id))
        ) &&
        // and its target is in the other item
        (
          (tree && tree.findItem(action2.payload.type, action2.payload.id) && tree.findItem(action2.payload.type, action2.payload.id).findItem(ItemType.FOLDER, action1.payload.parentId)) ||
          action2.payload.findItem(ItemType.FOLDER, action1.payload.parentId) ||
          ('oldItem' in action1 && 'oldItem' in action2 && action2.oldItem.findItem(ItemType.FOLDER, action1.oldItem.parentId))
        )
      ) {
        return -1
      }
      if (
        // Move this action up, if its item is contained in the other item
        (
          (tree && tree.findItem(action2.payload.type, action2.payload.id) && tree.findItem(action2.payload.type, action2.payload.id).findItem(action1.payload.type, action1.payload.id)) ||
          action2.payload.findItem(action1.payload.type, action1.payload.id) ||
          ('oldItem' in action1 && 'oldItem' in action2 && action2.oldItem.findItem(action1.oldItem.type, action1.oldItem.id))
        ) &&
        // and  its item contains the other one's target
        (
          (tree && tree.findItem(action1.payload.type, action1.payload.id) && tree.findItem(action1.payload.type, action1.payload.id).findItem(ItemType.FOLDER, action2.payload.parentId)) ||
          action1.payload.findItem(ItemType.FOLDER, action2.payload.parentId) ||
          ('oldItem' in action1 && 'oldItem' in action2 && action1.oldItem.findItem(ItemType.FOLDER, action2.oldItem.parentId))
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

  inspect(): Action[] {
    return this.getActions()
  }

  /**
   * on ServerToLocal: don't map removals
   * on LocalToServer:
   * @param mappings
   * @param isLocalToServer
   * @param filter
   */
  map(mappings:Mapping, isLocalToServer: boolean, filter: (Action)=>boolean = () => true):void {
    // Map payloads
    this.getActions().forEach(action => {
      if (action.type === ActionType.REMOVE && !isLocalToServer) {
        return
      }

      if (!filter(action)) {
        return
      }

      if (action.type === ActionType.REORDER) {
        action.oldOrder = action.order
        action.order = action.order.slice().map(item => {
          return {...item, id: mappings[item.type ][item.id]}
        })
      }

      if ('oldItem' in action && !isLocalToServer && action.type !== ActionType.MOVE) {
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
        item.id = mappings[item.type ][item.id]
        item.parentId = mappings.folder[item.parentId]

        action.oldItem = action.payload
        action.payload = item
      }
    })
  }
}
