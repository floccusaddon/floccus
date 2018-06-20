import { Bookmark } from '../Tree'
import CachingAdapter from './Caching'
import { OptionDelete } from '../components/basics'

const url = require('url')

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

  static renderOptions(state, actions) {
    return (
      <Account account={state.account}>
        <p>Fake account</p>
        <OptionDelete account={state.account} />
      </Account>
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
