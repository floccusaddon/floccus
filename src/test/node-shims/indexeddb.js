/* global globalThis */
import { indexedDB, IDBKeyRange } from 'fake-indexeddb'

/**
 * IndexedDB for the node test suite.
 *
 * fake-indexeddb's own `auto` entry hangs its globals off `window` when there is
 * one -- and nodejs-shim fakes a window -- so the code under test, which looks
 * `indexedDB` up on the global scope like a browser would, would never see
 * them. Put them where they are actually read instead.
 *
 * The data lives for as long as the process does, like the preferences and
 * sqlite shims next door.
 */
globalThis.indexedDB = indexedDB
globalThis.IDBKeyRange = IDBKeyRange
