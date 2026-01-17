import { Bookmark, TItemLocation } from '../lib/Tree'

export class FloccusError extends Error {
  public readonly code: number

  constructor(message) {
    super(message)
    // See https://stackoverflow.com/questions/12915412/how-do-i-extend-a-host-object-e-g-error-in-typescript#22666069
    Object.setPrototypeOf(this, FloccusError.prototype)
  }
}

export class TransientError extends FloccusError {
  constructor(message) {
    super(message)
    Object.setPrototypeOf(this, TransientError.prototype)
  }
}

export class UnknownCreateTargetError extends FloccusError {
  public readonly code = 1
  constructor() {
    super("E001: Folder to create in doesn't exist")
    Object.setPrototypeOf(this, UnknownCreateTargetError.prototype)
  }
}

export class UnknownBookmarkUpdateError extends TransientError {
  public readonly code = 2
    constructor() {
    super("E002: Bookmark to update doesn't exist anymore")
    Object.setPrototypeOf(this, UnknownBookmarkUpdateError.prototype)
  }
}

export class UnknownMoveOriginError extends TransientError {
  public readonly code = 3
    constructor() {
    super("E003: Folder to move out of doesn't exist")
    Object.setPrototypeOf(this, UnknownMoveOriginError.prototype)
  }
}

export class UnknownMoveTargetError extends FloccusError {
  public readonly code = 4
  constructor() {
    super("E004: Folder to move into doesn't exist")
    Object.setPrototypeOf(this, UnknownMoveTargetError.prototype)
  }
}

export class UnknownFolderParentUpdateError extends TransientError {
  public readonly code = 5
    constructor() {
    super("E006: Parent of folder to update doesn't exist")
    Object.setPrototypeOf(this, UnknownFolderParentUpdateError.prototype)
  }
}

export class UnknownFolderUpdateError extends TransientError {
  public readonly code = 6
  constructor() {
    super("E006: Folder to update doesn't exist")
    Object.setPrototypeOf(this, UnknownFolderUpdateError.prototype)
  }
}

export class UnknownFolderMoveError extends TransientError {
  public readonly code = 7
    constructor() {
    super("E007: Folder to move doesn't exist")
    Object.setPrototypeOf(this, UnknownFolderMoveError.prototype)
  }
}

// code 8 is unused
// code 9 is unused

export class UnknownFolderOrderError extends TransientError {
  public readonly code = 10
  constructor() {
    super('E010: Could not find folder to order')
    Object.setPrototypeOf(this, UnknownFolderOrderError.prototype)
  }
}

export class UnknownFolderItemOrderError extends FloccusError {
  public item: string
  public readonly code = 11
    constructor(item: string) {
    super('E011: Item in folder ordering is not an actual child')
    this.item = item
    Object.setPrototypeOf(this, UnknownFolderItemOrderError.prototype)
  }
}

export class MissingItemOrderError extends FloccusError {
  public item: string
  public readonly code = 12
  constructor(item: string) {
    super("E012: Folder ordering is missing some of the folder's children")
    this.item = item
    Object.setPrototypeOf(this, MissingItemOrderError.prototype)
  }
}

export class UnknownFolderRemoveError extends TransientError {
  public readonly code = 13
  constructor() {
    super("E013: Folder to remove doesn't exist")
    Object.setPrototypeOf(this, UnknownFolderRemoveError.prototype)
  }
}

export class UnknownFolderParentRemoveError extends FloccusError {
  public readonly code = 14
  constructor() {
    super("E014: Parent folder to remove folder from doesn't exist")
    Object.setPrototypeOf(this, UnknownFolderParentRemoveError.prototype)
  }
}

export class UnexpectedServerResponseError extends TransientError {
  public readonly code = 15
  constructor() {
    super('E015: Unexpected response data from server')
    Object.setPrototypeOf(this, UnexpectedServerResponseError.prototype)
  }
}

export class RequestTimeoutError extends TransientError {
  public readonly code = 16
  constructor() {
    super('E016: Request timed out.')
    Object.setPrototypeOf(this, RequestTimeoutError.prototype)
  }
}

export class NetworkError extends TransientError {
  public readonly code = 17
  constructor() {
    super(
      'E017: Network error: Check your network connection and your profile details'
    )
    Object.setPrototypeOf(this, NetworkError.prototype)
  }
}

export class AuthenticationError extends FloccusError {
  public readonly code = 18
  constructor() {
    super("E018: Couldn't authenticate with the server.")
    Object.setPrototypeOf(this, AuthenticationError.prototype)
  }
}

export class HttpError extends TransientError {
  public readonly code = 19
  public status: number
  public method: string
  constructor(status: number, method: string) {
    super(
      `E019: HTTP status ${status}. Failed ${method} request. Check your server configuration and log.`
    )
    this.status = status
    this.method = method
    Object.setPrototypeOf(this, HttpError.prototype)
  }
}

