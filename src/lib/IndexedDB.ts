import Dexie, { type EntityTable } from 'dexie'

interface LogMessage {
  id: number;
  dateTime: number;
  message: string;
}

const db = new Dexie('floccus') as Dexie & {
  logs: EntityTable<
    LogMessage,
    'id' // primary key "id" (for the typings only)
  >;
}

db.version(1).stores({
  logs: '++id, dateTime, message'
})

export { db }
export { LogMessage }

const MAX_STORAGE_SIZE = 50 * 1024 * 1024 // 50MB

export async function freeStorageIfNecessary() {
  if (navigator.storage && navigator.storage.estimate) {
    let {usage, quota} = await navigator.storage.estimate()
    if (usage / quota > 0.9 || usage > MAX_STORAGE_SIZE) {
      const oneWeekAgo = Date.now() - 60 * 60 * 1000 * 24 * 7

      await db.logs
        .where('dateTime').below(oneWeekAgo)
        .delete()
    }

    ({usage, quota} = await navigator.storage.estimate())
    if (usage / quota > 0.6 || usage > MAX_STORAGE_SIZE) {
      const oneDayAgo = Date.now() - 60 * 60 * 1000 * 24

      await db.logs
        .where('dateTime').below(oneDayAgo)
        .delete()
    }
  }
}