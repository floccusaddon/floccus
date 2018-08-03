import browser from '../lib/browser-api'
import AccountStorage from './AccountStorage'
import util from 'util'

export default class Logger {
  static log() {
    const logMsg = arguments

    // log to console
    console.log.apply(console, logMsg)

    // log to storage (in background)
    AccountStorage.changeEntry(
      'log',
      log => {
        log = log.slice(-5000) // rotate log to max of 5000 entries
        log.push(util.format.apply(util, logMsg))
        return log
      },
      []
    )
  }

  static async getLogs() {
    return AccountStorage.getEntry('log')
  }

  static async downloadLogs() {
    const logs = await this.getLogs()
    this.download('floccus.log', logs.join('\r\n'))
  }

  static download(filename, text) {
    var element = document.createElement('a')
    element.setAttribute(
      'href',
      'data:text/plain;charset=utf-8,' + encodeURIComponent(text)
    )
    element.setAttribute('download', filename)

    element.style.display = 'none'
    document.body.appendChild(element)

    element.click()

    document.body.removeChild(element)
  }
}
