/* global DEBUG, IS_BROWSER */
import util from 'util'
import * as Parallel from 'async-parallel'
import packageJson from '../../package.json'
import Crypto from './Crypto'
import { Share } from '@capacitor/share'
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem'
import { throttle } from 'throttle-debounce'
import asyncThrottle from '@jcoreio/async-throttle'
import { isTest } from './isTest'

/**
 * How many lines of the log are kept around for #downloadLogs.
 *
 * The storages trim their end themselves, so this is what a reader gets to see
 * -- not what a persist has to write.
 */
export const LOG_RETENTION = 1000

/**
 * How many lines may pile up unpersisted. A persist drains the buffer every few
 * seconds, so this only ever bites when storage fails or falls behind.
 */
const MAX_PENDING = 10000

export default class Logger {
  static log() {
    const logMsg = [new Date().toISOString(), ...arguments]

    // log to console
    DEBUG && console.log(util.format.apply(util, logMsg))
    this.messages.push(util.format.apply(util, logMsg))
    // Diagnostic: skip timer-driven trim/persist under test so they don't race
    // with in-flight sync mutations.
    if (isTest) return
    throttledTrimLogs()
    throttledPersist()
  }

  static trimLogs() {
    this.messages = this.messages.slice(-MAX_PENDING)
  }

  /**
   * Hand the lines logged since the last time over to storage.
   *
   * Only those: the storage appends them and trims its own end, so a persist
   * costs what has happened since the last one rather than a rewrite of the
   * whole log. That used to be a multi-megabyte write every three seconds, and
   * on Android -- where it went into the preferences, which are rewritten whole
   * -- it took about seven seconds a time, which over a large sync added up to
   * most of its wall clock.
   */
  static async persist() {
    if (this.messages.length === 0) return
    const Storage = IS_BROWSER
      ? await import('./browser/BrowserAccountStorage')
      : await import('./native/NativeAccountStorage')
    const messages = this.messages
    this.messages = []
    try {
      await Storage.default.appendLogs(messages)
    } catch (e) {
      // Put them back in front of whatever was logged in the meantime, so that
      // the next persist gets another go at them
      this.messages = messages.concat(this.messages).slice(-MAX_PENDING)
      throw e
    }
  }

  static async getLogs() {
    const Storage = IS_BROWSER
      ? await import('./browser/BrowserAccountStorage')
      : await import('./native/NativeAccountStorage')
    // Whatever hasn't been persisted yet is part of the log the caller asked
    // for -- and it's usually the most interesting part of it
    await this.persist()
    return Storage.default.getLogs()
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
const throttledPersist = asyncThrottle(async() => {
  try {
    await Logger.persist()
  } catch (e) {
    // Nobody is waiting on this one, and failing to store the log is no reason
    // to take down whatever was being logged
    console.error(e)
  }
}, 3000)

Logger.messages = []
