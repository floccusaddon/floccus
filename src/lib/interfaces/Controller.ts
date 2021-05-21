export default interface IController {
  key: string;
  setEnabled(): void;
  setKey(key):Promise<void>;
  unlock(key):Promise<void>;
  unsetKey():Promise<void>;
  onchange(localId, details):Promise<void>;
  scheduleSync(accountId, wait):Promise<void>;
  cancelSync(accountId, keepEnabled):Promise<void>;
  syncAccount(accountId, strategy):Promise<void>;
  updateStatus():Promise<void>;
  onStatusChange(listener):()=>void;
  onLoad():Promise<void>;
}
