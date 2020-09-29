import { TItemType } from '../Tree'

export interface OrderingItem {
  type: TItemType
  id: string|number
}

type Ordering = OrderingItem[]
export default Ordering
