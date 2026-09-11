import { Preferences as LegacyStorage } from '@capacitor/preferences'

const DB_NAME = 'floccus-native-storage'
const DB_VERSION = 1
const STORE_NAME = 'entries'

let dbPromise

function getDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION)
      request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  }
  return dbPromise
}

export default class NativeStorage {
  static async get(key) {
    const db = await getDb()
    const value = await new Promise((resolve, reject) => {
      const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(key)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })

    if (value !== undefined) return value

    // Migrate existing Capacitor Preferences data lazily, one key at a time.
    const legacy = await LegacyStorage.get({key})
    if (!legacy.value) return undefined

    let migratedValue = legacy.value
    try {
      migratedValue = JSON.parse(legacy.value)
    } catch (_) {}

    await NativeStorage.set(key, migratedValue)
    return migratedValue
  }

  static async set(key, value) {
    const db = await getDb()
    return new Promise((resolve, reject) => {
      const request = db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).put(value, key)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }

  static async remove(key) {
    const db = await getDb()
    return new Promise((resolve, reject) => {
      const request = db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).delete(key)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }
}
