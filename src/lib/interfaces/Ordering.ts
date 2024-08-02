import { TItemLocation, TItemType } from '../Tree'

export interface OrderingItem<L extends TItemLocation> {
  type: TItemType
  id: string|number
}

type Ordering<L extends TItemLocation> = OrderingItem<L>[]
export default Ordering
