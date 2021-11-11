import DefaultStrategy from './Default'
import Diff, { ActionType } from '../Diff'
import * as Parallel from 'async-parallel'
import Mappings, { MappingSnapshot } from '../Mappings'
import { Folder, ItemLocation, TItem, TItemLocation } from '../Tree'
import Logger from '../Logger'
import { InterruptedSyncError } from '../../errors/Error'

export default class UnidirectionalSyncProcess extends DefaultStrategy {
  protected direction: TItemLocation

  setDirection(direction: TItemLocation): void {
    this.direction = direction
  }

  async sync(): Promise<void> {
    this.masterLocation = this.direction === ItemLocation.SERVER ? ItemLocation.LOCAL : ItemLocation.SERVER
    await this.prepareSync()

    if (this.canceled) {
      throw new InterruptedSyncError()
    }

    const {localDiff, serverDiff} = await this.getDiffs()
    Logger.log({localDiff, serverDiff})

    if (this.canceled) {
      throw new InterruptedSyncError()
    }

    let sourceDiff, targetDiff, target
    if (this.direction === ItemLocation.SERVER) {
      sourceDiff = localDiff
      targetDiff = serverDiff
      target = this.server
    } else {
      sourceDiff = serverDiff
      targetDiff = localDiff
      target = this.localTree
    }

    this.actionsPlanned = sourceDiff.getActions().length + targetDiff.getActions().length
    Logger.log({localTreeRoot: this.localTreeRoot, serverTreeRoot: this.serverTreeRoot, cacheTreeRoot: this.cacheTreeRoot})

    // First revert slave modifications

    let revertPlan = await this.revertDiff(targetDiff, this.direction)
    Logger.log({revertPlan})
    if (this.direction === ItemLocation.LOCAL) {
      this.applyFailsafe(revertPlan)
    }

    if (this.canceled) {
      throw new InterruptedSyncError()
    }

    revertPlan = await this.execute(target, revertPlan, this.direction)

    // Then reconcile master modifications with new slave changes and after having fetched the new trees
    await this.prepareSync()
    Logger.log({localTreeRoot: this.localTreeRoot, serverTreeRoot: this.serverTreeRoot, cacheTreeRoot: this.cacheTreeRoot})

    if (this.canceled) {
      throw new InterruptedSyncError()
    }

    const unmappedOverridePlan = await this.reconcileDiffs(sourceDiff, revertPlan, this.direction)
    // Fix UPDATEs: We want to map to new IDs instead of oldItem.id, because items may have been reinserted by revertPlan
    unmappedOverridePlan.getActions(ActionType.UPDATE).forEach(action => { action.oldItem = null })
    // have to get snapshot after reconciliation, because of concurrent creation reconciliation
    let mappingsSnapshot = this.mappings.getSnapshot()
    let overridePlan = unmappedOverridePlan.map(mappingsSnapshot, this.direction, (action) => action.type !== ActionType.REORDER && action.type !== ActionType.MOVE)
    // Fix MOVEs: We want execute to map to new IDs instead of oldItem.id, because items may have been reinserted by revertPlan
    overridePlan.getActions(ActionType.MOVE).forEach(action => { action.oldItem = null })

    Logger.log({overridePlan})

    if (this.direction === ItemLocation.LOCAL) {
      this.applyFailsafe(overridePlan)
    }

    if (this.canceled) {
      throw new InterruptedSyncError()
    }

    overridePlan = await this.execute(target, overridePlan, this.direction)

    // mappings have been updated, reload
    mappingsSnapshot = await this.mappings.getSnapshot()
    const overrideReorder = this.reconcileReorderings(overridePlan, revertPlan, mappingsSnapshot)
      .map(mappingsSnapshot, this.direction)

    if ('orderFolder' in target) {
      await Promise.all([
        this.executeReorderings(target, overrideReorder),
      ])
    }
  }

  async revertDiff(targetDiff: Diff, targetLocation: TItemLocation): Promise<Diff> {
    const mappingsSnapshot = await this.mappings.getSnapshot()
    // Prepare slave plan
    const plan = new Diff()

    // Prepare slave plan for reversing slave changes
    await Parallel.each(targetDiff.getActions(), async action => {
      if (action.type === ActionType.REMOVE) {
        // recreate it on slave resource otherwise
        const payload = await this.translateCompleteItem(action.payload, mappingsSnapshot, targetLocation)
        const oldItem = await this.translateCompleteItem(action.payload, mappingsSnapshot, targetLocation === ItemLocation.LOCAL ? ItemLocation.SERVER : ItemLocation.LOCAL)
        payload.createIndex()
        oldItem.createIndex()

        plan.commit({...action, type: ActionType.CREATE, payload, oldItem })
        return
      }
      if (action.type === ActionType.CREATE) {
        plan.commit({ ...action, type: ActionType.REMOVE })
        return
      }
      if (action.type === ActionType.MOVE) {
        const oldItem = action.oldItem.clone(false, targetLocation === ItemLocation.LOCAL ? ItemLocation.SERVER : ItemLocation.LOCAL)
        oldItem.id = Mappings.mapId(mappingsSnapshot, action.oldItem, oldItem.location)
        oldItem.parentId = Mappings.mapParentId(mappingsSnapshot, action.oldItem, oldItem.location)
        oldItem.createIndex()

        plan.commit({ type: ActionType.MOVE, payload: oldItem, oldItem: action.payload })
        return
      }
      if (action.type === ActionType.UPDATE) {
        const payload = action.oldItem.clone(false, action.payload.location)
        payload.id = action.payload.id
        payload.parentId = action.payload.parentId
        const oldItem = action.payload.clone(false, action.oldItem.location)
        oldItem.id = action.oldItem.id
        oldItem.parentId = action.oldItem.parentId
        plan.commit({ type: ActionType.UPDATE, payload, oldItem })
      }
    })

    return plan
  }

  private async translateCompleteItem(item: TItem, mappingsSnapshot: MappingSnapshot, fakeLocation: TItemLocation) {
    const newItem = item.clone(false, fakeLocation)
    newItem.id = Mappings.mapId(mappingsSnapshot, item, fakeLocation)
    newItem.parentId = Mappings.mapParentId(mappingsSnapshot, item, fakeLocation)
    if (newItem instanceof Folder) {
      const nonexistingItems = []
      await newItem.traverse(async(child, parentFolder) => {
        child.location = item.location // has been set to fakeLocation already by clone(), but for map to work we need to reset it
        child.id = Mappings.mapId(mappingsSnapshot, child, fakeLocation)
        if (typeof child.id === 'undefined') {
          nonexistingItems.push(child)
        }
        child.parentId = parentFolder.id
        child.location = fakeLocation
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
}
