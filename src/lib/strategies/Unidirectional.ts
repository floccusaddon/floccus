import DefaultStrategy, { ISerializedSyncProcess } from './Default'
import Diff, { ActionType, PlanRevert, PlanStage1, PlanStage3, ReorderAction } from '../Diff'
import * as Parallel from 'async-parallel'
import Mappings, { MappingSnapshot } from '../Mappings'
import { Folder, ItemLocation, TItem, TItemLocation, TOppositeLocation } from '../Tree'
import Logger from '../Logger'
import { CancelledSyncError } from '../../errors/Error'
import TResource from '../interfaces/Resource'
import Scanner, { ScanResult } from '../Scanner'
import DefaultSyncProcess from './Default'

const ACTION_CONCURRENCY = 12

export default class UnidirectionalSyncProcess extends DefaultStrategy {
  protected direction: TItemLocation
  protected revertPlan: PlanStage1<TItemLocation, TOppositeLocation<TItemLocation>>
  protected revertDonePlan: PlanRevert<TItemLocation, TOppositeLocation<TItemLocation>>
  protected revertReorders: Diff<TItemLocation, TOppositeLocation<TItemLocation>, ReorderAction<TItemLocation, TOppositeLocation<TItemLocation>>>

  setDirection(direction: TItemLocation): void {
    this.direction = direction
  }

  getMembersToPersist() {
    return [
      // Stage 0
      'localScanResult',
      'serverScanResult',

      // Stage 1
      'revertPlan',
      'revertDonePlan',

      // Stage 2
      'revertReorders',
    ]
  }

