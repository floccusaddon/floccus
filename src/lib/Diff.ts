import { Folder, TItem, ItemType } from './Tree'
import { Mapping } from './Mappings'
import Ordering from './interfaces/Ordering'
import batchingToposort from 'batching-toposort'

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
      return this.actions[type]
    }
    return [].concat(
      this.actions[ActionType.UPDATE],
      this.actions[ActionType.CREATE],
      this.actions[ActionType.MOVE],
      this.actions[ActionType.REMOVE],
      this.actions[ActionType.REORDER],
    )
  }

  static sortMoves(actions: Action[], tree: Folder) :Action[][] {
    const bookmarks = actions.filter(a => a.payload.type === ItemType.BOOKMARK)
    const folderMoves = actions.filter(a => a.payload.type === ItemType.FOLDER)
    const DAG = folderMoves
      .reduce((DAG, action1) => {
        DAG[action1.payload.id] = folderMoves.filter(action2 => {
          if (action1 === action2) {
            return false
          }
          return (
            tree.findItem(action1.payload.type, action1.payload.id) && tree.findItem(action1.payload.type, action1.payload.id).findItem(action2.payload.type, action2.payload.id) &&
            tree.findItem(action2.payload.type, action2.payload.id) && tree.findItem(action2.payload.type, action2.payload.id).findItem(ItemType.FOLDER, action1.payload.parentId)
          ) /* ||
            (
              tree.findItem(action2.payload.type, action2.payload.id) && tree.findItem(action2.payload.type, action2.payload.id).findItem(action1.payload.type, action1.payload.id) &&
              tree.findItem(action1.payload.type, action1.payload.id) && tree.findItem(action1.payload.type, action1.payload.id).findItem(ItemType.FOLDER, action2.payload.parentId)
            ) */
        })
          .map(a => a.payload.id)
        return DAG
      }, {})
    const batches = batchingToposort(DAG).map(batch => batch.map(id => folderMoves.find(a => String(a.payload.id) === String(id))))
    batches.push(bookmarks)
    batches.reverse()
    return batches
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
