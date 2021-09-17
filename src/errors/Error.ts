export class FloccusError extends Error {
  public code: number
}

export class UnknownCreateTargetError extends FloccusError {
  constructor() {
    super("E001: Folder to create in doesn't exist")
    this.code = 1
  }
}

export class UnknownBookmarkUpdateError extends FloccusError {
  constructor() {
    super("E002: Bookmark to update doesn't exist anymore")
    this.code = 2
  }
}

export class UnknownMoveOriginError extends FloccusError {
  constructor() {
    super("E003: Folder to move out of doesn't exist")
    this.code = 3
  }
}

export class UnknownMoveTargetError extends FloccusError {
  constructor() {
    super("E004: Folder to move into doesn't exist")
    this.code = 4
  }
}

export class UnknownFolderParentUpdateError extends FloccusError {
  constructor() {
    super("E006: Parent of folder to update doesn't exist")
    this.code = 5
  }
}

export class UnknownFolderUpdateError extends FloccusError {
  constructor() {
    super("E006: Folder to update doesn't exist")
    this.code = 6
  }
}

export class UnknownFolderMoveError extends FloccusError {
  constructor() {
    super("E007: Folder to move doesn't exist")
    this.code = 7
  }
}

// code 8 is unused
// code 9 is unused

export class UnknownFolderOrderError extends FloccusError {
  constructor() {
    super('E010: Could not find folder to order')
    this.code = 10
  }
}

export class UnknownFolderItemOrderError extends FloccusError {
  public item: string
  constructor(item: string) {
    super('E011: Item in folder ordering is not an actual child')
    this.code = 11
    this.item = item
  }
}

export class MissingItemOrderError extends FloccusError {
  public item: string
  constructor(item: string) {
    super("E012: Folder ordering is missing some of the folder's children")
    this.code = 12
    this.item = item
  }
}

export class UnknownFolderRemoveError extends FloccusError {
  constructor() {
    super("E013: Folder to remove doesn't exist")
    this.code = 13
  }
}

export class UnknownFolderParentRemoveError extends FloccusError {
  constructor() {
    super("E014: Parent folder to remove folder from of doesn't exist")
    this.code = 14
  }
}

export class UnexpectedServerResponseError extends FloccusError {
  constructor() {
    super('E015: Unexpected response data from server')
    this.code = 15
  }
}

export class RequestTimeoutError extends FloccusError {
  constructor() {
    super('E016: Request timed out.')
    this.code = 16
  }
}

export class NetworkError extends FloccusError {
  constructor() {
    super('E017: Network error: Check your network connection and your account details')
    this.code = 17
  }
}

export class AuthenticationError extends FloccusError {
  constructor() {
    super("E018: Couldn't authenticate with the server.")
    this.code = 18
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
  }
}

export class ParseResponseError extends FloccusError {
  public response: string
  constructor(response: string) {
    super('E020: Could not parse server response. Is the bookmarks app installed on your server?')
    this.code = 20
    this.response = response
  }
}

export class InconsistentServerStateError extends FloccusError {
  constructor() {
    super('E021: Inconsistent server state. Folder is present in childorder list but not in folder tree')
    this.code = 21
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
  }
}

export class UnclearedLockFileError extends FloccusError {
  public lockFile: string

  constructor(lockFile:string) {
    super(`E023: Unable to clear lock file, consider deleting ${lockFile} manually.`)
    this.code = 23
    this.lockFile = lockFile
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
  }
}

export class SlashError extends FloccusError {
  public status: number
  public lockFile: string

  constructor() {
    super("E025: Bookmarks file setting mustn't begin with a slash: '/'")
    this.code = 25
  }
}

// code 26 is unused

export class InterruptedSyncError extends FloccusError {
  public status: number
  public lockFile: string

  constructor() {
    super('E027: Sync process was interrupted')
    this.code = 27
  }
}

// code 28 is unused

export class FailsafeError extends FloccusError {
  public percent: number

  constructor(percent:number) {
    super(`E029: Failsafe: The current sync run would delete ${percent}% of your bookmarks. Refusing to execute. Disable this failsafe in the account settings if you want to proceed anyway.`)
    this.code = 29
    this.percent = percent
  }
}

export class DecryptionError extends FloccusError {
  constructor() {
    super('E030: Failed to decrypt bookmarks file. The passphrase may be wrong or the file may be corrupted.')
    this.code = 30
  }
}

export class GoogleDriveAuthenticationError extends FloccusError {
  constructor() {
    super('E031: Could not authenticate with Google Drive. Please connect floccus with your google account again.')
    this.code = 31
  }
}

export class OAuthTokenError extends FloccusError {
  constructor() {
    super('E032: OAuth error. Token validation error. Please reconnect your Google Account.')
    this.code = 32
  }
}

export class RedirectError extends FloccusError {
  constructor() {
    super("E033: Redirect detected. Please install the Bookmarks app on your nextcloud and make sure the nextcloud URL you entered doesn't redirect to a different location.")
    this.code = 33
  }
}
