import Diff from '../Diff'
import Unidirectional from './Unidirectional'
import MergeSyncProcess from './Merge'
import { OrderFolderResource } from '../interfaces/Resource'
import Logger from '../Logger'

export default class UnidirectionalMergeSyncProcess extends Unidirectional {
  async getDiffs():Promise<{localDiff:Diff, serverDiff:Diff}> {
    return MergeSyncProcess.prototype.getDiffs.apply(this) // cheeky!
  }

  async loadChildren() :Promise<void> {
    this.serverTreeRoot = await this.server.getBookmarksTree(true)
  }

  async executeReorderings(resource:OrderFolderResource, reorderings:Diff):Promise<void> {
    Logger.log('Skipping reorderings because this is a merge process ',{ reorderings })
  }
}
