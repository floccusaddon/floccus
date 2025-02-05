import { Bookmark, TItemLocation } from '../lib/Tree'

export class FloccusError extends Error {
  public code: number

  constructor(message) {
    super(message)
    // See https://stackoverflow.com/questions/12915412/how-do-i-extend-a-host-object-e-g-error-in-typescript#22666069
    Object.setPrototypeOf(this, FloccusError.prototype)
  }
}

export class UnknownCreateTargetError extends FloccusError {
  constructor() {
    super("E001: Folder to create in doesn't exist")
    this.code = 1
    Object.setPrototypeOf(this, UnknownCreateTargetError.prototype)
  }
}

export class UnknownBookmarkUpdateError extends FloccusError {
  constructor() {
    super("E002: Bookmark to update doesn't exist anymore")
    this.code = 2
    Object.setPrototypeOf(this, UnknownBookmarkUpdateError.prototype)
  }
}

export class UnknownMoveOriginError extends FloccusError {
  constructor() {
    super("E003: Folder to move out of doesn't exist")
    this.code = 3
    Object.setPrototypeOf(this, UnknownMoveOriginError.prototype)
  }
}

export class UnknownMoveTargetError extends FloccusError {
  constructor() {
    super("E004: Folder to move into doesn't exist")
    this.code = 4
    Object.setPrototypeOf(this, UnknownMoveTargetError.prototype)
  }
}

export class UnknownFolderParentUpdateError extends FloccusError {
  constructor() {
    super("E006: Parent of folder to update doesn't exist")
    this.code = 5
    Object.setPrototypeOf(this, UnknownFolderParentUpdateError.prototype)
  }
}

export class UnknownFolderUpdateError extends FloccusError {
  constructor() {
    super("E006: Folder to update doesn't exist")
    this.code = 6
    Object.setPrototypeOf(this, UnknownFolderUpdateError.prototype)
  }
}

export class UnknownFolderMoveError extends FloccusError {
  constructor() {
    super("E007: Folder to move doesn't exist")
    this.code = 7
    Object.setPrototypeOf(this, UnknownFolderMoveError.prototype)
  }
}

// code 8 is unused
// code 9 is unused

export class UnknownFolderOrderError extends FloccusError {
  constructor() {
    super('E010: Could not find folder to order')
    this.code = 10
    Object.setPrototypeOf(this, UnknownFolderOrderError.prototype)
  }
}

export class UnknownFolderItemOrderError extends FloccusError {
  public item: string
  constructor(item: string) {
    super('E011: Item in folder ordering is not an actual child')
    this.code = 11
    this.item = item
    Object.setPrototypeOf(this, UnknownFolderItemOrderError.prototype)
  }
}

export class MissingItemOrderError extends FloccusError {
  public item: string
  constructor(item: string) {
    super("E012: Folder ordering is missing some of the folder's children")
    this.code = 12
    this.item = item
    Object.setPrototypeOf(this, MissingItemOrderError.prototype)
  }
}

export class UnknownFolderRemoveError extends FloccusError {
  constructor() {
    super("E013: Folder to remove doesn't exist")
    this.code = 13
    Object.setPrototypeOf(this, UnknownFolderRemoveError.prototype)
  }
}

export class UnknownFolderParentRemoveError extends FloccusError {
  constructor() {
    super("E014: Parent folder to remove folder from of doesn't exist")
    this.code = 14
    Object.setPrototypeOf(this, UnknownFolderParentRemoveError.prototype)
  }
}

export class UnexpectedServerResponseError extends FloccusError {
  constructor() {
    super('E015: Unexpected response data from server')
    this.code = 15
    Object.setPrototypeOf(this, UnexpectedServerResponseError.prototype)
  }
}

export class RequestTimeoutError extends FloccusError {
  constructor() {
    super('E016: Request timed out.')
    this.code = 16
    Object.setPrototypeOf(this, RequestTimeoutError.prototype)
  }
}

export class NetworkError extends FloccusError {
  constructor() {
    super('E017: Network error: Check your network connection and your profile details')
    this.code = 17
    Object.setPrototypeOf(this, NetworkError.prototype)
  }
}

export class AuthenticationError extends FloccusError {
  constructor() {
    super("E018: Couldn't authenticate with the server.")
    this.code = 18
    Object.setPrototypeOf(this, AuthenticationError.prototype)
  }
}

export class HttpError extends FloccusError {
  public status: number
  public method: string
  constructor(status: number, method: string) {
    super(`E019: HTTP status ${status}. Failed ${method} request. Check your server configuration and log.`)
    this.code = 19
    this.status = status
    this.method = method
    Object.setPrototypeOf(this, HttpError.prototype)
  }
}

export class ParseResponseError extends FloccusError {
  public response: string
  constructor(response: string) {
    super('E020: Could not parse server response. Is the bookmarks app installed on your server?')
    this.code = 20
    this.response = response
    Object.setPrototypeOf(this, ParseResponseError.prototype)
  }
}

export class InconsistentServerStateError extends FloccusError {
  constructor() {
    super('E021: Inconsistent server state. Folder is present in childorder list but not in folder tree')
    this.code = 21
    Object.setPrototypeOf(this, InconsistentServerStateError.prototype)
  }
}

