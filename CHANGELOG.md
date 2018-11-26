## v3.1.13

- FIX: Removing folders on the server would fail

## v3.1.12

- FIX: Initial tree construction would mess up IDs of server bookmarks in nextcloud-folders adapter

## v3.1.11

- FIX: Deduplication wouldn't work reliably

## v3.1.10

- FIX NextcloudFolders adapter: Duplicates in different folders on the server would cause trouble

## v3.1.9

- FIX: Deduplication wouldn't work in all cases as URLs weren't normalized

## v3.1.8

- Roll back parallelization to mitigate issues that came up

## v3.1.7

- Various performance improvements
- FIX: Leave alone unaccepted bookmarks (e.g. bookmarklets and RSS bookmarks)

## v3.0.10

- Fix syncing moved folders

## v3.0.9

- Various UX improvements

## v3.0.8

- FIX: Fix WebDAV adapter

## v3.0.7

- FIX: Various XML parse and serialization issues have been fixed

## v3.0.6

- FIX: Properly decode titles in .xbel file

## v3.0.5

- FIX: Don't write account password to debug log
- FIX: Properly decode titles in .xbel file

## v3.0.4

- FIX: Root folder normalization in chrome wasn't working

## v3.0.3

- FIX: Securing accounts was broken

## v3.0.2

- NC bookmarks adapter: Discern folders and bookmarks when building initial tree
- WebDAV adapter: Don't continue with empty tree after error in onSyncStart

## v3.0.1

- nothing changed

## v3.0.0

- NEW: Rewritten sync algorithm allowing faster syncing and better extensibility with adapters
- NEW: Bookmarks app adapter can now handle duplicate URLs in different folders
- NEW: WebDAV adpater
- NEW: Refactored UI code and cleaner interface design
- NEW: 1-click Debug logs :tada:
- NEW: Bookmarks app adapter doesn't automatically tag untagged upstream bookmarks anymore
- NEW: Streamlined "sync everything" use case
- NEW: More explanations in the UI for people who don't read the manual
- FIX: Various UX improvements

## v2.2.9

- FIX: Adjust usage of fetch API to specification update

## v2.2.8

- FIX: recover account after error

## v2.2.7

- FIX: Pick up sync again after error

## v2.2.6

- FIX: Prevent parallel sync race condition

## v2.2.5

- FIX: Account cache was broken

## v2.2.4

- FIX: options wouldn't store values

## v2.2.3

- FIX: Debounce sync task to avoid peculiar failures

## v2.2.2

- FIX: Overtake canonical URLs from server

## v2.2.1

- FIX: Add default value for server path setting

## v2.2.0

- NEW: Map local sync folder to a specific server-side folder
- FIX: Performance improvements for Firefox
- FIX: Race condition removed that would cause issues because same account would be synced twice in parallel

## v2.1.0

- NEW: Allow using an extension key to secure entered credentials
- FIX: Various fixes for Firefox

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

- Recover if root bookmarks folder is gone
