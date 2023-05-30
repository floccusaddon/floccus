export default interface IController {
  setEnabled(enabled:boolean): void;
  setKey(key):Promise<void>;
  unlock(key):Promise<void>;
  unsetKey():Promise<void>;
  scheduleSync(accountId, wait):Promise<void>;
  cancelSync(accountId, keepEnabled):Promise<void>;
  syncAccount(accountId, strategy):Promise<void>;
  onStatusChange(listener):()=>void;
  getKey():Promise<string|null>;
  getUnlocked():Promise<boolean>;
}
