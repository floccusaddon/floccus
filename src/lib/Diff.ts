import { Folder, TItem, ItemType, TItemLocation, ItemLocation } from './Tree'
import Mappings, { MappingSnapshot } from './Mappings'
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
  index?: number,
  oldIndex?: number,
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
  order: Ordering,
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

  getActions(type?: TActionType):Action[] {
    if (type) {
      return this.actions[type].slice()
    }
    return [].concat(
      this.actions[ActionType.UPDATE],
      this.actions[ActionType.CREATE],
      this.actions[ActionType.MOVE],
      this.actions[ActionType.REMOVE],
      this.actions[ActionType.REORDER],
    )
  }

  static findChain(mappingsSnapshot: MappingSnapshot, actions: Action[], currentItem: TItem, targetAction: Action, chain: Action[] = []): boolean {
    if (
      targetAction.payload.findItem(ItemType.FOLDER,
        Mappings.mapParentId(mappingsSnapshot, currentItem, targetAction.payload.location))
    ) {
      return true
    }
    const newCurrentAction = actions.find(targetAction =>
      !chain.includes(targetAction) && targetAction.payload.findItem(ItemType.FOLDER, Mappings.mapParentId(mappingsSnapshot, currentItem, targetAction.payload.location))
    )
    if (newCurrentAction) {
      return Diff.findChain(mappingsSnapshot, actions, newCurrentAction.payload, targetAction, [...chain, newCurrentAction])
    }
    return false
  }

  static sortMoves(actions: Action[], tree: Folder) :Action[][] {
    const bookmarks = actions.filter(a => a.payload.type === ItemType.BOOKMARK)
    const folderMoves = actions.filter(a => a.payload.type === ItemType.FOLDER)
    const DAG = folderMoves
      .reduce((DAG, action1) => {
        DAG[action1.payload.id] = folderMoves.filter(action2 => {
          if (action1 === action2 || action1.payload.id === action2.payload.id) {
            return false
          }
          return (
            (tree.findItem(action1.payload.type, action1.payload.id) && tree.findItem(action1.payload.type, action1.payload.id).findItem(action2.payload.type, action2.payload.id))
          )
        })
          .map(a => a.payload.id)
        return DAG
      }, {})
    let batches
    try {
      batches = batchingToposort(DAG).map(batch => batch.map(id => folderMoves.find(a => String(a.payload.id) === String(id))))
    } catch (e) {
      console.log({DAG, tree, actions})
      throw e
    }
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
   * @param mappingsSnapshot
   * @param targetLocation
   * @param filter
   */
  map(mappingsSnapshot:MappingSnapshot, targetLocation: TItemLocation, filter: (Action)=>boolean = () => true): Diff {
    const newDiff = new Diff

    // Map payloads
    this.getActions()
      .map(a => a as Action)
      .forEach(action => {
        let newAction

        if (!filter(action)) {
          newDiff.commit(action)
          return
        }

        // needed because we set oldItem in the first section, so we wouldn't know anymore if it was set before
        const oldItem = action.oldItem

        // We have two sections here, because we want to be able to take IDs from oldItem even for moves
        // but not parentIds (which do change during moves, obviously)

        if (oldItem && targetLocation !== ItemLocation.SERVER) {
          const oldId = action.oldItem.id
          const newId = action.payload.id
          newAction = {
            ...action,
            payload: action.payload.clone(false, targetLocation),
            oldItem: action.oldItem.clone(false)
          }
          newAction.payload.id = oldId
          newAction.oldItem.id = newId
        } else {
          newAction = {
            ...action,
            payload: action.payload.clone(false, targetLocation),
            oldItem: action.payload.clone(false)
          }
          newAction.payload.id = Mappings.mapId(mappingsSnapshot, action.payload, targetLocation)
        }

        if (oldItem && targetLocation !== ItemLocation.SERVER && action.type !== ActionType.MOVE && action.type !== ActionType.UPDATE) {
          newAction.payload.parentId = action.oldItem.parentId
          newAction.oldItem.parentId = action.payload.parentId
        } else {
          newAction.oldItem.parentId = action.payload.parentId
          newAction.payload.parentId = Mappings.mapParentId(mappingsSnapshot, action.payload, targetLocation)
          if (typeof newAction.payload.parentId === 'undefined' && typeof action.payload.parentId !== 'undefined') {
            throw new Error('Failed to map parentId: ' + action.payload.parentId)
          }
        }

        if (action.type === ActionType.REORDER) {
          newAction.oldOrder = action.order
          newAction.order = action.order.slice().map(item => {
            return {...item, id: mappingsSnapshot[(targetLocation === ItemLocation.LOCAL ? ItemLocation.SERVER : ItemLocation.LOCAL) + 'To' + targetLocation][item.type][item.id]}
          })
        }

        newDiff.commit(newAction)
      })
    return newDiff
  }
}
