/* global DEBUG */
import AccountStorage from './AccountStorage'
import util from 'util'

import packageJson from '../../package.json'

export default class Logger {
  static log() {
    const logMsg = [new Date().toISOString(), ...arguments]

    // log to console
    DEBUG && console.log.apply(console, logMsg)
    this.messages.push(util.format.apply(util, logMsg)) // TODO: Use a linked list here to get O(n)
  }

  static async persist() {
    await AccountStorage.changeEntry(
      'logs',
      log => {
        const messages = this.messages
        this.messages = []
        return messages // only save the last sync run
      },
      []
    )
  }

  static async getLogs() {
    return AccountStorage.getEntry('logs', [])
  }

  static async downloadLogs() {
    const logs = await this.getLogs()
    console.log(logs)
    let blob = new Blob([logs.join('\n')], {
      type: 'text/plain',
      endings: 'native'
    })
    this.download(
      'floccus-' +
        packageJson.version +
        '-' +
        new Date().toISOString().slice(0, 10) +
        '.log',
      blob
    )
  }

  static download(filename, blob) {
    const element = document.createElement('a')

    let objectUrl = URL.createObjectURL(blob)
    element.setAttribute('href', objectUrl)
    element.setAttribute('download', filename)

    element.style.display = 'none'
    document.body.appendChild(element)

    element.click()

    URL.revokeObjectURL(objectUrl)
    document.body.removeChild(element)
  }
}
Logger.messages = []
