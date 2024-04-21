import DefaultStrategy, { ISerializedSyncProcess } from './Default'
import Diff, { Action, ActionType } from '../Diff'
import * as Parallel from 'async-parallel'
import Mappings, { MappingSnapshot } from '../Mappings'
import { Folder, ItemLocation, TItem, TItemLocation } from '../Tree'
import Logger from '../Logger'
import { CancelledSyncError } from '../../errors/Error'
import MergeSyncProcess from './Merge'
import TResource, { IResource, OrderFolderResource } from '../interfaces/Resource'

export default class UnidirectionalSyncProcess extends DefaultStrategy {
  protected direction: TItemLocation
  protected revertPlan: Diff
  protected revertOrderings: Diff
  protected flagPreReordering = false
  protected sourceDiff: Diff

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
      throw new CancelledSyncError()
    }

    const {localDiff, serverDiff} = await this.getDiffs()
    Logger.log({localDiff, serverDiff})
    this.progressCb(0.5)

    if (this.canceled) {
      throw new CancelledSyncError()
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

    this.sourceDiff = sourceDiff
    this.revertPlan = await this.revertDiff(targetDiff, this.direction)
    this.actionsPlanned = this.revertPlan.getActions().length
    Logger.log({revertPlan: this.revertPlan})
    if (this.direction === ItemLocation.LOCAL) {
      this.applyFailsafe(this.revertPlan)
    }

    if (this.canceled) {
      throw new CancelledSyncError()
    }

    Logger.log('Executing ' + this.direction + ' revert plan')
    await this.execute(target, this.revertPlan, this.direction)

    const mappingsSnapshot = this.mappings.getSnapshot()
    Logger.log('Mapping reorderings')
    const revertOrderings = sourceDiff.map(
      mappingsSnapshot,
      this.direction,
      (action: Action) => action.type === ActionType.REORDER,
      true
    )
    Logger.log({revertOrderings: revertOrderings.getActions(ActionType.REORDER)})

    if ('orderFolder' in target) {
      await this.executeReorderings(target, revertOrderings)
    }
  }

  async resumeSync(): Promise<void> {
    if (typeof this.revertPlan === 'undefined') {
      Logger.log('Continuation loaded from storage is incomplete. Falling back to a complete new sync iteration')
      return this.sync()
    }
    Logger.log('Resuming sync with the following plan:')
    Logger.log({revertPlan: this.revertPlan})

    let target: IResource|OrderFolderResource
    if (this.direction === ItemLocation.SERVER) {
      target = this.server
    } else {
      target = this.localTree
    }

    Logger.log('Executing ' + this.direction + ' revert plan')
    await this.execute(target, this.revertPlan, this.direction)

    if ('orderFolder' in target) {
      if (!this.flagPostReorderReconciliation) {
        // mappings have been updated, reload
        const mappingsSnapshot = this.mappings.getSnapshot()
        Logger.log('Mapping reorderings')
        this.revertOrderings = this.sourceDiff.map(
          mappingsSnapshot,
          this.direction,
          (action: Action) => action.type === ActionType.REORDER,
          true
        )
      }

      this.flagPostReorderReconciliation = true

      Logger.log('Executing reorderings')
      await this.executeReorderings(target, this.revertOrderings)
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

  setState({localTreeRoot, cacheTreeRoot, serverTreeRoot, direction, revertPlan, revertOrderings, flagPreReordering, sourceDiff}: any) {
    this.setDirection(direction)
    this.localTreeRoot = Folder.hydrate(localTreeRoot)
    this.cacheTreeRoot = Folder.hydrate(cacheTreeRoot)
    this.serverTreeRoot = Folder.hydrate(serverTreeRoot)
    if (typeof revertPlan !== 'undefined') {
      this.revertPlan = Diff.fromJSON(revertPlan)
    }
    if (typeof sourceDiff !== 'undefined') {
      this.sourceDiff = Diff.fromJSON(sourceDiff)
    }
    if (typeof revertOrderings !== 'undefined') {
      this.revertOrderings = Diff.fromJSON(revertOrderings)
    }
    this.flagPreReordering = flagPreReordering
  }

  toJSON(): ISerializedSyncProcess {
    return {
      strategy: 'unidirectional',
      direction: this.direction,
      localTreeRoot: this.localTreeRoot.clone(false),
      cacheTreeRoot: this.cacheTreeRoot.clone(false),
      serverTreeRoot: this.serverTreeRoot.clone(false),
      sourceDiff: this.sourceDiff,
      revertPlan: this.revertPlan,
      revertOrderings: this.revertOrderings,
      flagPreReordering: this.flagPreReordering,
      actionsDone: this.actionsDone,
      actionsPlanned: this.actionsPlanned,
    }
  }
}
