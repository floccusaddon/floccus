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

db.delete().then(() => console.log('Deleted floccus database'))

export { db }
export { LogMessage }

export async function freeStorageIfNecessary() {
  // noop
}