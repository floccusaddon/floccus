## v2.0.0
 - NEW: Sync folder hierarchy
 - NEW: Allow custom folders to be chosen for syncing
 - NEW: Allow nesting synced folders
 - NEW: Remember last sync time per account
 - NEW: Overhauled user interface
 - NEW: Identify local duplicates and throw an error
 - FIX: Address performance problems
 - FIX: Allow deleting account when syncing
 - FIX: Ignore bookmarks with unsupported protocols
 - FIX: Sync more often (every 15min instead of 25min)
 - FIX: Call removeFromMappings on LOCALDELETE
 - FIX: Improve logging and error messages
 - FIX: Stop tracking bookmarks when they're moved outside the account scope

## v1.3.4
 - Fix normalizeURL: The relevant commit somehow didn't make it into the release builds

## v1.3.3
 - Fix normalizeUrl: Automatically add trailing slash

## v1.3.2
 - Remove automated options validation (much better to just try force sync and see the error)
 - Fix options rendering
 - Fix bookmarks not showing up on the server in some situations

## v1.3.1
 - Options panel: Fix automated connectivity check

## v1.3.0
 - Major Refactoring by modularizing code base
 - UI polishing
 - Add 'force sync' feature
 - Add account status indicator
 - Fix nc url normalization
 - Trigger sync on local changes
 - Fix floccus fodler naming

## v1.2.0
 - Switched to the new nc-bookmarks v2 API
 - Increased sync interval, to reduce cpu load

## v1.1.2
 * Recover if root bookmarks folder is gone
