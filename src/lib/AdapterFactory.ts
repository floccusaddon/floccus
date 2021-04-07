import { TAdapter } from './interfaces/Adapter'
import { IAccountData } from './interfaces/AccountStorage'

export default {
  registry: {},
  register(type:string, adapter: any):void {
    this.registry[type] = adapter
  },
  factory(data: any): TAdapter {
    if ('type' in data) {
      const adapter = this.registry[data.type]
      return new adapter(data)
    }
  },
  getDefaultValues(type:string):IAccountData {
    return {
      ...this.registry[type].getDefaultValues(),
      enabled: true,
    }
  }
}
