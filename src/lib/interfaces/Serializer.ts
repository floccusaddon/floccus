import { Folder } from '../Tree'

export default interface Serializer {
  serialize(folder:Folder): string
  deserialize(data:string):Folder
}
