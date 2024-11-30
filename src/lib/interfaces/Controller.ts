export default interface IController {
  setEnabled(enabled:boolean): void;
  unlock(key):Promise<void>;
  scheduleSync(accountId, wait):Promise<void>;
  scheduleAll():Promise<void>;
  cancelSync(accountId, keepEnabled):Promise<void>;
  syncAccount(accountId, strategy, forceSync):Promise<void>;
  onStatusChange(listener):()=>void;
  getUnlocked():Promise<boolean>;
  onLoad():Promise<void>;
}

export const STATUS_ERROR = Symbol('error')
export const STATUS_SYNCING = Symbol('syncing')
export const STATUS_ALLGOOD = Symbol('allgood')
export const STATUS_DISABLED = Symbol('disabled')
