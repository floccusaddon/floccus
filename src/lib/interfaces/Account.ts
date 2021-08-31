import { IAccountData } from './AccountStorage'
import Account from '../Account'

export default interface IAccount {
  get(id:string):Promise<Account>
  create(data: IAccountData):Promise<Account>
  import(accounts:IAccountData[]):Promise<void>
  export(accountIds:string[]):Promise<IAccountData[]>
  getAllAccounts():Promise<Account[]>
  getAccountsContainingLocalId(localId:string, ancestors:string[], allAccounts:Account[]):Promise<Account[]>
}
