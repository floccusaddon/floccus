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

/**
 * How long a single line of the log may get, in characters.
 *
 * The browser rewrites the whole stored log on every persist (see
 * BrowserAccountStorage#appendLogs), so its size is what a persist costs. With
 * LOG_RETENTION lines this keeps it at a few megabytes at most; unbounded
 * lines -- a dumped subtree, a plan of thousands of actions, the mappings --
 * once made it hundreds of megabytes, written every three seconds (#2432).
 */
export const MAX_LINE_LENGTH = 10000

export function truncateLogLine(line) {
  if (typeof line !== 'string' || line.length <= MAX_LINE_LENGTH) {
    return line
  }
  return line.slice(0, MAX_LINE_LENGTH) +
    ` [... ${line.length - MAX_LINE_LENGTH} more characters truncated]`
}

export default class Logger {
  static log() {
    const logMsg = [new Date().toISOString(), ...arguments]
    const line = util.format.apply(util, logMsg)

    // log to console
    DEBUG && console.log(line)
    this.messages.push(truncateLogLine(line))
    // Diagnostic: skip timer-driven trim/persist under test so they don't race
    // with in-flight sync mutations.
    if (isTest) return
    throttledTrimLogs()
    throttledPersist()
  }

  /**
   * Log a text that is too long for one line of the log in full -- e.g. a
   * whole tree from Folder#inspect -- spread over as many lines as it takes.
   *
   * It is split between its own lines, so each part reads on its own; only a
   * single line of the text longer than MAX_LINE_LENGTH is still truncated.
   * Each part costs one of the LOG_RETENTION lines, so keep this for what is
   * worth it: a tree of 5000 items takes up about 70 of them.
   */
  static logLines(header, text) {
    // Leave room for what #log puts in front of each part: the timestamp and
    // `${header} (i/n):\n`
    const budget = MAX_LINE_LENGTH - String(header).length - 64
    const parts = []
    let part = ''
    for (const line of String(text).split('\n')) {
      if (part && part.length + 1 + line.length > budget) {
        parts.push(part)
        part = ''
      }
      part = part ? part + '\n' + line : line
    }
    parts.push(part)
    parts.forEach((part, i) => {
      Logger.log(`${header} (${i + 1}/${parts.length}):\n${part}`)
    })
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
