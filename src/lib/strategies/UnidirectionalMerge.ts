import Diff from '../Diff'
import Unidirectional from './Unidirectional'
import MergeSyncProcess from './Merge'

export default class UnidirectionalMergeSyncProcess extends Unidirectional {
  async getDiffs():Promise<{localDiff:Diff, serverDiff:Diff}> {
    return MergeSyncProcess.prototype.getDiffs.apply(this) // cheeky!
  }

  async loadChildren() :Promise<void> {
    this.serverTreeRoot = await this.server.getBookmarksTree(true)
  }
}
