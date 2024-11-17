import { Folder, TItem, ItemType, TItemLocation, ItemLocation, hydrate } from './Tree'
import Mappings, { MappingSnapshot } from './Mappings'
import Ordering from './interfaces/Ordering'
import batchingToposort from 'batching-toposort'
import Logger from './Logger'

export const ActionType = {
  CREATE: 'CREATE',
  UPDATE: 'UPDATE',
  MOVE: 'MOVE',
  REMOVE: 'REMOVE',
  REORDER: 'REORDER',
} as const

export type TActionType = (typeof ActionType)[keyof typeof ActionType];

export interface CreateAction<L1 extends TItemLocation, L2 extends TItemLocation> {
  type: 'CREATE',
  payload: TItem<L1>,
  oldItem?: TItem<L2>,
  index?: number,
  oldIndex?: number,
}

export interface UpdateAction<L1 extends TItemLocation, L2 extends TItemLocation> {
  type: 'UPDATE',
  payload: TItem<L1>,
  oldItem?: TItem<L2>,
}

export interface RemoveAction<L1 extends TItemLocation, L2 extends TItemLocation> {
  type: 'REMOVE',
  payload: TItem<L1>,
  oldItem?: TItem<L2>,
  index?: number,
  oldIndex?: number,
}

export interface ReorderAction<L1 extends TItemLocation, L2 extends TItemLocation> {
  type: 'REORDER',
  payload: TItem<L1>,
  oldItem?: TItem<L2>,
  order: Ordering<L1>,
  oldOrder?: Ordering<L2>,
}

export interface MoveAction<L1 extends TItemLocation, L2 extends TItemLocation> {
  type: 'MOVE',
  payload: TItem<L1>,
  oldItem?: TItem<L2>,
  index?: number,
  oldIndex?: number,
}

export type Action<L1 extends TItemLocation, L2 extends TItemLocation> = CreateAction<L1, L2>|UpdateAction<L1, L2>|RemoveAction<L1, L2>|ReorderAction<L1,L2>|MoveAction<L1,L2>

export type LocationOfAction<A> = A extends Action<infer L, TItemLocation> ? L : never
export type OldLocationOfAction<A> = A extends Action<TItemLocation, infer L> ? L : never

export type MapLocation<A extends Action<TItemLocation, TItemLocation>, NewLocation extends TItemLocation> =
// eslint-disable-next-line no-unused-vars,@typescript-eslint/no-unused-vars
  A extends CreateAction<infer O, infer P> ?
    CreateAction<NewLocation, O>
    // eslint-disable-next-line no-unused-vars,@typescript-eslint/no-unused-vars
    : A extends UpdateAction<infer O, infer P> ?
      UpdateAction<NewLocation, O>
      // eslint-disable-next-line no-unused-vars,@typescript-eslint/no-unused-vars
      : A extends MoveAction<infer O, infer P> ?
        MoveAction<NewLocation, O>
        // eslint-disable-next-line no-unused-vars,@typescript-eslint/no-unused-vars
        : A extends RemoveAction<infer O, infer P> ?
          RemoveAction<NewLocation, O>
          // eslint-disable-next-line no-unused-vars,@typescript-eslint/no-unused-vars
          : A extends ReorderAction<infer O, infer P> ?
            ReorderAction<NewLocation, O>
            : never

export default class Diff<L1 extends TItemLocation, L2 extends TItemLocation, A extends Action<L1, L2>> {
  private readonly actions: A[]

  constructor() {
    this.actions = []
  }

  clone(filter: (action:A)=>boolean = () => true): Diff<L1, L2, A> {
    const newDiff : Diff<L1, L2, A> = new Diff
    this.getActions().forEach((action: A) => {
      if (filter(action)) {
        newDiff.commit(action)
      }
    })

    return newDiff
  }

  commit(action: A):void {
    this.actions.push({ ...action })
  }

  retract(action: A):void {
    this.actions.splice(this.actions.indexOf(action), 1)
  }

  getActions():A[] {
    return [].concat(
      this.actions
    )
  }