export class InconsistentBookmarksExistenceError extends FloccusError {
  public folder: string
  public bookmark: string
  constructor(folder:string, bookmark:string) {
    super(`E022: Folder ${folder} supposedly contains non-existent bookmark ${bookmark}`)
    this.code = 22
    this.folder = folder
    this.bookmark = bookmark
    Object.setPrototypeOf(this, InconsistentBookmarksExistenceError.prototype)
  }
}

export class UnclearedLockFileError extends FloccusError {
  public lockFile: string

  constructor(lockFile:string) {
    super(`E023: Unable to clear lock file, consider deleting ${lockFile} manually.`)
    this.code = 23
    this.lockFile = lockFile
    Object.setPrototypeOf(this, UnclearedLockFileError.prototype)
  }
}

export class LockFileError extends FloccusError {
  public status: number
  public lockFile: string

  constructor(status:number, lockFile:string) {
    super(`E024: HTTP status ${status} while trying to determine status of lock file ${lockFile}`)
    this.code = 24
    this.status = status
    this.lockFile = lockFile
    Object.setPrototypeOf(this, LockFileError.prototype)
  }
}

export class SlashError extends FloccusError {
  public status: number
  public lockFile: string

  constructor() {
    super("E025: Bookmarks file setting mustn't begin with a slash: '/'")
    this.code = 25
    Object.setPrototypeOf(this, SlashError.prototype)
  }
}

export class CancelledSyncError extends FloccusError {
  constructor() {
    super('E026: Sync process was cancelled')
    this.code = 26
    Object.setPrototypeOf(this, InterruptedSyncError.prototype)
  }
}

export class InterruptedSyncError extends FloccusError {
  constructor() {
    super('E027: Sync process was interrupted')
    this.code = 27
    Object.setPrototypeOf(this, InterruptedSyncError.prototype)
  }
}

// code 28 is unused

export class FailsafeError extends FloccusError {
  public percent: number

  constructor(percent:number) {
    super(`E029: Failsafe: The current sync run would delete ${percent}% of your bookmarks. Refusing to execute. Disable this failsafe in the profile settings if you want to proceed anyway.`)
    this.code = 29
    this.percent = percent
    Object.setPrototypeOf(this, FailsafeError.prototype)
  }
}

export class DecryptionError extends FloccusError {
  constructor() {
    super('E030: Failed to decrypt bookmarks file. The passphrase may be wrong or the file may be corrupted.')
    this.code = 30
    Object.setPrototypeOf(this, DecryptionError.prototype)
  }
}

export class GoogleDriveAuthenticationError extends FloccusError {
  constructor() {
    super('E031: Could not authenticate with Google Drive. Please connect floccus with your google account again.')
    this.code = 31
    Object.setPrototypeOf(this, GoogleDriveAuthenticationError.prototype)
  }
}

export class OAuthTokenError extends FloccusError {
  constructor() {
    super('E032: OAuth error. Token validation error. Please reconnect your Google Account.')
    this.code = 32
    Object.setPrototypeOf(this, OAuthTokenError.prototype)
  }
}

export class RedirectError extends FloccusError {
  constructor() {
    super("E033: Redirect detected. Please make sure the server supports the selected sync method and URL you entered is correct doesn't redirect to a different location.")
    this.code = 33
    Object.setPrototypeOf(this, RedirectError.prototype)
  }
}

export class FileUnreadableError extends FloccusError {
  constructor() {
    super('E034: Remote bookmarks file is unreadable. Perhaps you forgot to set an encryption passphrase, or you set the wrong file format.')
    this.code = 34
    Object.setPrototypeOf(this, FileUnreadableError.prototype)
  }
}

export class CreateBookmarkError extends FloccusError {
  public bookmark: Bookmark<TItemLocation>
  constructor(bookmark: Bookmark<TItemLocation>) {
    super(`E035: Failed to create the following bookmark on the server: ${bookmark.inspect()}`)
    this.code = 35
    this.bookmark = bookmark
    Object.setPrototypeOf(this, CreateBookmarkError.prototype)
  }
}

export class MissingPermissionsError extends FloccusError {
  constructor() {
    super(`E036: Missing permissions to access the sync server`)
    this.code = 36
    Object.setPrototypeOf(this, MissingPermissionsError.prototype)
  }
}

export class ResourceLockedError extends FloccusError {
  constructor() {
    super(`E037: Resource is locked`)
    this.code = 37
    Object.setPrototypeOf(this, ResourceLockedError.prototype)
  }
}

export class LocalFolderNotFoundError extends FloccusError {
  constructor() {
    super(`E038: Could not find local folder`)
    this.code = 38
    Object.setPrototypeOf(this, LocalFolderNotFoundError.prototype)
  }
}

export class UpdateBookmarkError extends FloccusError {
  public bookmark: Bookmark<TItemLocation>
  constructor(bookmark: Bookmark<TItemLocation>) {
    super(`E039: Failed to update the following bookmark on the server: ${bookmark.inspect()}`)
    this.code = 39
    this.bookmark = bookmark
    Object.setPrototypeOf(this, UpdateBookmarkError.prototype)
  }
}

export class GoogleDriveSearchError extends FloccusError {
  constructor() {
    super('E040: Could not search for your file name in your Google Drive')
    this.code = 40
    Object.setPrototypeOf(this, GoogleDriveSearchError.prototype)
  }
}