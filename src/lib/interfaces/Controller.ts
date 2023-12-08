export default interface IController {
  setEnabled(enabled:boolean): void;
  unlock(key):Promise<void>;
  scheduleSync(accountId, wait):Promise<void>;
  scheduleAll():Promise<void>;
  cancelSync(accountId, keepEnabled):Promise<void>;
  syncAccount(accountId, strategy):Promise<void>;
  onStatusChange(listener):()=>void;
  getUnlocked():Promise<boolean>;
  onLoad():void;
}
