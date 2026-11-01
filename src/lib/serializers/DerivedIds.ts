import { Folder, ItemLocation, TItem } from '../Tree'

/**
 * Bookmark files written by other programs (a Linkwarden export, the Via
 * browser, ...) carry no ids, and they are typically rewritten wholesale on
 * every change, so floccus can't add any either. The mappings refer to items by
 * id, though, so an id has to identify the same item on every sync: numbering
 * items by their position would point the mappings at other items as soon as
 * something is inserted before them (#2322, #2396).
 *
 * Items without an id therefore get one derived from what they are:
 *  - a bookmark from its URL, so it keeps its id wherever it moves
 *  - a folder from its parent's id and its title
 * plus the number of earlier id-less items with the same key, to tell
 * duplicates apart. Derived ids are negative, while the ids floccus hands out
 * itself (`CachingAdapter#highestId`) are positive, so the two never collide.
 *
 * Deriving the same id again on every read is what keeps the mappings valid;
 * the ids need not be stored for that. They only come out the same for items
 * that haven't changed, though: a bookmark whose URL changes, or a folder that
 * is renamed or moved -- and with it every folder below it, since their keys
 * contain its id -- gets a new id, which the sync sees as a removal plus a
 * creation (bookmarks are paired up again by URL, folders aren't). That holds
 * for the ids floccus wrote itself too, once another program strips them.
 *
 * Ids are not part of the tree hash, so the file adapters wouldn't write a file
 * just because ids were derived for it. See `mustPersistDerivedIds` for when
 * they do.
 */
export function assignDerivedIds(root: Folder<typeof ItemLocation.SERVER>): IDerivedIdStats {
  const used = new Set<string>()
  collectIds(root, used)
  const stats: IDerivedIdStats = { explicit: used.size, derived: 0 }
  const occurrences = new Map<string, number>()

  const assign = (folder: Folder<typeof ItemLocation.SERVER>) => {
    for (const child of folder.children) {
      child.parentId = folder.id
      if (!hasId(child)) {
        const key = child.type === 'bookmark'
          ? 'bookmark\u0000' + child.url
          : 'folder\u0000' + String(folder.id) + '\u0000' + child.title
        const occurrence = occurrences.get(key) || 0
        occurrences.set(key, occurrence + 1)
        let id = -hash(key + '\u0000' + occurrence)
        // A collision is astronomically unlikely, but must not merge two items
        while (used.has(String(id))) {
          id = id === -Number.MAX_SAFE_INTEGER ? -1 : id - 1
        }
        used.add(String(id))
        child.id = id
        stats.derived++
      }
      if (child instanceof Folder) {
        assign(child)
      }
    }
  }
  assign(root)
  return stats
}

export interface IDerivedIdStats {
  /** Items that already had an id in the file */
  explicit: number
  /** Items that got a derived id */
  derived: number
}

/**
 * Whether the file has to be written back so the derived ids get stored.
 *
 * A file that has ids for some items but not for others was written by
 * floccus and then edited by a program that keeps ids but doesn't hand out any
 * (e.g. a text editor). Writing it once stores the derived ids, so that program
 * renaming a folder or changing a URL later on reaches the sync as an update
 * rather than a removal plus a creation.
 *
 * A file without any ids is left alone: it most likely comes from a program
 * that rewrites the whole file without ids (Via, a Linkwarden export, ...).
 * The ids would be stripped again right away, and writing the file on every
 * sync would only risk overwriting that program's concurrent changes.
 */
export function mustPersistDerivedIds(stats: IDerivedIdStats): boolean {
  return stats.derived > 0 && stats.explicit > 0
}

function hasId(item: TItem<typeof ItemLocation.SERVER>): boolean {
  return item.id !== undefined && item.id !== null && item.id !== '' && !Number.isNaN(item.id)
}

function collectIds(folder: Folder<typeof ItemLocation.SERVER>, used: Set<string>) {
  for (const child of folder.children) {
    if (hasId(child)) {
      used.add(String(child.id))
    }
    if (child instanceof Folder) {
      collectIds(child, used)
    }
  }
}

/**
 * cyrb53: a fast, well-distributed 53-bit string hash. Synchronous, unlike the
 * ones in Crypto, which deserialize can't await. Never returns 0.
 */
export function hash(str: string): number {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507)
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507)
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  const result = 4294967296 * (2097151 & h2) + (h1 >>> 0)
  return result || 1
}
