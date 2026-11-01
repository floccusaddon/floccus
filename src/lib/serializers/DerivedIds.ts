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
 * Once floccus writes the file, the derived ids are stored like any other; if
 * another program strips them again, they come out the same.
 */
export function assignDerivedIds(root: Folder<typeof ItemLocation.SERVER>): void {
  const used = new Set<string>()
  collectIds(root, used)
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
      }
      if (child instanceof Folder) {
        assign(child)
      }
    }
  }
  assign(root)
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
