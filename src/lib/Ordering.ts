import Logger from './Logger'

/**
 * Helpers for applying an `Ordering` to a folder's children.
 *
 * They live here rather than in an adapter so that a tree implementation (the
 * browser's, say) can use them without importing from `adapters/`.
 */

export interface IOrderableItem {
  type: string
  id: string | number
}

function itemKey(item: IOrderableItem): string {
  return item.type + ':' + item.id
}

/**
 * The children `order` asks for, in that order, with the children it does not
 * name put back at the indices they have now.
 *
 * An order action routinely names only part of a folder: it comes from a scan
 * of one side, so it says nothing about items that side doesn't have yet, and
 * the items that were removed or moved away in the same sync are taken out of
 * it. The target must not sort the rest to the end for that; they stay where
 * they are, which is also what BrowserTree does with the tabs it doesn't touch.
 * `canOrder` leaves children alone that this folder cannot order, e.g. ones
 * whose parentId says they belong somewhere else.
 *
 * The result is a new array; `children` itself is not modified.
 */
export function applyOrdering<T extends IOrderableItem>(
  children: T[],
  order: IOrderableItem[],
  canOrder: (child: T) => boolean = () => true
): T[] {
  const byKey = new Map<string, T>()
  for (const child of children) {
    const key = itemKey(child)
    if (!byKey.has(key)) {
      byKey.set(key, child)
    }
  }

  const placed = new Set<T>()
  const taken = new Set<string>()
  const ordered: T[] = []
  for (const item of order) {
    const key = itemKey(item)
    if (taken.has(key)) {
      continue
    }
    const child = byKey.get(key)
    if (!child || !canOrder(child)) {
      Logger.log('ORDERFOLDER: skipping item ', item)
      continue
    }
    taken.add(key)
    placed.add(child)
    ordered.push(child)
  }

  children.forEach((child, index) => {
    if (placed.has(child)) {
      return
    }
    ordered.splice(Math.min(index, ordered.length), 0, child)
  })
  return ordered
}

/**
 * Whether two child lists amount to the very same order (by type and id).
 */
export function sameOrdering(a: IOrderableItem[], b: IOrderableItem[]): boolean {
  if (a.length !== b.length) {
    return false
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i].type !== b[i].type || String(a[i].id) !== String(b[i].id)) {
      return false
    }
  }
  return true
}
