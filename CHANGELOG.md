# Changelog

## v4.13.0

### New
- [native] Implement pull-to-refresh
- [native] Implement ImportExport (without export for now)
- Detect machine suspend during sync and cancel

### Fixed
 - Performance: Do not query root bookmarks folder excessively
 - [Android] Fix app label
 - [Android] Fix Nextcloud Login flow
 - Locking: Adjust LOCK_INTERVAL
 - Locking: Fix wrong usage of {set,clear}Timeout
 - Fix lock-file being locked in GoogleDrive and WebDAV
 - Fix "failed to map parentId" in Unidirectional strategy
 - Unidirectional: Fix typo
 - Unidirectional: Fix progress bar
 - Adjust lock override strategy

## v4.12.0

### New
- [Native] Schedule sync automatically after local edits
- [native] Implement Update screen
- Implement support for separators
- More beautiful status indicators
- Sync chrome:// URLs (but not on Firefox and not with Nextcloud bookmarks)
- Implement timed locks for GoogleDrive and WebDAV to reduce waiting time
- Reduce inactivity timeout to 20s

### Fixed
- [Native] Fix broken favicons
- [Native] speed-up tree navigation
- [native] Performance improvements
- [native] UX: Allow pressing BACK when adding/editing items
- UX: Improve progress bar feedback during syncing
- UX: Improve wording around sync strategies
- Performance: Avoid loading all of lodash
- Google Drive: Force upload when new account or new encryption
- Do not delete duplicate bookmarks anymore
- Tab sync: Do not remove duplicated tabs on sync and sync tab order
- Fix Unidirectional sync
- Unidirectional: Fix ordering
- LocalTabs: Implement set order
- Improve order reconciliation
- Keep local sort order of ignored items
- GoogleDrive: Fix locking
- WebDAV: Don't lock if using slave strategy


## v4.11.0

### New
- [Android] Implement allowNetwork option
- Tab sync: Sync tabs with names
- Overview: Sort disabled accounts last
- WebDAV: Reduce lock timeout to 15min
- GoogleDrive: Reduce lock timeout to 15min

### Fixes
- Fix UX: Have two "download logs" buttons instead of "anonymous" checkbox
- Fix tab sync
- Logger: Fix log redaction
- OptionsGoogleDrive: Don't show passphrase by default
- Do not reset cache after interrupted sync
- Do not reset cache after network error
- Test and fix complex move-remove interactions
- Update deps and install dark mode fix for android
- [Native] DialogEdit{Folder,Bookmark}: Use current folder

## v4.10.1

### Fixes
- [Android] Fix WebDAV and FaviconImage

## v4.10.0

### New
- Allow producing anonymized logs
- [Android] Allow moving items and choosing parent upon creation
- [Android] Allow Logs download
- [Android] SendIntent: Allow receiving title + fix cold start intent

### Fixes
- Get rid of capacitor-community/http (Fixes many unforeseen sync problems both on Android and Desktop)
- [Android] Clean up boilerplate clutter and update deps
- Styles: Add more spacing between option entries
- Fix load languages with hyphens (Thanks to @binsee)

## v4.9.0

### New
- [Android] Implement Google Auth

### Fixes
 - [Browser] Fix i18n for displaying error messages
 - OptionResetCache: Fix description l10n id
 - NextcloudBookmarks: Fix getLabel to avoid 'n@d@d' labels
 - UI: Validate URLs to be http(s)

## v4.8.7

### Fixes

 - [Android] UI: Polish active syncing state
 - [Android] Implement Nextcloud Login flow
 - [Android] Don't display irrelevant options
 - GoogleDrive: Harden OAuth using CSRF and PKCE Marcel Klehr Yesterday 13:13
 - Allow making passwords visible

## v4.8.6

### Fixes
 - build.gradle: Fix version
 - NewAccount: Link to importexport view for better discovery (only in browser)
 - [Android] Allow self-signed certificates added to the Android user cert store


## v4.8.5

### Fixes
 - [Native] Add FundDevelopment link target
 - [Native] Fix exit on back button
 - Account: Fix cancelSync
 - AccountCard: Remove indeterminate loading bar animation

