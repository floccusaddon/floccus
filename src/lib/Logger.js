/* global DEBUG */
import util from 'util'
import * as Parallel from 'async-parallel'
import packageJson from '../../package.json'
import Crypto from './Crypto'
import { Share } from '@capacitor/share'
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem'
import { Capacitor } from '@capacitor/core'
import { db } from './IndexedDB'

export default class Logger {
  static log() {
    const dateTime = Date.now()
    const logMsg = [...arguments]
    const message = util.format.apply(util, logMsg)

    // log to console
    DEBUG && console.log(util.format.apply(util, logMsg))
    db.logs.add({dateTime, message})
      .catch(e => {
        console.error('Failed to log to IndexedDB: ', e)
        console.error(e)
      })
  }

  static async getLogs() {
    return db.logs.orderBy('dateTime').toArray()
  }

  static async anonymizeLogs(logs) {
    const regex = /\[(.*?)\]\((.*?)\)|\[(.*?)\]/g
    await Parallel.map(logs, async(logMessage) => {
      logMessage.message = await Logger.replaceAsync(logMessage.message, regex, async(match, p1, p2, p3) => {
        if (p1 && p2) {
          const hash1 = await Crypto.sha256(p1)
          const hash2 = await Crypto.sha256(p2)
          return '[' + hash1 + ']' + '(' + hash2 + ')'
        } else if (p3) {
          const hash = await Crypto.sha256(p3)
          return '[' + hash + ']'
        }
      })
    }, 1)
    const regex2 = /url=https?%3A%2F%2F.*$|url=https?%3A%2F%2F[^ ]*/
    const regex3 = /https?:\/\/[^ /]*\//
    logs
      .forEach(logMessage => {
        logMessage.message = logMessage.message.replace(regex2, '###url###').replace(regex3, '###server###')
      })
    return logs
  }

  static async replaceAsync(str, regex, asyncFn) {
    // Stolen from https://stackoverflow.com/questions/33631041/javascript-async-await-in-replace
    const promises = []
    str.replace(regex, (match, ...args) => {
      const promise = asyncFn(match, ...args)
      promises.push(promise)
    })
    let data
    try {
      data = await Promise.all(promises)
    } catch (e) {
      console.error(e)
    }
    return str.replace(regex, () => data.shift())
  }

  static async downloadLogs(anonymous = false) {
    let logs = await this.getLogs()
    if (anonymous) {
      logs = await Logger.anonymizeLogs(logs)
    }
    logs = logs
      .map(logMessage => {
        return new Date(logMessage.dateTime).toISOString() + ' ' + logMessage.message
      })
      .join('\n')
    let blob = new Blob([logs], {
      type: 'text/plain',
      endings: 'native'
    })
    this.download(
      'floccus-' +
        packageJson.version +
        '-' +
        new Date().toISOString().slice(0, 10) +
        '-' +
        (anonymous ? 'redacted' : 'full') +
        '.log',
      blob
    )
  }

  static async download(filename, blob) {
    if (Capacitor.getPlatform() === 'web') {
      const element = document.createElement('a')

      let objectUrl = URL.createObjectURL(blob)
      element.setAttribute('href', objectUrl)
      element.setAttribute('download', filename)

      element.style.display = 'none'
      document.body.appendChild(element)

      element.click()

      URL.revokeObjectURL(objectUrl)
      document.body.removeChild(element)
    } else {
      const {uri: fileURI} = await Filesystem.writeFile({
        path: 'Downloads/' + filename,
        data: await blob.text(),
        encoding: Encoding.UTF8,
        directory: Directory.External,
        recursive: true
      })
      await Share.share({
        title: filename,
        files: [fileURI],
      })
    }
  }
}
