import { Folder, ItemLocation } from '../Tree'

export interface IDeserializedFile {
  tree: Folder<typeof ItemLocation.SERVER>
  /**
   * The file has to be written back even if the sync changes nothing, so the
   * ids derived for some of its items get stored (see `mustPersistDerivedIds`).
   */
  persistIds: boolean
}

export default interface Serializer {
  serialize(folder:Folder<typeof ItemLocation.SERVER>): string
  deserialize(data:string):Folder<typeof ItemLocation.SERVER>
  deserializeFile(data:string):IDeserializedFile
}
