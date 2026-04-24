import DefaultStrategy, { ISerializedSyncProcess , ACTION_CONCURRENCY } from './Default'
import Diff, { Action, ActionType, PlanRevert, PlanStage1, PlanStage3, ReorderAction } from '../Diff'
import * as Parallel from 'async-parallel'
import Mappings, { MappingSnapshot } from '../Mappings'
import { Folder, ItemLocation, TItem, TItemLocation, TOppositeLocation } from '../Tree'
import Logger from '../Logger'
import { CancelledSyncError } from '../../errors/Error'
import TResource from '../interfaces/Resource'
import Scanner, { ScanResult } from '../Scanner'
import { yieldToEventLoop } from '../yieldToEventLoop'

export default class UnidirectionalSyncProcess extends DefaultStrategy {
  protected direction: TItemLocation
  protected scanResult: ScanResult<TItemLocation, TItemLocation>
  protected revertPlan: PlanStage1<
    TItemLocation,
    TOppositeLocation<TItemLocation>
  > = null
  protected revertDonePlan: PlanRevert<
    TItemLocation,
    TOppositeLocation<TItemLocation>
  > = null
  protected revertReorders: Diff<
    TItemLocation,
    TOppositeLocation<TItemLocation>,
    ReorderAction<TItemLocation, TOppositeLocation<TItemLocation>>
  > = null

  setDirection(direction: TItemLocation): void {
    this.direction = direction
  }

  getMembersToPersist() {
    const members = []
    // Stage 0
    if (!this.revertPlan && this.actionsPlanned === 0) {
      members.push('scanResult')
    }

    // Stage 1
    if (this.actionsDone < this.actionsPlanned) {
      members.push('revertPlan')
      members.push('revertDonePlan')
    }

    // Stage 2
    members.push('revertReorders')

    members.push('direction')
    return members
  }

  async setProgress(json: any) {
    if (json.serverTreeRoot) {
      this.serverTreeRoot = Folder.hydrate(json.serverTreeRoot)
      delete json.serverTreeRoot
    }
    if (json.localTreeRoot) {
      this.localTreeRoot = Folder.hydrate(json.localTreeRoot)
      delete json.localTreeRoot
    }
    if (json.cacheTreeRoot) {
      this.cacheTreeRoot = Folder.hydrate(json.cacheTreeRoot)
      delete json.cacheTreeRoot
    }
    for (const member of Object.keys(json)) {
      if (
        member.toLowerCase().includes('scanresult') ||
        member.toLowerCase().includes('plan')
      ) {
        this[member] = {
          CREATE: await Diff.fromJSONAsync(json[member].CREATE),
          UPDATE: await Diff.fromJSONAsync(json[member].UPDATE),
          MOVE: await Diff.fromJSONAsync(json[member].MOVE),
          REMOVE: await Diff.fromJSONAsync(json[member].REMOVE),
          REORDER: await Diff.fromJSONAsync(json[member].REORDER),
        }
      } else if (member.toLowerCase().includes('reorders')) {
        this[member] = await Diff.fromJSONAsync(json[member])
      } else {
        this[member] = json[member]
      }
    }
  }

  async getDiff(): Promise<ScanResult<TItemLocation, TItemLocation>> {
    const mappingsSnapshot = this.mappings.getSnapshot()

    const newMappings = []
    const slaveTree =
      this.direction === ItemLocation.SERVER
        ? this.serverTreeRoot
        : this.localTreeRoot
    const masterTree =
      this.direction === ItemLocation.SERVER
        ? this.localTreeRoot
        : this.serverTreeRoot
    const scanner = new Scanner(
      slaveTree,
      masterTree,
      // We can't rely on a cacheTree, thus we have to accept canMergeWith results as well
      (slaveItem, masterItem) => {
        const localItem =
          this.direction === ItemLocation.SERVER ? masterItem : slaveItem
        const serverItem =
          this.direction === ItemLocation.SERVER ? slaveItem : masterItem
        if (localItem.type !== serverItem.type) {
          return false
        }
        // If a bookmark's URL has changed we want to recreate it instead of updating it, because of Nextcloud Bookmarks' uniqueness constraints
        if (
          serverItem.type === 'bookmark' &&
          localItem.type === 'bookmark' &&
          serverItem.url !== localItem.url
        ) {
          return false
        }
        if (serverItem.canMergeWith(localItem)) {
          newMappings.push([localItem, serverItem])
          return true
        }
        if (Mappings.mappable(mappingsSnapshot, serverItem, localItem)) {
          newMappings.push([localItem, serverItem])
          return true
        }
        return false
      },
      this.hashSettings,
      false,
      false
    )
    Logger.log(
      'Unidirectional: Calculating the diff between local and server trees'
    )
    const scanResult = await scanner.run()
    await Parallel.map(
      newMappings,
      ([localItem, serverItem]) => {
        return this.addMapping(this.server, localItem, serverItem.id)
      },
      1
    )

    return scanResult
  }

