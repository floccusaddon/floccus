import { Bookmark, Folder, ItemLocation, ItemType, TItem, TItemLocation, TItemType } from './Tree'
import { ITombstone } from './interfaces/Resource'

/**
 * The identities a tree's items turn into tombstones with, and how two trees
 * are compared to find the ones that were deleted between them.
 *
 * Identity is deliberately forgiving, because a client that lost its mappings
 * can only match by what the item is:
 *  - the server id, which a client with mappings translates to its local item;
 *  - a bookmark's url, or a folder's title, together with the path of folder
 *    titles it sits under.
 *
 * An item that only *looks* like a deleted one is not treated as it: two items
 * match if either key matches, so a folder re-created with a new id but the same
 * title and parent (a server rewrite of the file, say) is not a deletion, and
 * neither is an item whose id was stripped by another program. Being too eager
 * here deletes the user's items; being too cautious merely leaves a deletion
 * unrecorded.
 *
 * A client without mappings can only match by content, which cannot tell a
 * stale local copy of the deleted item from one the user added again. That is
 * why the items a successful sync left behind are remembered by their durable
 * identity (see itemIdentityKey) and a content match only counts when that
 * identity is in it.
 */

export function itemIdKey(type: TItemType, id: string | number): string {
  return type + '\u0000' + String(id)
}

/** What an item is, regardless of its id -- see the module comment */
export function tombstoneKey(tombstone: ITombstone): string {
  const path = tombstone.parentPath.join('\u0000')
  return tombstone.type === ItemType.BOOKMARK
    ? 'bookmark\u0000' + path + '\u0000' + (tombstone.url || '')
    : 'folder\u0000' + path + '\u0000' + (tombstone.title || '')
}

export interface IIndexedItem<L extends TItemLocation> {
  item: TItem<L>
  parent: Folder<L>
  depth: number
  identity: ITombstone
}

function identityOf<L extends TItemLocation>(item: TItem<L>, parentPath: string[]): ITombstone {
  return {
    type: item.type,
    id: item.id,
    parentPath,
    ...(item.type === ItemType.BOOKMARK
      ? { url: (item as Bookmark<L>).url }
      : { title: (item as Folder<L>).title }),
  }
}

function forEachItem<L extends TItemLocation>(
  tree: Folder<L>,
  parentPath: string[],
  depth: number,
  visit: (item: TItem<L>, parent: Folder<L>, parentPath: string[], depth: number) => void
): void {
  for (const child of tree.children) {
    visit(child, tree, parentPath, depth)
    if (child instanceof Folder) {
      forEachItem(child, [...parentPath, child.title || ''], depth + 1, visit)
    }
  }
}

/**
 * The durable identity of an item: its type and id, plus what it is.
 *
 * `Account` persists this for every item a successful sync left behind
 * (`syncedItemIdentities`), and a tombstone that is matched by content only
 * deletes a local item whose identity is in that set. A stale local copy still
 * has the id it was synced under; an item the user added again has a new one,
 * even though its url or title and parent look the same.
 */
export function itemIdentityKey<L extends TItemLocation>(item: TItem<L>, parentPath: string[]): string {
  return itemIdKey(item.type, item.id) + '\u0000' + tombstoneKey(identityOf(item, parentPath))
}

/** The identity keys of every item in a tree, see itemIdentityKey */
export function itemIdentities<L extends TItemLocation>(tree: Folder<L>): string[] {
  const identities: string[] = []
  forEachItem(tree, [], 0, (item, parent, parentPath) => {
    identities.push(itemIdentityKey(item, parentPath))
  })
  return identities
}

/**
 * Whether the tree holds items whose id was derived from their content rather
 * than read from the file (see serializers/DerivedIds.ts).
 *
 * A derived id changes when a folder is renamed or moved -- and with it the ids
 * of everything below it -- so a history diff would take that rename for the
 * deletion of the old folder and its whole subtree. Tombstone derivation skips
 * such commits (see GitAdapter#getTombstonesSince); the limitation is that a
 * deletion in a file without explicit ids is not recorded. That only costs the
 * resurrection a cache-less client would cause, never a user's item.
 */
export function hasDerivedIds<L extends TItemLocation>(tree: Folder<L>): boolean {
  let found = false
  forEachItem(tree, [], 0, (item) => {
    if (typeof item.id === 'number' && item.id < 0) {
      found = true
    }
  })
  return found
}

/** Every item of a tree with the identity a tombstone would describe it by */
export function indexTreeItems<L extends TItemLocation>(tree: Folder<L>): IIndexedItem<L>[] {
  const items: IIndexedItem<L>[] = []
  forEachItem(tree, [], 0, (item, parent, parentPath, depth) => {
    items.push({ item, parent, depth, identity: identityOf(item, parentPath) })
  })
  return items
}

interface ITreeIdentities {
  ids: Set<string>
  contents: Set<string>
}

function identitiesIn<L extends TItemLocation>(tree: Folder<L>): ITreeIdentities {
  const ids = new Set<string>()
  const contents = new Set<string>()
  forEachItem(tree, [], 0, (item, parent, parentPath) => {
    ids.add(itemIdKey(item.type, item.id))
    contents.add(tombstoneKey(identityOf(item, parentPath)))
  })
  return { ids, contents }
}

function isPresent(identities: ITreeIdentities, identity: ITombstone): boolean {
  if (identity.id !== undefined && identity.id !== null && identities.ids.has(itemIdKey(identity.type, identity.id))) {
    return true
  }
  return identities.contents.has(tombstoneKey(identity))
}

/**
 * The items `before` has that `after` no longer has.
 *
 * An item counts as still present when `after` has the same id or the same
 * content under the same parent path -- see the module comment.
 */
export function deletedBetween<L extends TItemLocation>(before: Folder<L>, after: Folder<L>): ITombstone[] {
  const present = identitiesIn(after)
  const deleted: ITombstone[] = []
  forEachItem(before, [], 0, (item, parent, parentPath) => {
    const identity = identityOf(item, parentPath)
    if (!isPresent(present, identity)) {
      deleted.push(identity)
    }
  })
  return deleted
}

/** The content keys of the items `after` has that `before` did not (see tombstoneKey) */
export function addedBetween<L1 extends TItemLocation, L2 extends TItemLocation>(before: Folder<L2>, after: Folder<L1>): string[] {
  const present = identitiesIn(before)
  const added: string[] = []
  forEachItem(after, [], 0, (item, parent, parentPath) => {
    const identity = identityOf(item, parentPath)
    if (!isPresent(present, identity)) {
      added.push(tombstoneKey(identity))
    }
  })
  return added
}

/**
 * Drop the tombstones of items the tree still has.
 *
 * This is what lets a re-added item survive its own deletion: it is a new
 * identity, but it has the same url and parent as the old one, and the tree
 * the sync is about to merge against has it. Only items that are really gone
 * from the server may delete the local counterpart.
 */
export function withoutPresentItems<L extends TItemLocation>(tombstones: ITombstone[], tree: Folder<L>): ITombstone[] {
  const present = identitiesIn(tree)
  return tombstones.filter((tombstone) => !isPresent(present, tombstone))
}

/** An empty tree, for a history whose first snapshot has no items */
export function emptyTombstoneTree(): Folder<typeof ItemLocation.SERVER> {
  return new Folder({ id: 0, title: 'root', location: ItemLocation.SERVER })
}