export class ParseResponseError extends TransientError {
  public readonly code = 20
  public response: string
  constructor(response: string) {
    super('E020: Could not parse server response.')
    this.response = response
    Object.setPrototypeOf(this, ParseResponseError.prototype)
  }
}

export class InconsistentServerStateError extends TransientError {
  public readonly code = 21
  constructor() {
    super(
      'E021: Inconsistent server state. Folder is present in childorder list but not in folder tree'
    )
    Object.setPrototypeOf(this, InconsistentServerStateError.prototype)
  }
}

export class InconsistentBookmarksExistenceError extends TransientError {
  public readonly code = 22
  public folder: string
  public bookmark: string
  constructor(folder: string, bookmark: string) {
    super(
      `E022: Folder ${folder} supposedly contains non-existent bookmark ${bookmark}`
    )
    this.folder = folder
    this.bookmark = bookmark
    Object.setPrototypeOf(this, InconsistentBookmarksExistenceError.prototype)
  }
}

export class UnclearedLockFileError extends FloccusError {
  public readonly code = 23
  public lockFile: string

  constructor(lockFile:string) {
    super(`E023: Unable to clear lock file, consider deleting ${lockFile} manually.`)
    this.lockFile = lockFile
    Object.setPrototypeOf(this, UnclearedLockFileError.prototype)
  }
}

export class LockFileError extends FloccusError {
  public readonly code = 24
  public status: number
  public lockFile: string

  constructor(status:number, lockFile:string) {
    super(`E024: HTTP status ${status} while trying to determine status of lock file ${lockFile}`)
    this.status = status
    this.lockFile = lockFile
    Object.setPrototypeOf(this, LockFileError.prototype)
  }
}

export class SlashError extends FloccusError {
  public readonly code = 25
  public status: number
  public lockFile: string

  constructor() {
    super("E025: Bookmarks file setting mustn't begin with a slash: '/'")
    Object.setPrototypeOf(this, SlashError.prototype)
  }
}

export class CancelledSyncError extends FloccusError {
  public readonly code = 26
  constructor() {
    super('E026: Sync process was cancelled')
    Object.setPrototypeOf(this, CancelledSyncError.prototype)
  }
}

export class InterruptedSyncError extends TransientError {
  public readonly code = 27
  constructor() {
    super('E027: Sync process was interrupted')
    Object.setPrototypeOf(this, InterruptedSyncError.prototype)
  }
}

// code 28 is unused

export class ServersideDeletionFailsafeError extends FloccusError {
  public readonly code = 29
  public percent: number

  constructor(percent:number) {
    super(`E029: Failsafe: The current sync run would delete ${percent}% of your links on the server. Refusing to execute. Disable this failsafe in the profile settings if you want to proceed anyway.`)
    this.percent = percent
    Object.setPrototypeOf(this, ServersideDeletionFailsafeError.prototype)
  }
}

export class DecryptionError extends FloccusError {
  public readonly code = 30

  constructor() {
    super('E030: Failed to decrypt bookmarks file. The passphrase may be wrong or the file may be corrupted.')
    Object.setPrototypeOf(this, DecryptionError.prototype)
  }
}

export class GoogleDriveAuthenticationError extends FloccusError {
  public readonly code = 31
  constructor() {
    super('E031: Could not authenticate with Google Drive. Please connect floccus with your google account again.')
    Object.setPrototypeOf(this, GoogleDriveAuthenticationError.prototype)
  }
}

export class OAuthTokenError extends FloccusError {
  public readonly code = 32
  constructor() {
    super('E032: OAuth error. Token validation error. Please reconnect your Google Account.')
    Object.setPrototypeOf(this, OAuthTokenError.prototype)
  }
}

export class RedirectError extends FloccusError {
  public readonly code = 33
  constructor() {
    super("E033: Redirect detected. Please make sure the server supports the selected sync method and URL you entered is correct doesn't redirect to a different location.")
    Object.setPrototypeOf(this, RedirectError.prototype)
  }
}

export class FileUnreadableError extends FloccusError {
  public readonly code = 34
  constructor() {
    super('E034: Remote bookmarks file is unreadable. Perhaps you forgot to set an encryption passphrase, or you set the wrong file format.')
    Object.setPrototypeOf(this, FileUnreadableError.prototype)
  }
}

export class CreateBookmarkError extends FloccusError {
  public readonly code = 35
  public bookmark: Bookmark<TItemLocation>
  constructor(bookmark: Bookmark<TItemLocation>) {
    super(`E035: Failed to create the following bookmark on the server: ${bookmark.inspect()} -- Is the bookmarks app up to date?`)
    this.bookmark = bookmark
    Object.setPrototypeOf(this, CreateBookmarkError.prototype)
  }
}

export class MissingPermissionsError extends FloccusError {
  public readonly code = 36
  constructor() {
    super(`E036: Missing permissions to access the sync server`)
    Object.setPrototypeOf(this, MissingPermissionsError.prototype)
  }
}

