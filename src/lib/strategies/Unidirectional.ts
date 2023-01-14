import DefaultStrategy from './Default'
import Diff, { Action, ActionType } from '../Diff'
import * as Parallel from 'async-parallel'
import Mappings, { MappingSnapshot } from '../Mappings'
import { Folder, ItemLocation, TItem, TItemLocation } from '../Tree'
import Logger from '../Logger'
import { InterruptedSyncError } from '../../errors/Error'
import MergeSyncProcess from './Merge'
import TResource from '../interfaces/Resource'

export default class UnidirectionalSyncProcess extends DefaultStrategy {
  protected direction: TItemLocation

  setDirection(direction: TItemLocation): void {
    this.direction = direction
  }

  async getDiffs():Promise<{localDiff:Diff, serverDiff:Diff}> {
    return MergeSyncProcess.prototype.getDiffs.apply(this) // cheeky!
  }

  async loadChildren() :Promise<void> {
    this.serverTreeRoot = await this.server.getBookmarksTree(true)
  }

  async sync(): Promise<void> {
    this.progressCb(0.15)

    this.masterLocation = this.direction === ItemLocation.SERVER ? ItemLocation.LOCAL : ItemLocation.SERVER
    await this.prepareSync()

    this.progressCb(0.35)

    if (this.canceled) {
      throw new InterruptedSyncError()
    }

    const {localDiff, serverDiff} = await this.getDiffs()
    Logger.log({localDiff, serverDiff})
    this.progressCb(0.5)

    if (this.canceled) {
      throw new InterruptedSyncError()
    }

    let sourceDiff: Diff, targetDiff: Diff, target: TResource
    if (this.direction === ItemLocation.SERVER) {
      sourceDiff = localDiff
      targetDiff = serverDiff
      target = this.server
    } else {
      sourceDiff = serverDiff
      targetDiff = localDiff
      target = this.localTree
    }

    Logger.log({localTreeRoot: this.localTreeRoot, serverTreeRoot: this.serverTreeRoot, cacheTreeRoot: this.cacheTreeRoot})

    // First revert slave modifications

    const revertPlan = await this.revertDiff(targetDiff, this.direction)
    this.actionsPlanned = revertPlan.getActions().length
    Logger.log({revertPlan})
    if (this.direction === ItemLocation.LOCAL) {
      this.applyFailsafe(revertPlan)
    }

    if (this.canceled) {
      throw new InterruptedSyncError()
    }

    await this.execute(target, revertPlan, this.direction)

    const mappingsSnapshot = this.mappings.getSnapshot()
    const revertOrderings = sourceDiff.map(
      mappingsSnapshot,
      this.direction,
      (action: Action) => action.type === ActionType.REORDER,
      true
    )
    Logger.log({revertOrderings: revertOrderings.getActions(ActionType.REORDER)})

    if ('orderFolder' in target) {
      await Promise.all([
        this.executeReorderings(target, revertOrderings),
      ])
    }
  }

  async revertDiff(targetDiff: Diff, targetLocation: TItemLocation): Promise<Diff> {
    const mappingsSnapshot = this.mappings.getSnapshot()
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
      if (action.type === ActionType.REORDER) {
        plan.commit({ ...action })
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
