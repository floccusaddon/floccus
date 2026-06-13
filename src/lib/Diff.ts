import { Folder, TItem, ItemType, TItemLocation, ItemLocation, hydrate } from './Tree'
import Mappings, { MappingSnapshot } from './Mappings'
import Ordering from './interfaces/Ordering'
import batchingToposort from 'batching-toposort'
import Logger from './Logger'
import { MappingFailureError } from '../errors/Error'
import * as Parallel from 'async-parallel'
import { yieldToEventLoop } from './yieldToEventLoop'

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

export default class Diff<
  L1 extends TItemLocation,
  L2 extends TItemLocation,
  A extends Action<L1, L2>
> {
  private readonly actions: A[]

  constructor() {
    this.actions = []
  }

  clone(filter: (action: A) => boolean = () => true): Diff<L1, L2, A> {
    const newDiff: Diff<L1, L2, A> = new Diff()
    this.getActions().forEach((action: A) => {
      if (filter(action)) {
        newDiff.commit(action)
      }
    })

    return newDiff
  }

  commit(action: A): void {
    this.actions.push({ ...action })
  }

  retract(action: A): void {
    this.actions.splice(this.actions.indexOf(action), 1)
  }

  getActions(): A[] {
    return [].concat(this.actions)
  }

  static containsParent(
    mappingsSnapshot: MappingSnapshot,
    item1: TItem<TItemLocation>,
    item2: TItem<TItemLocation>,
    itemTree: Folder<TItemLocation>,
    cache: Record<string, boolean>
  ): boolean {
    // (location, type, id) uniquely identifies an item — use it directly rather
    // than canonicalizing through mapId, so the key is collision-free even when
    // ids contain separator chars or when mapId returns undefined for unmapped
    // items.
    const cacheKey =
      `contains:${item1.location}:${item1.type}:${item1.id}|` +
      `${item2.location}:${item2.type}:${item2.id}`
    if (typeof cache[cacheKey] !== 'undefined') {
      return cache[cacheKey]
    }
    const item1IdInTreeSpace = Mappings.mapId(mappingsSnapshot, item1, itemTree.location)
    const item1InTree = typeof item1IdInTreeSpace !== 'undefined'
      ? itemTree.findItem(item1.type, item1IdInTreeSpace)
      : null
    const item2ParentInItem1Space = Mappings.mapParentId(mappingsSnapshot, item2, item1.location)
    const item2ParentInTreeSpace = Mappings.mapParentId(mappingsSnapshot, item2, itemTree.location)
    const item1IdInItem2Space = Mappings.mapId(mappingsSnapshot, item1, item2.location)
    if (
      (typeof item2ParentInItem1Space !== 'undefined' &&
        item1.findItem(ItemType.FOLDER, item2ParentInItem1Space)) ||
      (item1InTree &&
        typeof item2ParentInTreeSpace !== 'undefined' &&
        item1InTree.findItem(ItemType.FOLDER, item2ParentInTreeSpace)) ||
      (typeof item1IdInItem2Space !== 'undefined' &&
        typeof item2.parentId !== 'undefined' &&
        String(item1IdInItem2Space) === String(item2.parentId)) ||
      (typeof item2ParentInItem1Space !== 'undefined' &&
        typeof item1.id !== 'undefined' &&
        String(item2ParentInItem1Space) === String(item1.id))
    ) {
      cache[cacheKey] = true
      return true
    }
    cache[cacheKey] = false
    return false
  }

  static findChain(
    mappingsSnapshot: MappingSnapshot,
    actions: Action<TItemLocation, TItemLocation>[],
    itemTree: Folder<TItemLocation>,
    currentItem: TItem<TItemLocation>,
    targetAction: Action<TItemLocation, TItemLocation>,
    cache: Record<string, boolean> = {},
    chain: Action<TItemLocation, TItemLocation>[] = []
  ): boolean {
    // (location, type, id) uniquely identifies an item — use it directly rather
    // than canonicalizing through mapId, so the key is collision-free even when
    // ids contain separator chars or when mapId returns undefined for unmapped
    // items.
    const cacheKey =
      `hasChain:${currentItem.location}:${currentItem.type}:${currentItem.id}|` +
      `${targetAction.payload.location}:${targetAction.payload.type}:${targetAction.payload.id}`
    if (typeof cache[cacheKey] !== 'undefined') {
      return cache[cacheKey]
    }
    if (
      Diff.containsParent(
        mappingsSnapshot,
        targetAction.payload,
        currentItem,
        itemTree,
        cache
      )
    ) {
      cache[cacheKey] = true
      return true
    }
    const newCurrentActions = actions.filter(
      (newTargetAction) =>
        !chain.includes(newTargetAction) &&
        Diff.containsParent(
          mappingsSnapshot,
          newTargetAction.payload,
          currentItem,
          itemTree,
          cache
        )
    )
    if (newCurrentActions.length) {
      for (const newCurrentAction of newCurrentActions) {
        if (
          Diff.findChain(
            mappingsSnapshot,
            actions,
            itemTree,
            newCurrentAction.payload,
            targetAction,
            cache,
            [...chain, newCurrentAction]
          )
        ) {
          return true
        }
      }
    }
    cache[cacheKey] = false
    return false
  }

  static sortMoves<L1 extends TItemLocation, L2 extends TItemLocation>(
    actions: MoveAction<L1, L2>[],
    tree: Folder<L1>
  ): MoveAction<L1, L2>[][] {
    const bookmarks = actions.filter(
      (a) => a.payload.type === ItemType.BOOKMARK
    )
    const folderMoves = actions.filter(
      (a) => a.payload.type === ItemType.FOLDER
    )
    const DAG = folderMoves.reduce((DAG, action1) => {
      DAG[action1.payload.id] = folderMoves
        .filter((action2) => {
          if (
            action1 === action2 ||
            String(action1.payload.id) === String(action2.payload.id)
          ) {
            return false
          }
          return (
            tree.findItem(action1.payload.type, action1.payload.id) &&
            tree
              .findItem(action1.payload.type, action1.payload.id)
              .findItem(action2.payload.type, action2.payload.id)
          )
        })
        .map((a) => a.payload.id)
      return DAG
    }, {})
    let batches
    try {
      batches = batchingToposort(DAG).map((batch) =>
        batch.map((id) =>
          folderMoves.find((a) => String(a.payload.id) === String(id))
        )
      )
    } catch (e) {
      console.log({ DAG, tree, actions })
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
  map<L3 extends TItemLocation>(
    mappingsSnapshot: MappingSnapshot,
    targetLocation: L3,
    filter: (action: A) => boolean = () => true,
    skipErroneousActions = true
  ): Diff<L3, L1, MapLocation<A, L3>> {
    const newDiff: Diff<L3, L1, MapLocation<A, L3>> = new Diff()

    // Map payloads
    this.getActions()
      .map((a) => a as A)
      .forEach((action) => {
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
            payload: action.payload.restampRoot(false, targetLocation),
            oldItem: action.oldItem.restampRoot(
              false,
              action.payload.location
            ),
          }
          newAction.payload.id = oldId
          newAction.oldItem.id = newId
        } else {
          newAction = {
            ...action,
            payload: action.payload.restampRoot(false, targetLocation),
            oldItem: action.payload.copy(false),
          }
          newAction.payload.id = Mappings.mapId(
            mappingsSnapshot,
            action.payload,
            targetLocation
          )
          if (action.type !== ActionType.CREATE && typeof action.payload.id !== 'undefined' && typeof newAction.payload.id === 'undefined') {
            Logger.log(
              'payload.location = ' +
              action.payload.location +
              ' | targetLocation = ' +
              targetLocation
            )
            const diff = new Diff()
            diff.commit(action)
            Logger.log('Failed to map id of action ' + diff.inspect())
            Logger.log(JSON.stringify(mappingsSnapshot, null, '\t'))
            throw new MappingFailureError(String(action.payload.id))
          }
        }

        if (
          oldItem &&
          targetLocation !== ItemLocation.SERVER &&
          action.type !== ActionType.MOVE
        ) {
          newAction.oldItem.parentId = action.payload.parentId
          newAction.payload.parentId = Mappings.mapParentId(
            mappingsSnapshot,
            action.oldItem,
            targetLocation
          )
        } else {
          newAction.oldItem.parentId = action.payload.parentId
          newAction.payload.parentId = Mappings.mapParentId(
            mappingsSnapshot,
            action.payload,
            targetLocation
          )
          if (
            typeof newAction.payload.parentId === 'undefined' &&
            typeof action.payload.parentId !== 'undefined' &&
            action.payload.parentId !== null
          ) {
            if (skipErroneousActions) {
              // simply ignore this action as it appears to be no longer valid
              Logger.log('Failed to map parentId: ' + action.payload.parentId)
              Logger.log('Removing MOVE action from plan:', action)
              return
            } else {
              Logger.log(
                'payload.location = ' +
                  action.payload.location +
                  ' | targetLocation = ' +
                  targetLocation
              )
              const diff = new Diff()
              diff.commit(action)
              Logger.log('Failed to map parentId of action ' + diff.inspect())
              Logger.log(JSON.stringify(mappingsSnapshot, null, '\t'))
              throw new MappingFailureError(String(action.payload.parentId))
            }
          }
        }

        if (action.type === ActionType.REORDER) {
          newAction.oldOrder = action.order
          newAction.order = action.order.map((item) => {
            return {
              ...item,
              id: mappingsSnapshot[
                (targetLocation === ItemLocation.LOCAL
                  ? ItemLocation.SERVER
                  : ItemLocation.LOCAL) +
                  'To' +
                  targetLocation
              ][item.type][item.id],
            }
          })
        }

        if (action.type !== ActionType.REORDER) {
          Logger.log('Mapped action', action, newAction)
        }

        newDiff.commit(newAction)
      })
    return newDiff
  }

  toJSON() {
    return this.getActions().map((action: A) => {
      return {
        ...action,
        payload: action.payload.clone(false).toJSON(),
        oldItem: action.oldItem && action.oldItem.clone(false).toJSON(),
      }
    })
  }

  async toJSONAsync() {
    let iterations = 0
    return Parallel.map(
      this.getActions(),
      async(action: A) => {
        if (++iterations % 1000 === 0) {
          await yieldToEventLoop()
        }
        return {
          ...action,
          payload: await action.payload.clone(false).toJSONAsync(),
          oldItem:
            action.oldItem && await action.oldItem.clone(false).toJSONAsync(),
        }
      },
      1
    )
  }

  inspect(depth = 0): string {
    return (
      'Diff\n' +
      this.getActions()
        .map((action: A) => {
          return `\nAction: ${action.type}\nPayload: #${action.payload.id}[${
            action.payload.title
          }]${
            'url' in action.payload ? `(${action.payload.url})` : ''
          } parentId: ${action.payload.parentId} ${
            'index' in action ? `Index: ${action.index}\n` : ''
          }${
            'order' in action
              ? `Order: ${JSON.stringify(action.order, null, '\t')}`
              : ''
          }`
        })
        .join('\n')
    )
  }

  static fromJSON<
    L1 extends TItemLocation,
    L2 extends TItemLocation,
    A2 extends Action<L1, L2>
  >(json) {
    const diff: Diff<L1, L2, A2> = new Diff()
    json.forEach((action: A2): void => {
      action.payload = hydrate<L1>(action.payload)
      action.oldItem = action.oldItem && hydrate<L2>(action.oldItem)
      diff.commit(action)
    })
    return diff
  }

  static async fromJSONAsync<
    L1 extends TItemLocation,
    L2 extends TItemLocation,
    A2 extends Action<L1, L2>
  >(json) {
    const diff: Diff<L1, L2, A2> = new Diff()
    let iterations = 0
    await Parallel.map(json, async(action: A2): Promise<void> => {
      if (++iterations % 1000 === 0) {
        await yieldToEventLoop()
      }
      action.payload = hydrate<L1>(action.payload)
      action.oldItem = action.oldItem && hydrate<L2>(action.oldItem)
      diff.commit(action)
    }, 1)
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
  REORDER: Diff<L2, L1, ReorderAction<L2, L1>>
}