export class ResourceLockedError extends FloccusError {
  public readonly code = 37
  constructor() {
    super(`E037: Resource is locked`)
    Object.setPrototypeOf(this, ResourceLockedError.prototype)
  }
}

export class LocalFolderNotFoundError extends FloccusError {
  public readonly code = 38
  constructor() {
    super(`E038: Could not find local folder`)
    Object.setPrototypeOf(this, LocalFolderNotFoundError.prototype)
  }
}

export class UpdateBookmarkError extends FloccusError {
  public readonly code = 39
  public bookmark: Bookmark<TItemLocation>
  constructor(bookmark: Bookmark<TItemLocation>) {
    super(`E039: Failed to update the following bookmark on the server: ${bookmark.inspect()}`)
    this.bookmark = bookmark
    Object.setPrototypeOf(this, UpdateBookmarkError.prototype)
  }
}

export class GoogleDriveSearchError extends FloccusError {
  public readonly code = 40
  constructor() {
    super('E040: Could not search for your file name in your Google Drive')
    Object.setPrototypeOf(this, GoogleDriveSearchError.prototype)
  }
}

export class FileSizeMismatch extends TransientError {
  public readonly code = 41
  constructor() {
    super(
      'E041: Remote bookmarks file size differs from the content that was actually downloaded from the server. This might be a temporary network issue. If this error persists please contact the server administrator.'
    )
    Object.setPrototypeOf(this, FileSizeMismatch.prototype)
  }
}

export class FileSizeUnknown extends FloccusError {
  public readonly code = 42
  constructor() {
    super('E042: Remote bookmarks file size could not be retrieved. It is impossible to verify that the bookmarks file was downloaded in full. If this error persists please contact the server administrator.')
    Object.setPrototypeOf(this, FileSizeUnknown.prototype)
  }
}

export class ServersideAdditionFailsafeError extends FloccusError {
  public readonly code = 43
  public percent: number

  constructor(percent:number) {
    super(`E043: Failsafe: The current sync run would increase your links count on the server by ${percent}%. Refusing to execute. Disable this failsafe in the profile settings if you want to proceed anyway.`)
    this.percent = percent
    Object.setPrototypeOf(this, ServersideAdditionFailsafeError.prototype)
  }
}

export class GitPushError extends FloccusError {
  public readonly code = 44
  public errorMessage: string

  constructor(errorMessage:string) {
    super(`E044: Git push operation failed: ${errorMessage}`)
    this.errorMessage = errorMessage
    Object.setPrototypeOf(this, GitPushError.prototype)
  }
}

export class UnexpectedFolderPathError extends FloccusError {
  public readonly code = 45
  public originalPath: string
  public newPath: string

  constructor(originalPath: string, newPath: string) {
    super(`E045: Unexpected folder path. The local sync folder for this profile used to be at '${originalPath}' but is now at '${newPath}'. Please make sure this is intended and set the local sync folder again in the profile settings.`)
    this.originalPath = originalPath
    this.newPath = newPath
    Object.setPrototypeOf(this, UnexpectedFolderPathError.prototype)
  }
}

export class InvalidUrlError extends FloccusError {
  public readonly code = 46
  public url: string

  constructor(url: string) {
    super(`E046: Invalid URL. '${url}' is not a valid URL.`)
    this.url = url
    Object.setPrototypeOf(this, InvalidUrlError.prototype)
  }
}

export class XbelParseError extends FloccusError {
  public readonly code = 47
  constructor() {
    super(`E047: Failed to parse XBEL file. The XBEL data seems to be corrupted or incomplete. You can try removing the file on the server to let floccus recreate it. Make sure to take a backup first.`)
    Object.setPrototypeOf(this, XbelParseError.prototype)
  }
}

export class MappingFailureError extends FloccusError {
  public readonly code = 48
  public id: string

  constructor(id: string) {
    super(`E048: Failed to map ID: ${id}`)
    this.id = id
    Object.setPrototypeOf(this, MappingFailureError.prototype)
  }
}

export class ClientsideAdditionFailsafeError extends FloccusError {
  public readonly code = 49
  public percent: number

  constructor(percent:number) {
    super(`E049: Failsafe: The current sync run would increase your local links count in this profile by ${percent}%. Refusing to execute. Disable this failsafe in the profile settings if you want to proceed anyway.`)
    this.percent = percent
    Object.setPrototypeOf(this, ClientsideAdditionFailsafeError.prototype)
  }
}

export class ClientsideDeletionFailsafeError extends FloccusError {
  public readonly code = 50
  public percent: number

  constructor(percent:number) {
    super(`E050: Failsafe: The current sync run would delete ${percent}% of your local links in this profile. Refusing to execute. Disable this failsafe in the profile settings if you want to proceed anyway.`)
    this.percent = percent
    Object.setPrototypeOf(this, ClientsideDeletionFailsafeError.prototype)
  }
}