## v4.8.4

### Fixes
- Implement sync cancellation properly
- [Android app] Enable webdav
- Browser: Display badge when all accounts are disabled
- Don't poll sync status
- Fix $store.secured: Take into account empty strings passphrases
- SetKey: Don't allow setting empty passphrase
- Allow unlocking by pressing enter after passphrase
- Build: Update browser targets
- NextcloudBookmarks: Don't wait for lock forever in case of unexpected status codes
- WebDAV: Catch redirect errors by default and add allowRedirects option
- Fix Error class inheritance
- WebDAV: Properly throw FileUnreadableError
- [Android app] Update gradle
- Update dependencies and fix security issues
- Upgrade webpack
- Update typescript compiler

## v4.8.3

### Fixes 
- Fix Account#init: Don't override sync tabs setting
- NextcloudBookmarks: Fix acquireLock: Error on 404

## v4.8.2

### Fixes
- Fix i18n

## v4.8.1

### Fixes
 - AccountCard: Fix spinner direction
 - Mesages: Note which bookmark types are supported
 - Update clientcert option description
 - NextcloudBookmarks: Catch auth errors on locking mechanism
 - Messages: Clarify wording of nested accounts setting
 - Messages: Add note about root folder problems
 - Sync: Recover from root folder CREATE actions
 - Try to handle Mobile bookmarks folder
 - [Android] i18n
 - [Android] Fix tree loading
 - [Android] Fix account deletion UX
 - [Android] Override back button

## v4.8.0

### Fixes
- GoogleDrive: Save & display google username after login
- Unidirectional: Do not apply failsafe when overriding server
- Don't remove items added *during* a sync run
- NextcloudBookmarks: Implement locking
- NextcloudBookmarks: Only query all bookmarks if necessary
- NextcloudBookmarks: fix BulkImport
- LocalTabs#create: Don't load all tabs at once, set new ones as discarded
- Fix isInitialized for tab sync accounts

## v4.7.0

### New
- Sync root folder by default
- NextcloudFolders: Add option to allow redirects
- New settings UI
- New error: Trying to read encrypted file without passphrase
- UX: Make AccountCard expandable and hide all non-essential stuff
- UI: Add donate page with link to it in overview
- UI: Support system dark theme
- UI: Reduce scrollbar size
- UX: Polish folder picker
- 

### Fixes
 - Various syncing correctness fixes
 - Rename NextcloudFolders to NextcloudBookmarks
 - Fix cancel sync: Cancel sync by reloading background page
 - OptionSyncInterval: Don't allow choosing 0
 - OptionDeleteAccount: Ask for confirmation fist
 - Fix tab sync: tab and window IDs are integers
 - Controller: Reset cache after interrupted sync
 - Only remove duplicates for Nextcloud
 - Sync: Invalidate cache after sync error
 - Performance: Always createIndex when cloning in Scanner
 - Fix UnidirectionalMerge: Allow reorders
 - Controller: Fix sync interval on first run
 - Fix debug logs in Firefox
 - Speedup loading new folders in NextcloudFolders
 - ImportExport: Select all accounts by default

## v4.6.4

### Fixed
A few fixes to improve syncing accuracy:

- Unidirectional: Don't map UPDATEs to old IDs, but to newly reinserted IDs
- Scanner: Don't generate UPDATEs for items that have been MOVEd
- DefaultSyncStrategy: Fix UPDATE vs REMOVE condition

## v4.6.3

Broken release.

## v4.6.2

### Fixed
- One-time strategy change: Don't get stuck on the wrong sync strategy
- UX: Highlight default strategy in AccountCards

## v4.6.1

### Fixed
UX: NextcloudFolders: Detect HTTP redirects
Improve import/export UX
messages: Fix sync{Down,Up} wording
Reimplement Unidirectional strategy
WebDAV: Accept non-encrypted file in encryption mode
GoogleDrive: Accept non-encrypted file in encryption mode

## v4.6.0

### New
- Sync via Google Drive
- Optionally encrypt your sync file
- Allow sending client certificates

### Fixed
- Fix Crypto module

## v4.5.0