  static findChain(
    mappingsSnapshot: MappingSnapshot,
    actions: Action<TItemLocation, TItemLocation>[], itemTree: Folder<TItemLocation>,
    currentItem: TItem<TItemLocation>,
    targetAction: Action<TItemLocation, TItemLocation>,
    chain: Action<TItemLocation, TItemLocation>[] = []
  ): boolean {
    const targetItemInTree = itemTree.findFolder(Mappings.mapId(mappingsSnapshot, targetAction.payload, itemTree.location))
    if (
      targetAction.payload.findItem(ItemType.FOLDER,
        Mappings.mapParentId(mappingsSnapshot, currentItem, targetAction.payload.location)) ||
      (targetItemInTree && targetItemInTree.findFolder(Mappings.mapParentId(mappingsSnapshot, currentItem, itemTree.location)))
    ) {
      return true
    }
    const newCurrentActions = actions.filter(targetAction =>
      !chain.includes(targetAction) && (
        targetAction.payload.findItem(ItemType.FOLDER, Mappings.mapParentId(mappingsSnapshot, currentItem, targetAction.payload.location)) ||
        (
          itemTree.findFolder(Mappings.mapId(mappingsSnapshot, targetAction.payload, itemTree.location)) &&
          itemTree.findFolder(Mappings.mapId(mappingsSnapshot, targetAction.payload, itemTree.location)).findFolder(Mappings.mapParentId(mappingsSnapshot, currentItem, itemTree.location)))
      )
    )
    if (newCurrentActions.length) {
      for (const newCurrentAction of newCurrentActions) {
        if (Diff.findChain(mappingsSnapshot, actions, itemTree, newCurrentAction.payload, targetAction, [...chain, newCurrentAction])) {
          return true
        }
      }
    }
    return false
  }