  async loadChildren(
    serverTreeRoot: Folder<typeof ItemLocation.SERVER>
  ): Promise<void> {
    Logger.log('Unidirectional: Loading whole tree')
    serverTreeRoot.children = (
      await this.server.getBookmarksTree(true)
    ).children
  }

  async sync(): Promise<void> {
    this.throttledProgressCb(0.15, 0)

    this.masterLocation =
      this.direction === ItemLocation.SERVER
        ? ItemLocation.LOCAL
        : ItemLocation.SERVER
    await this.prepareSync()

    this.throttledProgressCb(0.35, 0)

    if (this.canceled) {
      throw new CancelledSyncError()
    }

    Logger.log({
      localTreeRoot: this.localTreeRoot,
      serverTreeRoot: this.serverTreeRoot,
      cacheTreeRoot: this.cacheTreeRoot,
    })

    if (!this.scanResult && !this.revertPlan) {
      this.scanResult = await this.getDiff()
      Logger.log({ scanResult: this.scanResult })
      this.throttledProgressCb(0.45, 0)
    }

    if (this.canceled) {
      throw new CancelledSyncError()
    }

    let target: TResource<TItemLocation>
    if (this.direction === ItemLocation.SERVER) {
      target = this.server
    } else {
      target = this.localTree
    }

    // First revert slave modifications

    if (!this.revertPlan) {
      this.revertPlan = await this.revertDiff(this.scanResult, this.direction)
      Logger.log({ revertPlan: this.revertPlan })
    }

    if (this.canceled) {
      throw new CancelledSyncError()
    }

    if (!this.actionsPlanned && this.revertPlan) {
      this.actionsPlanned = Object.values(this.revertPlan).reduce(
        (acc, diff) => diff.getActions().length + acc,
        0
      )
    }

    if (this.revertPlan) {
      if (this.direction === ItemLocation.LOCAL) {
        this.applyDeletionFailsafe(
          ItemLocation.LOCAL,
          this.localTreeRoot,
          this.revertPlan.REMOVE
        )
        this.applyAdditionFailsafe(
          ItemLocation.LOCAL,
          this.localTreeRoot,
          this.revertPlan.CREATE
        )
      } else {
        this.applyDeletionFailsafe(
          ItemLocation.SERVER,
          this.serverTreeRoot,
          this.revertPlan.REMOVE
        )
        this.applyAdditionFailsafe(
          ItemLocation.SERVER,
          this.serverTreeRoot,
          this.revertPlan.CREATE
        )
      }
    }

    if (this.canceled) {
      throw new CancelledSyncError()
    }

    if (this.revertPlan) {
      Logger.log('Executing ' + this.direction + ' revert plan')

      if (!this.revertDonePlan) {
        this.revertDonePlan = {
          CREATE: new Diff(),
          UPDATE: new Diff(),
          MOVE: new Diff(),
          REMOVE: new Diff(),
          REORDER: new Diff(),
        }
      }

      await this.executeRevert(
        target,
        this.revertPlan,
        this.direction,
        this.revertDonePlan,
        this.scanResult.REORDER
      )
    }

    if (this.direction === ItemLocation.LOCAL) {
      this.revertDonePlan.REMOVE.getActions().forEach((action) =>
        this.removeMapping(this.localTree, action.payload)
      )
    } else {
      this.revertDonePlan.REMOVE.getActions().forEach((action) =>
        this.removeMapping(this.server, action.payload)
      )
    }

    if ('orderFolder' in target && !this.revertReorders) {
      const mappingsSnapshot = this.mappings.getSnapshot()
      Logger.log('Mapping reorderings')
      this.revertReorders = this.scanResult.REORDER.map(
        mappingsSnapshot,
        this.direction
      )
    }

    if (this.revertReorders && 'orderFolder' in target) {
      await this.executeReorderings(target, this.revertReorders)
    }

    this.throttledProgressCb.cancel()
  }

