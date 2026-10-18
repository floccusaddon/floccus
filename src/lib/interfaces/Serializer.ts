import { Folder, ItemLocation } from '../Tree'

export default interface Serializer {
  serialize(folder:Folder<typeof ItemLocation.SERVER>): string
  deserialize(data:string, options?: { allowMissingIds?: boolean }):Folder<typeof ItemLocation.SERVER>
}