### New
- Implement failsafe to prevent data loss

### Fixed
- WebDAV: Clear cache on 404
- UI: Improve options UX by opening folder settings by default as well
- Sync: Fix "Cannot find folder to move into"

## v4.4.10

### Fixed

- Diff#findChain: Prevent infinite recursions
- Fix Logger
- executeReorderings: Don't fail sync process if REORDER fails
- executeReorderings: Make sure items are unique

## v4.4.9

### Fixed
- Sync: Fix concurrentSourceTargetRemoval case
- Sync: Filter out undefined order items
- Logger#persist: Only save last sync run
- Update chrome screenshots
- Controller: Fix link to update page
- l10n: Translate extension description

## v4.4.8

### Fixed
- Fix SyncFolder Option
- NextcloudFolders: Don't throw when failing to delete a folder or bookmark
- Sync: A lot of fixes for deletions mixed with moves
- LocalTree: Don't throw when trying to remove a non-existent item
- Fix log rotation
- Fix Scanner#addReorders in case a MOVE's old parent was removed
- Sync: Don't execute REORDERs when length <= 1
- Non-merge Sync: Only compare with cache hash, not directly in order to merge concurrent on par changes

## v4.4.7

### Fixed
 - UI: NewAccount: Remove nextcloud legacy option
 - NextcloudFolders: Fix sparse trees
 - NextcloudFolders#updateBookmark: preserve intention when moving bookmarks
 - Scanner: Clone with Hash
 - Sync: Move canMergeWith detection to Scanner mergeable
 - Sync: Fix race conditions
 - Sync: Simplify scanner
 - Sync: Avoid artificial Cycles in Toposort
 - Sync: Avoid duplicate REORDERs
 - Sync: Filter out REORDERs that are invlidated from hierarchy reversal remediation
 - Sync: Avoid duplicates in concurrent hierarchy reversal detection
 - Sync: Extend detection for concurrent hierarchy reversals
 - Fix reconcileReorders
 - Fix Scanner: Account for reorders at the end

## v4.4.6

### Fixed

- NextcloudFolders: Remove webdav locking

## v4.4.5

### Fixed

- Fix: Ignore changes to browser root folder
- Fix mapping in SlaveMerge strategy

## v4.4.4

### Fixed

- Fix: Ignore changes to browser root folder

## v4.4.3

### Fixed

- Fix lock timeout to 0.5h
- Detect moves of bookmarks even when ID changed
- Fix unidirectional sync strategies when no cache is available
- NextcloudFolders: Fix _getChildren for old APIs
- Fix Merge  strategy
- NextcloudFolders: Performance improvements
- Add 403 to auth fail message

## v4.4.2

### Fixed
- Update some unclear wording in i18n strings
- Fix "sync up" and "sync down" buttons
- Reset cache on update to fix issues from v4.4.0

##  v4.4.1

### Fixed
- Fix sync cache
- Fix: Don't touch root folders
- Fix NexcloudFolders: Use lock for getBookmarkslist

##  v4.4.0

### New
- New Sync algorithm
- Implement option to sync tabs

### Fixed
- Fixed problems with old sync algorithm
- Display loading indicator for accounts overview
- Don't fail loading account if folder doesn't exist anymore
- Fix server URL validation

### Changed
- Drop support for legacy nextcloud bookmarks sync method. (Please see README for ways to migrate)

## v4.4.0-rc1

### New
- New Sync algorithm

### Fixed
- Fixed problems with old sync algorithm
- Display loading indicator for accounts overview
- Don't fail loading account if folder doesn't exist anymore

## v4.3.0

### New
 - Implement import/export of accounts

