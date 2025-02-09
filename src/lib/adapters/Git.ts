import CachingAdapter from './Caching'
import XbelSerializer from '../serializers/Xbel'
import Logger from '../Logger'
import { Capacitor } from '@capacitor/core'
import * as git from 'isomorphic-git'
import http from 'isomorphic-git/http/web'
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import FS from '@isomorphic-git/lightning-fs'
import Html from '../serializers/Html'
import {
  FileUnreadableError,
  MissingPermissionsError,
  ResourceLockedError,
  SlashError
} from '../../errors/Error'
import Crypto from '../Crypto'

const LOCK_INTERVAL = 2 * 60 * 1000 // Lock every 2mins while syncing
const LOCK_TIMEOUT = 15 * 60 * 1000 // Override lock 0.25h after last time lock has been set
export default class GitAdapter extends CachingAdapter {
  private lockingInterval: any
  private lockingPromise: Promise<void>
  private locked: string[]
  private cancelCallback: () => void
  private initialTreeHash: string
  private dir: string
  private hash: string
  private fs: FS|null

  constructor(server) {
    super(server)
    this.server = server
    this.locked = []
    this.lockingInterval = null
  }

  static getDefaultValues() {
    return {
      type: 'git',
      url: 'https://example.org/repo.git',
      username: 'bob',
      password: 's3cret',
      branch: 'main',
      bookmark_file: 'bookmarks.xbel',
      bookmark_file_type: 'xbel',
      includeCredentials: false,
      allowRedirects: false,
      allowNetwork: false,
    }
  }

  getLabel():string {
    const data = this.getData()
    const url = new URL(data.url)
    url.protocol = ''
    return data.label || data.username + '@' + url.hostname + ':' + data.bookmark_file
  }

  getData() {
    return { ...GitAdapter.getDefaultValues(), ...this.server }
  }

  cancel() {
    this.cancelCallback && this.cancelCallback()
  }

  async onSyncStart(needLock = true, forceLock = false) {
    Logger.log('onSyncStart: begin')

    this.hash = await Crypto.sha256(JSON.stringify(this.server)) + Date.now()
    this.dir = '/' + this.hash + '/'

    if (Capacitor.getPlatform() === 'web') {
      const browser = (await import('../browser-api')).default
      let hasPermissions, error = false
      try {
        hasPermissions = await browser.permissions.contains({ origins: [this.server.url + '/'] })
      } catch (e) {
        error = true
        console.warn(e)
      }
      if (!error && !hasPermissions) {
        throw new MissingPermissionsError()
      }
    }

    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    this.fs = new FS(this.hash, {wipe: true})

    Logger.log('(git) init')
    await git.init({ fs: this.fs, dir: this.dir })
    await git.addRemote({
      fs: this.fs,
      dir: this.dir,
      url: this.server.url,
      remote: 'origin',
      force: true
    })

    try {
      Logger.log('(git) fetch from remote')
      await git.fetch({
        http,
        fs: this.fs,
        dir: this.dir,
        tags: true,
        pruneTags: true,
        remote: 'origin',
        depth: 10,
        onAuth: () => this.onAuth()
      })
      Logger.log('(git) checkout branch ' + (this.server.branch))
      await git.checkout({ fs: this.fs, dir: this.dir, ref: this.server.branch })
    } catch (e) {
      if (e && e.code === git.Errors.NotFoundError.code && (e.data.what === 'HEAD' || e.data.what === this.server.branch || e.data.what === 'origin/' + this.server.branch)) {
        Logger.log('(git) writeFile ' + this.dir + '/README.md')
        await this.fs.promises.writeFile(this.dir + '/README.md', 'This repository is used to synchronize bookmarks via [floccus](https://floccus.org).', {mode: 0o777, encoding: 'utf8'})
        Logger.log('(git) add .')
        await git.add({fs: this.fs, dir: this.dir, filepath: '.'})
        Logger.log('(git) commit')
        await git.commit({
          fs: this.fs,
          dir: this.dir,
          message: 'Floccus bookmarks update',
          author: {
            name: 'Floccus bookmarks sync',
          }
        })
        const currentBranch = await git.currentBranch({fs: this.fs, dir: this.dir})
        if (currentBranch && currentBranch !== this.server.branch) {
          await git.renameBranch({ fs: this.fs, dir: this.dir, ref: this.server.branch, oldref: currentBranch })
        }
        Logger.log('(git) push')
        await git.push({
          fs: this.fs,
          http,
          dir: this.dir,
          ref: this.server.branch,
          remoteRef: this.server.branch,
          remote: 'origin',
          onAuth: () => this.onAuth()
        })
      } else {
        throw e
      }
    }

    if (this.server.bookmark_file[0] === '/') {
      throw new SlashError()
    }

    if (this.lockingInterval) {
      clearInterval(this.lockingInterval)
    }
    if (forceLock) {
      await this.clearAllLocks()
      await this.setLock()
    } else if (needLock) {
      await this.obtainLock()
    }
    if (needLock || forceLock) {
      this.lockingInterval = setInterval(() => this.setLock(), LOCK_INTERVAL) // Set lock every minute
    }

    const status = await this.pullFromServer()

    this.initialTreeHash = await this.bookmarksCache.hash(true)

    Logger.log('onSyncStart: completed')

    return status
  }

