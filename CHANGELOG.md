## v2.0.6
 - FIX: Correctly escape paths in tags
 - FIX: Wait a certain time before starting sync when detecting changes
 - FIX: first run routine was called on every startup

## v2.0.5
 - FIX: Display sync folder path

## v2.0.4
 - FIX: getAllAccounts didn't have a fallback for the initial loading of the extension

## v2.0.3
 - FIX: Display error messages of multiple errors
 - FIX: Add resource locking to fix race conditions and allow more concurrency (should fix remaining issues related to creation of duplicates)
 - FIX: Refactor to only read from tree once

## v2.0.2
 - FIX: Add write lock for account storage
 - FIX: Refactor sync process to avoid creating duplicates
 - FIX: mkdirpPath: Fix break condition
 - FIX: Speed up initial tag population
 - FIX: Use more stable parallel execution helper tool

## v2.0.1
 - FIX: Don't remove folders beyond the sync folder when the last bookmark is remove
 - FIX: Declare incompatibility with Fx < v57
 - FIX: Improve error reporting

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
