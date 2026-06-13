/* global DEBUG, IS_BROWSER */
import util from 'util'
import * as Parallel from 'async-parallel'
import packageJson from '../../package.json'
import Crypto from './Crypto'
import { Share } from '@capacitor/share'
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem'
import { throttle } from 'throttle-debounce'
import asyncThrottle from '@jcoreio/async-throttle'

export default class Logger {
  static log() {
    const logMsg = [new Date().toISOString(), ...arguments]

    // log to console
    DEBUG && console.log(util.format.apply(util, logMsg))
    this.messages.push(util.format.apply(util, logMsg))
    throttledTrimLogs()
    throttledIntermittentPersist()
  }

  static trimLogs() {
    this.messages = this.messages.slice(-10000)
  }

  static async persist() {
    if (this.messages.length === 0) return
    const Storage = IS_BROWSER
      ? await import('./browser/BrowserAccountStorage')
      : await import('./native/NativeAccountStorage')
    await Storage.default.changeEntry(
      'logs',
      () => {
        const messages = this.messages.slice(-1000)
        this.messages = []
        return messages // only save the last sync run
      },
      []
    )
  }

  static async intermittentPersist() {
    const Storage = IS_BROWSER
      ? await import('./browser/BrowserAccountStorage')
      : await import('./native/NativeAccountStorage')
    if (this.messages.length === 0) return
    await Storage.default.changeEntry(
      'logs',
      () => {
        return this.messages.slice(-1000)
      },
      []
    )
  }

  static async getLogs() {
    const Storage = IS_BROWSER
      ? await import('./browser/BrowserAccountStorage')
      : await import('./native/NativeAccountStorage')
    return Storage.default.getEntry('logs', [])
  }

  static async anonymizeLogs(logs) {
    const regex = /\[(.*?)\]\((.*?)\)|\[(.*?)\]/g
    const newLogs = await Parallel.map(
      logs,
      async(entry) => {
        return Logger.replaceAsync(entry, regex, async(match, p1, p2, p3) => {
          if (p1 && p2) {
            const hash1 = await Crypto.sha256(p1)
            const hash2 = await Crypto.sha256(p2)
            return '[' + hash1 + ']' + '(' + hash2 + ')'
          } else if (p3) {
            const hash = await Crypto.sha256(p3)
            return '[' + hash + ']'
          }
        })
      },
      1
    )
    const regex2 = /url=https?%3A%2F%2F.*$|url=https?%3A%2F%2F[^ ]*/
    const regex3 = /https?:\/\/[^ /]*\//
    return newLogs.map((line) =>
      line.replace(regex2, '###url###').replace(regex3, '###server###')
    )
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
    let blob = new Blob([logs.join('\n')], {
      type: 'text/plain',
      endings: 'native',
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
    if (IS_BROWSER) {
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
      const { uri: fileURI } = await Filesystem.writeFile({
        path: 'Downloads/' + filename,
        data: await blob.text(),
        encoding: Encoding.UTF8,
        directory: Directory.External,
        recursive: true,
      })
      await Share.share({
        title: filename,
        files: [fileURI],
      })
    }
  }
}

const throttledTrimLogs = throttle(20000, () => Logger.trimLogs())
const throttledIntermittentPersist = asyncThrottle(async() => Logger.intermittentPersist(), 3000)

Logger.messages = []