  async revertDiff<L1 extends TItemLocation, L2 extends TItemLocation>(
    scanResult: ScanResult<L2, L1>,
    targetLocation: L1
  ): Promise<PlanRevert<L1, L2>> {
    const mappingsSnapshot = this.mappings.getSnapshot()

    const slavePlan: PlanRevert<L1, L2> = {
      CREATE: new Diff(),
      UPDATE: new Diff(),
      MOVE: new Diff(),
      REMOVE: new Diff(),
      REORDER: scanResult.REORDER.clone(),
    }

    // Prepare slave plan for matching master state

    await Parallel.each(
      scanResult.CREATE.getActions(),
      async(action) => {
        // recreate it on slave resource otherwise
        const payload = await this.translateCompleteItem(
          action.payload,
          mappingsSnapshot,
          targetLocation
        )
        const oldItem = action.payload
        payload.createIndex()
        oldItem.createIndex()

        slavePlan.CREATE.commit({
          ...action,
          type: ActionType.CREATE,
          payload,
          oldItem,
        })
      },
      ACTION_CONCURRENCY
    )

    await Parallel.each(
      scanResult.REMOVE.getActions(),
      async(action) => {
        slavePlan.REMOVE.commit({ ...action, type: ActionType.REMOVE })
      },
      ACTION_CONCURRENCY
    )

    await Parallel.each(
      scanResult.UPDATE.getActions(),
      async(action) => {
        const payload = action.payload.cloneWithLocation(
          false,
          action.oldItem.location
        )
        payload.id = action.oldItem.id
        payload.parentId = action.oldItem.parentId

        const oldItem = action.oldItem.cloneWithLocation(
          false,
          action.payload.location
        )
        oldItem.id = action.payload.id
        oldItem.parentId = action.payload.parentId
        slavePlan.UPDATE.commit({ type: ActionType.UPDATE, payload, oldItem })
      },
      ACTION_CONCURRENCY
    )

    await Parallel.each(
      scanResult.MOVE.getActions(),
      async(action) => {
        const payload = action.payload.clone(false)
        slavePlan.MOVE.commit({ type: ActionType.MOVE, payload }) // no oldItem, because we want to map the id after having executed the CREATEs
      },
      ACTION_CONCURRENCY
    )

    return slavePlan
  }

  private async translateCompleteItem<
    L1 extends TItemLocation,
    L2 extends TItemLocation
  >(item: TItem<L1>, mappingsSnapshot: MappingSnapshot, fakeLocation: L2) {
    const newItem = item.copyWithLocation(false, fakeLocation)
    newItem.id = Mappings.mapId(mappingsSnapshot, item, fakeLocation)
    newItem.parentId = Mappings.mapParentId(
      mappingsSnapshot,
      item,
      fakeLocation
    )
    if (newItem instanceof Folder) {
      const nonexistingItems = []
      await newItem.traverse(async(child, parentFolder) => {
        child.id = Mappings.mapId(mappingsSnapshot, child, fakeLocation)
        if (typeof child.id === 'undefined' || child.id === null) {
          nonexistingItems.push(child)
        }
        child.parentId = parentFolder.id
      })
      newItem.createIndex()
      // filter out all items that couldn't be mapped: These are creations from the slave side
      nonexistingItems.forEach((item) => {
        const folder = newItem.findFolder(item.parentId)
        folder.children = folder.children.filter((i) => i.id)
      })
    } else {
      newItem.createIndex()
    }
    return newItem
  }