  async getDiffs():Promise<{localScanResult:ScanResult<typeof ItemLocation.LOCAL, TItemLocation>, serverScanResult:ScanResult<typeof ItemLocation.SERVER, TItemLocation>}> {
    const mappingsSnapshot = this.mappings.getSnapshot()

    const newMappings = []
    const localScanner = new Scanner(
      this.serverTreeRoot,
      this.localTreeRoot,
      // We can't rely on a cacheTree, thus we have to accept canMergeWith results as well
      (serverItem, localItem) => {
        if (localItem.type !== serverItem.type) {
          return false
        }
        // If a bookmark's URL has changed we want to recreate it instead of updating it, because of Nextcloud Bookmarks' uniqueness constraints
        if (serverItem.type === 'bookmark' && localItem.type === 'bookmark' && serverItem.url !== localItem.url) {
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
      this.preserveOrder,
      false,
      false
    )
    const serverScanner = new Scanner(
      this.localTreeRoot,
      this.serverTreeRoot,
      (localItem, serverItem) => {
        if (serverItem.type !== localItem.type) {
          return false
        }
        // If a bookmark's URL has changed we want to recreate it instead of updating it, because of Nextcloud Bookmarks' uniqueness constraints
        if (serverItem.type === 'bookmark' && localItem.type === 'bookmark' && serverItem.url !== localItem.url) {
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
      this.preserveOrder,
      false,
      false
    )
    const localScanResult = await localScanner.run()
    const serverScanResult = await serverScanner.run()
    await Parallel.map(newMappings, ([localItem, serverItem]) => {
      return this.addMapping(this.server, localItem, serverItem.id)
    })

    return {localScanResult, serverScanResult}
  }

  async loadChildren(serverTreeRoot:Folder<typeof ItemLocation.SERVER>) :Promise<void> {
    Logger.log('Unidirectional: Loading whole tree')
    serverTreeRoot.children = (await this.server.getBookmarksTree(true)).children
  }

  async sync(): Promise<void> {
    this.progressCb(0.15)

    this.masterLocation = this.direction === ItemLocation.SERVER ? ItemLocation.LOCAL : ItemLocation.SERVER
    await this.prepareSync()

    this.progressCb(0.35)

    if (this.canceled) {
      throw new CancelledSyncError()
    }

    Logger.log({localTreeRoot: this.localTreeRoot, serverTreeRoot: this.serverTreeRoot, cacheTreeRoot: this.cacheTreeRoot})

    if (!this.localScanResult && !this.serverScanResult) {
      const { localScanResult, serverScanResult } = await this.getDiffs()
      Logger.log({ localScanResult, serverScanResult })
      this.localScanResult = localScanResult
      this.serverScanResult = serverScanResult
      this.progressCb(0.45)
    }

    if (this.canceled) {
      throw new CancelledSyncError()
    }

    let sourceScanResult: ScanResult<TItemLocation, TItemLocation>,
      targetScanResult: ScanResult<TItemLocation, TItemLocation>,
      target: TResource<TItemLocation>
    if (this.direction === ItemLocation.SERVER) {
      sourceScanResult = this.localScanResult
      targetScanResult = this.serverScanResult
      target = this.server
    } else {
      sourceScanResult = this.serverScanResult
      targetScanResult = this.localScanResult
      target = this.localTree
    }

    // First revert slave modifications

    if (!this.revertPlan) {
      this.revertPlan = await this.revertDiff(targetScanResult, sourceScanResult, this.direction)
      Logger.log({revertPlan: this.revertPlan})
    }

    if (this.canceled) {
      throw new CancelledSyncError()
    }

    this.actionsPlanned = Object.values(this.revertPlan).reduce((acc, diff) => diff.getActions().length + acc, 0)

    if (this.direction === ItemLocation.LOCAL) {
      this.applyFailsafe(this.revertPlan.REMOVE)
    }

    if (this.canceled) {
      throw new CancelledSyncError()
    }

    Logger.log('Executing ' + this.direction + ' revert plan')

    this.revertDonePlan = {
      CREATE: new Diff(),
      UPDATE: new Diff(),
      MOVE: new Diff(),
      REMOVE: new Diff(),
      REORDER: new Diff(),
    }

    await this.executeRevert(target, this.revertPlan, this.direction, this.revertDonePlan, sourceScanResult.REORDER)

    if ('orderFolder' in this.server && !this.revertReorders) {
      const mappingsSnapshot = this.mappings.getSnapshot()
      Logger.log('Mapping reorderings')
      this.revertReorders = sourceScanResult.REORDER.map(mappingsSnapshot, this.direction)
    }

    if ('orderFolder' in this.server && 'orderFolder' in target) {
      await this.executeReorderings(target, this.revertReorders)
    }
  }

  async revertDiff<L1 extends TItemLocation, L2 extends TItemLocation>(
    targetScanResult: ScanResult<L1, L2>,
    sourceScanResult: ScanResult<L2, L1>,
    targetLocation: L1
  ): Promise<PlanRevert<L1, L2>> {
    const mappingsSnapshot = this.mappings.getSnapshot()

    const slavePlan: PlanRevert<L1, L2> = {
      CREATE: new Diff(),
      UPDATE: new Diff(),
      MOVE: new Diff(),
      REMOVE: new Diff(),
      REORDER: targetScanResult.REORDER.clone(),
    }

    // Prepare slave plan for reversing slave changes

    await Parallel.each(sourceScanResult.CREATE.getActions(), async(action) => {
      // recreate it on slave resource otherwise
      const payload = await this.translateCompleteItem(action.payload, mappingsSnapshot, targetLocation)
      const oldItem = action.payload
      payload.createIndex()
      oldItem.createIndex()

      slavePlan.CREATE.commit({...action, type: ActionType.CREATE, payload, oldItem })
    }, ACTION_CONCURRENCY)

    await Parallel.each(targetScanResult.CREATE.getActions(), async(action) => {
      slavePlan.REMOVE.commit({ ...action, type: ActionType.REMOVE })
    }, ACTION_CONCURRENCY)

    await Parallel.each(targetScanResult.UPDATE.getActions(), async(action) => {
      const payload = action.oldItem.cloneWithLocation(false, action.payload.location)
      payload.id = action.payload.id
      payload.parentId = action.payload.parentId

      const oldItem = action.payload.cloneWithLocation(false, action.oldItem.location)
      oldItem.id = action.oldItem.id
      oldItem.parentId = action.oldItem.parentId
      slavePlan.UPDATE.commit({ type: ActionType.UPDATE, payload, oldItem })
    }, ACTION_CONCURRENCY)

    await Parallel.each(targetScanResult.MOVE.getActions(), async(action) => {
      const payload = action.payload.cloneWithLocation(false, action.oldItem.location)
      payload.id = action.oldItem.id
      payload.parentId = action.oldItem.parentId

      slavePlan.MOVE.commit({ type: ActionType.MOVE, payload }) // no oldItem, because we want to map the id after having executed the CREATEs
    }, ACTION_CONCURRENCY)

    return slavePlan
  }

  private async translateCompleteItem<L1 extends TItemLocation, L2 extends TItemLocation>(item: TItem<L1>, mappingsSnapshot: MappingSnapshot, fakeLocation: L2) {
    const newItem = item.cloneWithLocation(false, fakeLocation)
    newItem.id = Mappings.mapId(mappingsSnapshot, item, fakeLocation)
    newItem.parentId = Mappings.mapParentId(mappingsSnapshot, item, fakeLocation)
    if (newItem instanceof Folder) {
      const nonexistingItems = []
      await newItem.traverse(async(child, parentFolder) => {
        child.id = Mappings.mapId(mappingsSnapshot, child, fakeLocation)
        if (typeof child.id === 'undefined') {
          nonexistingItems.push(child)
        }
        child.parentId = parentFolder.id
      })
      newItem.createIndex()
      // filter out all items that couldn't be mapped: These are creations from the slave side
      nonexistingItems.forEach(item => {
        const folder = newItem.findFolder(item.parentId)
        folder.children = folder.children.filter(i => i.id)
      })
    } else {
      newItem.createIndex()
    }
    return newItem
  }

  async executeRevert<L1 extends TItemLocation>(
    resource:TResource<L1>,
    planRevert:PlanRevert<L1, TOppositeLocation<L1>>,
    targetLocation:L1,
    donePlan: PlanStage3<TOppositeLocation<L1>, TItemLocation, L1>,
    reorders: Diff<TOppositeLocation<L1>, TItemLocation, ReorderAction<TOppositeLocation<L1>, TItemLocation>>): Promise<void> {
    Logger.log('Executing revert plan for ' + targetLocation)

    let createActions = planRevert.CREATE.getActions()
    while (createActions.length > 0) {
      Logger.log(targetLocation + ': executing CREATEs')
      await Parallel.each(
        createActions,
        (action) => this.executeCreate(resource, action, targetLocation, planRevert.CREATE, reorders, donePlan),
        ACTION_CONCURRENCY
      )
      createActions = planRevert.CREATE.getActions()
    }

    if (this.canceled) {
      throw new CancelledSyncError()
    }

    Logger.log(targetLocation + ': executing CREATEs')

    await Parallel.each(
      planRevert.UPDATE.getActions(),
      (action) => this.executeUpdate(resource, action, targetLocation, planRevert.UPDATE, donePlan),
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

    const batches = Diff.sortMoves(mappedMoves.getActions(), this.getTargetTree(targetLocation))

    if (this.canceled) {
      throw new CancelledSyncError()
    }

    Logger.log(targetLocation + ': executing MOVEs')
    await Parallel.each(batches, batch => Parallel.each(batch, (action) => {
      return this.executeUpdate(resource, action, targetLocation, mappedMoves, donePlan)
    }, ACTION_CONCURRENCY), 1)

    if (this.canceled) {
      throw new CancelledSyncError()
    }

    Logger.log(targetLocation + ': executing REMOVEs')
    await Parallel.each(planRevert.REMOVE.getActions(), (action) => {
      return this.executeRemove(resource, action, targetLocation, planRevert.REMOVE, donePlan)
    }, ACTION_CONCURRENCY)
  }

  toJSON(): ISerializedSyncProcess {
    return {
      ...DefaultSyncProcess.prototype.toJSON.apply(this),
      strategy: 'unidirectional'
    }
  }
}
