import { TAdapter } from './interfaces/Adapter'
import { IAccountData } from './interfaces/AccountStorage'

export default {
  registry: {},
  register(type:string, adapter: any):void {
    this.registry[type] = adapter
  },
  async factory(data: any): Promise<TAdapter> {
    if ('type' in data) {
      const adapter = await this.registry[data.type]()
      return new adapter(data)
    }
  },
  async getDefaultValues(type:string):Promise<IAccountData> {
    const adapter = await this.registry[type]()
    return {
      ...adapter.getDefaultValues(),
      enabled: true,
    }
  }
}