  async onSyncFail() {
    Logger.log('onSyncFail')
    clearInterval(this.lockingInterval)
    await this.freeLock()
    indexedDB.deleteDatabase(this.hash)
  }

  async onSyncComplete() {
    Logger.log('onSyncComplete')
    clearInterval(this.lockingInterval)

    this.bookmarksCache = this.bookmarksCache.clone()
    const newTreeHash = await this.bookmarksCache.hash(true)
    if (newTreeHash !== this.initialTreeHash) {
      const fileContents = this.server.bookmark_file_type === 'xbel' ? createXBEL(this.bookmarksCache, this.highestId) : createHTML(this.bookmarksCache, this.highestId)
      Logger.log('(git) writeFile ' + this.dir + '/' + this.server.bookmark_file)
      await this.fs.promises.writeFile(this.dir + '/' + this.server.bookmark_file, fileContents, {mode: 0o777, encoding: 'utf8'})
      Logger.log('(git) add .')
      await git.add({fs: this.fs, dir: this.dir, filepath: '.'})
      Logger.log('(git) commit')
      await git.commit({
        fs: this.fs,
        dir: this.dir,
        message: `Floccus update: ${this.getLabel()}`,
        author: {
          name: 'Floccus bookmarks sync',
        }
      })
      try {
        Logger.log('(git) push')
        await git.push({
          fs: this.fs,
          http,
          dir: this.dir,
          remote: 'origin',
          force: true,
          onAuth: () => this.onAuth()
        })
      } catch (e) {
        if (e.code && e.code === git.Errors.PushRejectedError.code) {
          await this.freeLock() // Only clears the locks set in the current adapter instance
          throw new ResourceLockedError
        }
      }
    } else {
      Logger.log('No changes to the server version necessary')
    }

    await this.freeLock()
    indexedDB.deleteDatabase(this.hash)
  }

  async obtainLock() {
    const tags = await git.listTags({ fs: this.fs, dir: this.dir })
    const lockTag = tags.sort().reverse().find((tag) => tag.startsWith('floccus-lock-'))
    if (lockTag) {
      const dateLocked = Number(lockTag.slice('floccus-lock-'.length))
      if (Date.now() - dateLocked < LOCK_TIMEOUT) {
        throw new ResourceLockedError()
      }
    }

    await this.setLock()
  }

  async setLock() {
    this.lockingPromise = (async() => {
      const tag = 'floccus-lock-' + Date.now()
      Logger.log('(git) tag ' + tag)
      await git.tag({ fs: this.fs, dir: this.dir, ref: tag })
      Logger.log('(git) push tag ' + tag)
      await git.push({ fs: this.fs, http, dir: this.dir, ref: tag, onAuth: () => this.onAuth() })
      this.locked.push(tag)
    })()
    await this.lockingPromise
  }

  async onAuth() {
    return { username: this.server.username, password: this.server.password }
  }

  async freeLock() {
    if (this.lockingPromise) {
      await this.lockingPromise
    }
    if (!this.locked.length) {
      return
    }

    try {
      for (const tag of this.locked) {
        Logger.log('(git) push: delete tag ' + tag)
        await git.push({ fs: this.fs, http, dir: this.dir, ref: tag, delete: true, onAuth: () => this.onAuth() })
      }
      this.locked = []
      return true
    } catch (e) {
      Logger.log('Error Caught')
      Logger.log(e)
      return false
    }
  }

