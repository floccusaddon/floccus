import Adapter from './interfaces/Adapter'

export default {
  registry: {},
  register(type:string, adapter: Adapter):void {
    this.registry[type] = adapter
  },
  factory(data: any): Adapter {
    if ('type' in data) {
      const adapter = this.registry[data.type]
      return new adapter(data)
    }
  }
}
