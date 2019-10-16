import CachingAdapter from './Caching'
import { OptionDelete } from '../components/basics'

const { h } = require('hyperapp')

export default class FakeAdapter extends CachingAdapter {
  constructor(server) {
    super()
    this.server = server
  }

  static getDefaultValues() {
    return {
      type: 'fake'
    }
  }

  static renderOptions(state, update) {
    return (
      <div>
        <p>Fake account</p>
        <OptionDelete account={state.account} />
      </div>
    )
  }

  setData(data) {
    this.server = data
  }

  getData() {
    return JSON.parse(JSON.stringify(this.server))
  }

  getLabel() {
    return 'Fake account (floccus)'
  }
}
