import DefaultStrategy from './Default'
import Diff from '../Diff'
import { ItemLocation, TItemLocation } from '../Tree'
import Logger from '../Logger'
import { InterruptedSyncError } from '../../errors/Error'
import MergeSyncProcess from './Merge'

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

    let sourceDiff, target
    if (this.direction === ItemLocation.SERVER) {
      sourceDiff = localDiff
      target = this.server
    } else {
      sourceDiff = serverDiff
      target = this.localTree
    }

    Logger.log({localTreeRoot: this.localTreeRoot, serverTreeRoot: this.serverTreeRoot, cacheTreeRoot: this.cacheTreeRoot})

    const mappingsSnapshot = this.mappings.getSnapshot()
    const revertPlan = sourceDiff.map(mappingsSnapshot, this.direction)
    this.actionsPlanned = revertPlan.getActions().length
    Logger.log({revertPlan})
    if (this.direction === ItemLocation.LOCAL) {
      this.applyFailsafe(revertPlan)
    }

    if (this.canceled) {
      throw new InterruptedSyncError()
    }

    await this.execute(target, revertPlan, this.direction)

    if ('orderFolder' in target) {
      await Promise.all([
        this.executeReorderings(target, revertPlan),
      ])
    }
  }
}
