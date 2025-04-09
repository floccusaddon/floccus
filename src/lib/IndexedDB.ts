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

export async function freeStorageIfNecessary() {
  if (navigator.storage && navigator.storage.estimate) {
    let {usage, quota} = await navigator.storage.estimate()
    if (usage / quota > 0.9) {
      const oneWeekAgo = Date.now() - 60 * 60 * 1000 * 24 * 7

      await db.logs
        .where('dateTime').below(oneWeekAgo)
        .delete()
    }

    ({usage, quota} = await navigator.storage.estimate())
    if (usage / quota > 0.6) {
      const oneDayAgo = Date.now() - 60 * 60 * 1000 * 24

      await db.logs
        .where('dateTime').below(oneDayAgo)
        .delete()
    }
  }
}