  static sortMoves<L1 extends TItemLocation, L2 extends TItemLocation>(actions: MoveAction<L1, L2>[], tree: Folder<L1>) :MoveAction<L1, L2>[][] {
    const bookmarks = actions.filter(a => a.payload.type === ItemType.BOOKMARK)
    const folderMoves = actions.filter(a => a.payload.type === ItemType.FOLDER)
    const DAG = folderMoves
      .reduce((DAG, action1) => {
        DAG[action1.payload.id] = folderMoves.filter(action2 => {
          if (action1 === action2 || String(action1.payload.id) === String(action2.payload.id)) {
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

  /**
   * on ServerToLocal: don't map removals
   * on LocalToServer:
   * @param mappingsSnapshot
   * @param targetLocation
   * @param filter
   * @param skipErroneousActions
   */
  map<L3 extends TItemLocation>(mappingsSnapshot:MappingSnapshot, targetLocation: L3, filter: (action: A)=>boolean = () => true, skipErroneousActions = false): Diff<L3, L1, MapLocation<A, L3>> {
    const newDiff : Diff<L3, L1, MapLocation<A, L3>> = new Diff

    // Map payloads
    this.getActions()
      .map(a => a as A)
      .forEach(action => {
        let newAction

        if (!filter(action)) {
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
            payload: action.payload.cloneWithLocation(false, targetLocation),
            oldItem: action.oldItem.cloneWithLocation(false, action.payload.location)
          }
          newAction.payload.id = oldId
          newAction.oldItem.id = newId
        } else {
          newAction = {
            ...action,
            payload: action.payload.cloneWithLocation(false, targetLocation),
            oldItem: action.payload.clone(false)
          }
          newAction.payload.id = Mappings.mapId(mappingsSnapshot, action.payload, targetLocation)
        }

        if (oldItem && targetLocation !== ItemLocation.SERVER && action.type !== ActionType.MOVE) {
          newAction.oldItem.parentId = action.payload.parentId
          newAction.payload.parentId = Mappings.mapParentId(mappingsSnapshot, action.oldItem, targetLocation)
        } else {
          newAction.oldItem.parentId = action.payload.parentId
          newAction.payload.parentId = Mappings.mapParentId(mappingsSnapshot, action.payload, targetLocation)
          if (typeof newAction.payload.parentId === 'undefined' && typeof action.payload.parentId !== 'undefined') {
            if (skipErroneousActions) {
              // simply ignore this action as it appears to be no longer valid
              Logger.log('Failed to map parentId: ' + action.payload.parentId)
              Logger.log('Removing MOVE action from plan:', action)
              return
            } else {
              Logger.log('payload.location = ' + action.payload.location + ' | targetLocation = ' + targetLocation)
              const diff = new Diff()
              diff.commit(action)
              Logger.log('Failed to map parentId of action ' + diff.inspect())
              Logger.log(JSON.stringify(mappingsSnapshot, null,'\t'))
              throw new Error('Failed to map parentId to ' + targetLocation + ': ' + action.payload.parentId)
            }
          }
        }

        if (action.type === ActionType.REORDER) {
          newAction.oldOrder = action.order
          newAction.order = action.order.map(item => {
            return {...item, id: mappingsSnapshot[(targetLocation === ItemLocation.LOCAL ? ItemLocation.SERVER : ItemLocation.LOCAL) + 'To' + targetLocation][item.type][item.id]}
          })
        }

        newDiff.commit(newAction)
      })
    return newDiff
  }

  toJSON() {
    return this.getActions().map((action: A) => {
      return {
        ...action,
        payload: action.payload.clone(false),
        oldItem: action.oldItem && action.oldItem.clone(false),
      }
    })
  }

  inspect(depth = 0):string {
    return 'Diff\n' + this.getActions().map((action: A) => {
      return `\nAction: ${action.type}\nPayload: #${action.payload.id}[${action.payload.title}]${'url' in action.payload ? `(${action.payload.url})` : ''} parentId: ${action.payload.parentId} ${'index' in action ? `Index: ${action.index}\n` : ''}${'order' in action ? `Order: ${JSON.stringify(action.order, null, '\t')}` : ''}`
    }).join('\n')
  }

  static fromJSON<L1 extends TItemLocation, L2 extends TItemLocation, A2 extends Action<L1, L2>>(json) {
    const diff: Diff<L1, L2, A2> = new Diff
    json.forEach((action: A2): void => {
      action.payload = hydrate<L1>(action.payload)
      action.oldItem = action.oldItem && hydrate<L2>(action.oldItem)
      diff.commit(action)
    })
    return diff
  }
}

export interface PlanStage1<L1 extends TItemLocation, L2 extends TItemLocation> {
  CREATE: Diff<L1, L2, CreateAction<L1, L2>>
  UPDATE: Diff<L1, L2, UpdateAction<L1, L2>>
  MOVE: Diff<L1, L2, MoveAction<L1, L2>>
  REMOVE: Diff<L2, L1, RemoveAction<L2, L1>>
  REORDER: Diff<L1, L2, ReorderAction<L1, L2>>
}

export interface PlanStage2<L1 extends TItemLocation, L2 extends TItemLocation, L3 extends TItemLocation> {
  CREATE: Diff<L3, L1, CreateAction<L3, L1>>
  UPDATE: Diff<L3, L1, UpdateAction<L3, L1>>
  MOVE: Diff<L1, L2, MoveAction<L1, L2>>
  REMOVE: Diff<L3, L2, RemoveAction<L3, L2>>
  REORDER: Diff<L1, L2, ReorderAction<L1, L2>>
}

export interface PlanStage3<L1 extends TItemLocation, L2 extends TItemLocation, L3 extends TItemLocation> {
  CREATE: Diff<L3, L1, CreateAction<L3, L1>>
  UPDATE: Diff<L3, L1, UpdateAction<L3, L1>>
  MOVE: Diff<L3, L1, MoveAction<L3, L1>>
  REMOVE: Diff<L3, L2, RemoveAction<L3, L2>>
  REORDER: Diff<L1, L2, ReorderAction<L1, L2>>
}

export interface PlanRevert<L1 extends TItemLocation, L2 extends TItemLocation> {
  CREATE: Diff<L1, L2, CreateAction<L1, L2>>
  UPDATE: Diff<L1, L2, UpdateAction<L1, L2>>
  MOVE: Diff<L2, L1, MoveAction<L2, L1>>
  REMOVE: Diff<L1, L2, RemoveAction<L1, L2>>
  REORDER: Diff<L1, L2, ReorderAction<L1, L2>>
}