### Fixed
- UI: Account card button alignment fix
- Fix OrderTracker bug (#598)

## v4.2.6

### New
- Add option for nested accounts
- Revert "Allow syncing the same folder with multiple accounts"

### Fixed
- Try to fix unmapped children error
- Sync algorithm: XOR createdUpstream with existingChildren
- Update dependencies
- NextcloudFolders: Improve error message on non-200 response
- Update screenshots
- SyncProcess: Fix concurrency for merging
- NestedSync: Fix WebDAV and NextcloudLegacy
- WebDAV: Give up faster when lock doesn't unlock
- Permissions: We may need unlimited storage

## v4.2.5

### Fixed
WebDAV adapter: Fix bookmarks_file option

## v4.2.4

### Fixed
Refactor options event handling to fix options UX

## v4.2.3

### Fixed
87ec04ed3f92706749599502ef8fd0439cb710fe Options: Fix folder picker
a9beccedffc8d585201691a16298192fc5e98884 Fix Nextcloudlogin
d84e0e1ee5288769db9c7f220b1db72bd16b5d6a Do not auto-enable accounts on udpate

### Changed
4fa192b5b06f547ea07653a3cae28d8bc2aec396 Improve styling of ADD ACCOUNT button
a759c439483c9eab8781fede148478abc14f11eb Controller: Only display update screen for non-patch updates


## v4.2.2
### Fixed
6c1b6f5200ba4c6a25585313ab847755d24d368e Sync: Fix undefined id in folder ordering
53daaebbcd37a372a79bf9795db899899e8aec4c Fixes #557: Save options on account creation

### Changed
7b737d29951ec0707af1d249398cb39fe27dc8af OrderTracker: Throw error when invariants are violated

## v4.2.1

## Fixed
 - Fix "Cannot add new accounts"
 - Fix disabling accounts

## v4.2.0

### Added
28573b69f81b704df2b83e25bf37f2863546ffe7 Implement nextcloud flow login
316b69cd36e78471c148e5e973090e5a5abafbd8 Add an update screen
 Lots of new translations

### Fixed
4bf16e25d4e0b6f5386adb56614eb245599ec5e0 Fix for separator lines with webdav
5655e81753c13d9b94b8f6c08bdc1c74949eb569 NextcloudFolders fix non-getChildren algorithm

### Changed
a658fd02f67335b3c73b3b69e6a3bd7ac456f365 New UI using Vue.js
85c9caeb9714dc1dfdc5f8164949b9c3346c5b55 Allow syncing the same folder with multiple accounts
92bc583877359b65153a19c2c55f56ff41f99802 Don't sync immediately on startup
b7eee8e14534838f875350897576abe01a839b02 Offline Performance: Only poll status every 10s -- real updates will be on demand
454b8066ffe096c4cb264683adaf09d5c2ad7d17 NextcloudFolders: getSparseBookmarksTree: Don't load too many layers initially
2758f17fe74d8bb6603a6e674dc31d8e37ec271a Messages: Clarify DescriptionLocalfolder
956a2b6d22a5023110d5fce4063064c4a54597b9 Improve progress bar update during loadChildren


## v4.1.0
 - FIX AccountStorage: Use JSON
 - FIX Sync: Fix null pointer
 - FIX Sync: Handle creations inside deletions gracefully
 - NEW: NextcloudFolders: Speedup

## v4.0.4

- FIX: account migration code

## v4.0.3

- FIX: Add support for permanent private mode in firefox
- FIX: Remove a possible performance restriction

## v4.0.2

- FIX root folder synchronization

## v4.0.1

- FIX storage access error

## v4.0.0

- FIX: Stop sync if user is making changes
- FIX: NetxcloudFolders: Refactor sparse tree loading
- FIX: Performance optimizations
- NEW: Deprecate NextcloudLegacy adapter
- NEW: Build process: Switch to webpack
- NEW: Migrate account data from extension storage to indexedDB for faster access
- NEW: Refactor sync algorithm

## v3.5.3

- FIX: Stop sync if user is making changes
- FIX: Speed up sparse tree loading
- FIX: Refactor sparse tree loading

## v3.5.2

- FIX: Performance optimization: Only retry sparse trees if server allows hashing
- FIX: Simplify getBookmarksList
- FIX: NextcloudFolders: Increase timeout to 3min
- FIX: webdav lock acquisition mechanism
- FIX: Strategies: Refactor syncTree + always abort on cancel
- FIX: Controller: Disable account on cancelSync to avoid auto-restart

## v3.5.1

- FIX: UI: Input fields were broken

## v3.5.0

- NEW: UX: Improve "new account" flow
- NEW: UX: Make it more clear which adapter is being used in options
- NEW: Improve funding UX
- FIX: Logger: Add timestamps

## v3.4.2

- Roll back v3.4.1 due to UI issues

## v3.4.1

- NEW: Overhaul build process
- NEW: UX: Improve "new account" flow
- NEW: UX: Make it more clear which adapter is being used in options
- FIX: Logger: Add timestamps
- FIX: Translate sync duration

## v3.4.0

- NEW: Automated testing in firefox (#353)
- NEW: Add emojis to various options
- NEW: Implement cancel sync button
- NEW: Sync strategies (default/merging, slave / override browser, master / override server)
- NEW: Bulk upload for faster syncing
- FIX Account: Set rootPath on init
- FIX: Unlock enter press
- FIX: Use whatwg URL normalization

## v3.3.1

- FIX: Don't load all parts of the sparse tree in parallel

## v3.3.1

- FIX: Don't load all parts of the sparse tree in parallel

## v3.3.0

- FIX: Update conservative-normalize-url
- FIX: UI: Split path correctly to display full folder name
- FIX: NextcloudFolders: Fix Updating a bookmark that has no parent folders
- NEW: Translations
- NEW: Sparse tree syncing using hash trees
- NEW: Add option to set sync interval
- NEW: Caching adapter: Add acceptor method
- NEW: UI: Polish footer + add logo + Improve mobile support

## v3.2.16

- FIX: Don't schedule sync jobs while syncing

## v3.2.15

- FIX: URL normalizer would break some URLs with fragments

## v3.2.14

- FIX: Unlock input field

## v3.2.13

- FIX: Unlock input field

## v3.2.12

- FIX: Sync: Clear status update interval on error
- FIX: Fix form inputs

## v3.2.11

- NEW: Progress bar
- NEW: Add LoFloccus companion app (thanks to @TCB13)
- FIX: UI: Add a link to open options in new tab
- FIX: Added default font color as black to avoid issues with dark browser themes
- FIX: Tree: URL normalization: Add more strange protocols to the blacklist

## v3.2.10

- FIX: Various crucial fixes for edge cases of the sync algorithm

## v3.2.9

- FIX: Improve normalization algorithm
- FIX: Clean up duplicates caused by switching to a different normalization algorithm

## v3.2.8

- Fix: XBEL parser didn't retain ordering
- FIX: Request bookmarks in smaller chunks to avoid causing a timeout

## v3.2.7

- FIX: Fix orderPreservation algorithm
- FIX: SyncProcess: Increase performance of initial filtering
- FIX: Options UI: Rename "reset cache" option
- FIX: Fix order preservation on WebDAV
- FIX: Sync on startup if necessary

## v3.2.6

- FIX: Fix "Failed to construct 'URL'" Error

## v3.2.5

- FIX: Solve some UX issues regarding disabled accounts
- FIX: Clean up duplicates caused by switching normalization algorithm

## v3.2.4

- FIX: Use a different URL normalization library
- FIX: Correctly pass through sync effects to folder traversal logic

## v3.2.3

- FIX: Don't normalize the URLs of separators and js bookmarks to avoid deduplicating them
- FIX: Make mappings thread safe to avoid race conditions in parallel mode
- FIX: Ensure all folders are traversed when cache is empty
- FIX: Log error message to debug log on sync fail
- NEW: Add description for sync methods in UI

## v3.2.2

- FIX: Issues with syncing to nextcloud on Postgres
- FIX: Normalize webdav server URL

## v3.2.1

- FIX: Folder ordering would cause issues in some situations

## v3.2.0

- NEW: Overhaul UI
- NEW: Allow sync speedup by syncing in parallel
- FIX: Update dependencies to mitigate some minor security issues
- FIX: Speed up folder order fetching if the server supports it
- FIX a bug involving the deletion of local bookmarks

## v3.1.15

- FIX: Automatically local-only deduplicate bookmarks within local folders
- FIX: Unicode characters in passwords would cause errors

## v3.1.14

- FIX: nextcloud-folders tree construction was still broken
- FIX: Index creation was broken

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