  async clearAllLocks(): Promise<void> {
    const tags = await git.listTags({ fs: this.fs, dir: this.dir })
    const lockTags = tags.filter(tag => tag.startsWith('floccus-lock-'))
    for (const tag of lockTags) {
      await git.push({ fs: this.fs, http, dir: this.dir, ref: tag, delete: true, onAuth: () => this.onAuth() })
    }
  }

  async pullFromServer() {
    let fileContents
    try {
      Logger.log('(git) readFile')
      fileContents = await this.fs.promises.readFile(this.dir + '/' + this.server.bookmark_file, { encoding: 'utf8' })
    } catch (e) {
      this.resetCache()
      // Could not find file
      return false
    }

    if (!fileContents || (!fileContents.includes('<?xml version="1.0" encoding="UTF-8"?>') && !fileContents.includes('<!DOCTYPE NETSCAPE-Bookmark-file-1>'))) {
      throw new FileUnreadableError()
    }

    /* let's get the highestId */
    for (const line of fileContents.split('\n')) {
      if (line.indexOf('<!--- highestId :') >= 0) {
        const idxStart = line.indexOf(':') + 1
        const idxEnd = line.lastIndexOf(':')

        this.highestId = parseInt(line.substring(idxStart, idxEnd))
        break
      }
    }

    switch (this.server.bookmark_file_type) {
      case 'xbel':
        Logger.log('(git) parse XBEL')
        this.bookmarksCache = XbelSerializer.deserialize(fileContents)
        break
      case 'html':
        Logger.log('(git) parse HTML')
        this.bookmarksCache = Html.deserialize(fileContents)
        break
      default:
        throw new Error('Invalid bookmark file type')
    }

    // Found file, we can keep the cache from the previous run
    return true
  }

  async clearServer() {
    const hash = await Crypto.sha256(JSON.stringify(this.server)) + Date.now()
    this.dir = '/' + hash + '/'

    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    const fs = new FS(hash, {wipe: true})

    Logger.log('(git) init')
    await git.init({ fs, dir: this.dir, defaultBranch: this.server.branch })
    await git.addRemote({
      fs,
      dir: this.dir,
      url: this.server.url,
      remote: 'origin',
      force: true
    })
    await fs.promises.writeFile(this.dir + '/README.md', 'This repository is used to synchronize bookmarks via [floccus](https://floccus.org).', {mode: 0o777, encoding: 'utf8'})
    await git.add({fs, dir: this.dir, filepath: '.'})
    await git.commit({
      fs,
      dir: this.dir,
      message: 'Floccus bookmarks update',
      author: {
        name: 'Floccus bookmarks sync',
      }
    })
    const currentBranch = await git.currentBranch({fs, dir: this.dir})
    if (currentBranch && currentBranch !== this.server.branch) {
      await git.renameBranch({ fs, dir: this.dir, ref: this.server.branch, oldref: currentBranch })
    }
    await git.push({
      fs,
      http,
      dir: this.dir,
      ref: this.server.branch,
      remoteRef: this.server.branch,
      remote: 'origin',
      force: true,
      onAuth: () => this.onAuth()
    })
    await git.fetch({
      http,
      fs,
      dir: this.dir,
      tags: true,
      pruneTags: true,
      remote: 'origin',
      depth: 10,
      onAuth: () => this.onAuth()
    })
    await this.clearAllLocks()
  }
}

function createXBEL(rootFolder, highestId) {
  let output = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE xbel PUBLIC "+//IDN python.org//DTD XML Bookmark Exchange Language 1.0//EN//XML" "http://pyxml.sourceforge.net/topics/dtds/xbel.dtd">
<xbel version="1.0">
`

  output +=
    '<!--- highestId :' +
    highestId +
    `: for Floccus bookmark sync browser extension -->
`

  output += XbelSerializer.serialize(rootFolder)

  output += `
</xbel>`

  return output
}

function createHTML(rootFolder, highestId) {
  let output = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>`

  output +=
    '<!--- highestId :' +
    highestId +
    `: for Floccus bookmark sync browser extension -->
`

  output += Html.serialize(rootFolder)

  output += '</html>'

  return output
}