  async executeRevert<L1 extends TItemLocation>(
    resource: TResource<L1>,
    planRevert: PlanRevert<L1, TOppositeLocation<L1>>,
    targetLocation: L1,
    donePlan: PlanStage3<TOppositeLocation<L1>, TItemLocation, L1>,
    reorders: Diff<
      TOppositeLocation<L1>,
      TItemLocation,
      ReorderAction<TOppositeLocation<L1>, TItemLocation>
    >
  ): Promise<void> {
    Logger.log('Executing revert plan for ' + targetLocation)

    let createActions = planRevert.CREATE.getActions()
    while (createActions.length > 0) {
      Logger.log(targetLocation + ': executing CREATEs')
      await Parallel.each(
        createActions,
        (action) =>
          this.executeCreate(
            resource,
            action,
            targetLocation,
            planRevert.CREATE,
            reorders,
            donePlan
          ),
        ACTION_CONCURRENCY
      )
      createActions = planRevert.CREATE.getActions()

      if (this.canceled) {
        throw new CancelledSyncError()
      }
    }

    Logger.log(targetLocation + ': executing UPDATEs')

    await Parallel.each(
      planRevert.UPDATE.getActions(),
      (action) =>
        this.executeUpdate(
          resource,
          action,
          targetLocation,
          planRevert.UPDATE,
          donePlan
        ),
      ACTION_CONCURRENCY
    )

    if (this.canceled) {
      throw new CancelledSyncError()
    }

    const mappingsSnapshot = this.mappings.getSnapshot()
    // TODO: Store this in continuation
    const mappedMoves = planRevert.MOVE.map(mappingsSnapshot, targetLocation)

    if (this.canceled) {
      throw new CancelledSyncError()
    }

    const batches = Diff.sortMoves(
      mappedMoves.getActions(),
      this.getTargetTree(targetLocation)
    )

    if (this.canceled) {
      throw new CancelledSyncError()
    }

    Logger.log(targetLocation + ': executing MOVEs')
    await Parallel.each(
      batches,
      (batch) =>
        Parallel.each(
          batch,
          (action) => {
            return this.executeUpdate(
              resource,
              action,
              targetLocation,
              mappedMoves,
              donePlan
            )
          },
          ACTION_CONCURRENCY
        ),
      1
    )

    if (this.canceled) {
      throw new CancelledSyncError()
    }

    Logger.log(targetLocation + ': executing REMOVEs')
    await Parallel.each(
      planRevert.REMOVE.getActions(),
      (action) => {
        return this.executeRemove(
          resource,
          action,
          targetLocation,
          planRevert.REMOVE,
          donePlan
        )
      },
      ACTION_CONCURRENCY
    )
  }

  async toJSONAsync(): Promise<ISerializedSyncProcess> {
    if (!this.staticContinuation) {
      this.staticContinuation = {
        // Do not store these as the continuation size can get huge otherwise
        localTreeRoot: null,
        cacheTreeRoot: null,
        serverTreeRoot: null,
      }
    }
    const membersToPersist = this.getMembersToPersist()
    let iterations = 0
    return {
      strategy: 'unidirectional',
      ...this.staticContinuation,
      ...Object.fromEntries(
        await Parallel.map(
          membersToPersist,
          async(key) => {
            const value = this[key]
            if (
              value &&
              value.CREATE &&
              value.REMOVE &&
              value.UPDATE &&
              value.MOVE &&
              value.REORDER
            ) {
              // property holds a Plan
              return [
                key,
                Object.fromEntries(
                  await Parallel.map(
                    Object.entries(value),
                    async([key, diff]: [
                      string,
                      Diff<
                        TItemLocation,
                        TItemLocation,
                        Action<TItemLocation, TItemLocation>
                      >
                    ]) => {
                      if (diff && diff.toJSONAsync) {
                        return [key, await diff.toJSONAsync()]
                      }
                      if (diff && diff.toJSON) {
                        if (++iterations % 1000 === 0) {
                          await yieldToEventLoop()
                        }
                        return [key, diff.toJSON()]
                      }
                      return [key, diff]
                    }
                  )
                ),
              ]
            }
            if (value && value.toJSONAsync) {
              return [key, await value.toJSONAsync()]
            }
            if (value && value.toJSON) {
              if (++iterations % 1000 === 0) {
                await yieldToEventLoop()
              }
              return [key, value.toJSON()]
            }
            return [key, value]
          },
          1
        )
      ),
    }
  }
}
