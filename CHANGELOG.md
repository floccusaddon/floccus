# Changelog

## [5.4.4]

### Fixed
* fix(SyncProcess): When creating dummy bookmarks representing separators, make sure to use vertical lines on the Toolbar, and horizontal lines otherwise. (thanks to @macrogreg)
* fix(Xbel): Don't parse tag values
* fix: Throw nice error for when gdrive search fails
* fix: Clean up dependencies (#1851)
* fix(messages): Specify that the file path doesn't matter for Google Drive

## [5.4.3]

### Fixed

* fix(OptionsLinkwarden): Allow changing server folder
* fix(Storage): Don't give up when storage entry can not be parsed
* refactor(Account#setData): Accept partial data and use lock to set data (fixes hanging sync on iOS)
* fix(README): Add APK cert fingerprint
* fix(GoogleDrive|WebDAV): Try to catch more errors when file is encrypted
* enh(AutoSync): Add an explantion in settings
* [native] Try to find a valid URL when an app shares title+URL stuffed together (thanks to Andy Balaam)
* [native] Check that a URL is valid as soon as we load the Add Bookmark dialog (thanks to Andy Balaam)
* [native] Prevent saving a newly-added bookmark if the URL is bad (thanks to Andy Balaam)
* [native] Catch and log any errors we encounter when parsing a URL to display its hostname (thanks to Andy Balaam)

## [5.4.2]

(aka 5.4.2.1)

### New

* [native] enh(Search): Match partial words
* enh(Caching): Add edge:// to supported schemes
* enh: Don't produce UPDATE actions when URLs change

### Fixed

* fix(SyncProcess): Refactor mergeable functions
* fix(SyncProcess): Fix URL collisions on NC Bookmarks
* fix(SyncProcess): Shorten excessive logging of REORDER actions
* fix(Logger): Improve log redaction
* fix(NextcloudBookmarks): More info in log when requests fail
* fix(NextcloudBookmarks): Better error message when UPDATE fails
* fix(OptionsWebDAV): re-init file when bookmark_file option is changed
* fix(WebDAV): Fail when trying to sync to XBEL file with html setting and vice versa
* fix(stringifyError): inspect bookmark to avoid [object Object]
* Fix copy/paste typos for E037 & E038 error messages. (Thanks to John Hein)
* fix(WebDAV): Fix "includes is not a function" error
* fix(GoogleDrive): Log response on auth failure


## [5.4.2-alpha.1]

### New

* [native] enh(Search): Match partial words
* enh(Caching): Add edge:// to supported schemes
* enh: Don't produce UPDATE actions when URLs change

### Fixed

* fix(SyncProcess): Refactor mergeable functions
* fix(SyncProcess): Fix URL collisions on NC Bookmarks
* fix(SyncProcess): Shorten excessive logging of REORDER actions
* fix(Logger): Improve log redaction
* fix(NextcloudBookmarks): More info in log when requests fail
* fix(NextcloudBookmarks): Better error message when UPDATE fails
* fix(OptionsWebDAV): re-init file when bookmark_file option is changed
* fix(WebDAV): Fail when trying to sync to XBEL file with html setting and vice versa
* fix(stringifyError): inspect bookmark to avoid [object Object]
* Fix copy/paste typos for E037 & E038 error messages. (Thanks to John Hein)

## [5.4.1]

### Fixed

* [native] fix(AddBookmarkIntent): Folder selector was broken
* [ios] fix(design): Make top bar dark when in dark mode
* fix(NewAccount): Don't refresh page on enter in accountlable field
* fix(Bookmark): Accept url = null
* fix(NextcloudBookmarks): Remove unnecessary code
* fix(Linkwarden): Ignore bookmarks with url = null

## [5.4.0] - 2024-11-30

### New
* enh(Tree): Add confirmation before deleting items
* enh(tabs): Make merge strategy work with tabs
* [native] enh(DialogChooseFolder): Allow creating folders
* [native] enh(Drawer): Add github issues link
* [native] enh(search): Show search results from other folders
* [native] enh: Allow selecting up down sync by long press on sync button
* [native] enh: Remember sort option & sort folders first
* [native] enh: Improve search by ranking better matches higher
* enh(Account#sync): Allow forcing sync when profile is scheduled

### Fixed
* [native] fix(DialogChooseFolder): Sort folders according to sort order setting
* [native] fix(newbookmark): Use neutral user agent to get correct title
* [native] fix(Tree): Sorting by link
* [native] fix: Properly reset accounts on load
* fix(Scanner): Improve move stability with same-titled folders
* fix(GoogleDrive|WebDAV): fix _.includes is not a function error
* fix(Account#sync): Do not break lock automatically

## [5.3.4] - 2024-11-17

### Fixed

* fix(NativeTree): Set location to Local (fixes "Failed to map parentId: 0" error)
* fix(Linkwarden): Set Folder#isRoot
* fix(Linkwarden): Correctly update bookmarks on the server

## [5.3.3] - 2024-11-09

### New

* enh(Git): Mention profile label in commit message
 
### Fixed
* fix(ios/sharing-extension): Add compat for newer ios versions
* fix(GoogleDrive): includes is not a function
* fix(Update): Fix visual glitch

## [5.3.2] - 2024-11-01

### Fixed

* [iOS] Attempt to fix inbound sharing 


## [5.3.1] - 2024-10-09

### Fixed

* [native] fix(Linkwarden): Remove dispatch of REQUEST_NETWORK_PERMISSIONS
* [native] fix(Linkwarden): Options were not showing
* fix: Don't break if browser doesn't implement permissions API
* fix(GoogleDrive): Try to delete superfluous files
* fix(NextcloudBookmarks): Run javascript feature detection earlier to avoid losing javascript bookmarks upon browser start
* fix(Html): Only escape unsafe characters in HTML

## [5.3.0] - 2024-09-28

(aka v5.3.0.2)

### New

* Add support for Linkwarden

### Fixed

* fix(GoogleDrive): Sort files by modified date

## [5.3.0-beta.1] - 2024-09-12

(aka v5.3.0.1)

### New

* Add support for Linkwarden

## [5.2.7] - 2024-09-03

### Fixed

* fix: Filter out "file:" URLs when syncing tabs on firefox
* fix: Log error from google API when retrieving access token
* [native] fix: Tree comparison on RELOAD_TREE_FROM_DISK was broken
* [native] fix: make builds reproducible again
* fix(Html): Encode unsafe characters as HTML entities

## [5.2.6] - 2024-08-11

### Fixed

* chore: update capacitor/core
* fix(Update): Show floccus logo on update page
* fix: Refactor sync algorithm introducing location types (fixed 6 correctness bugs along the way)

## [5.2.5] - 2024-07-25

### Fixed
* [native] feat: warn user if URL is already bookmarked
* [native] fix: small visual fixes
* [native] fix: Automatically reload from disk when resuming app
* [native] fix: replace cordova-inappbrowser with capacitor/browser
* [native] chore: Upgrade capacitor to v6
* feat(AccountCard): Link to github issues on error
* perf(GoogleDrive, WebDav): Don't loop through all lines when finding highest ID
* feat(Telemetry): Add report problem button to Telemetry page
* feat(AccountCard): Link to github issues on error
* fix(Cancel): Improve cancel UX
* fix(NextcloudBookmarks): Increase timeout
* fix(Git): Clean up used indexedDB instances
* fix(Controller logic): Catch all 'Receiving end does not exist' errors
* fix(Account): Don't compile logs for each error
* fix(Xbel): Don't attempt to parse numbers
* fix(GoogleDrive,WebDAV): Allow passing salt in file contents
* fix(GoogleDrive): Don't free lock if it wasn't locked
* fix(Cancel): Improve cancel UX
* fix(NextcloudBookmarks): Increase timeout
* chore(package.json): Add necessary NODE_OPTIONS to scripts
* chore(ios): Update ios assets

## [5.2.4] - 2024-07-02

### Fixed

* fix(Account): Use exponential backoff instead of disabling profile after 10 errors
* [native] fix(font-size): set default font-size using cm
* fix(imports): Don't allow importing actions definitions from store/index
* [native] fix(Options): Avoid importing browser-only module
* fix(Folder#traverse)
* fix typo in README.md in git repos
* fix(Default#executeAction): fix ordering when doing bulkImport in Unidirectional strategy
* fix(NextcloudBookmarks): Make sure folder exists before appending children


## [5.2.3] - 2024-06-21

### Fixed

* fix(AccountCard): mention if profile was disabled after error
* fix(OptionsGit): Branch option didn't propagate new value

## [5.2.2] - 2024-06-16

### Fixed

* iOS: Fix sharing from apps other than Safari

## [5.2.1] - 2024-06-15

### Fixed

* fix: make history permission optional and request on demand only

## [5.2.0] - 2024-06-11

### New

* feat: Allow custom labels for profiles
* feat: Allow counting clicks with Nextcloud Bookmarks
* feat: Add some UI interventions asking for donations
* feat: Opt-in automated error reporting using Sentry

### Fixed

* fix: Don't sync scheduled profiles if they're disabled
* fix: Don't show update notification if the user doesn't use floccus
* fix: Do not run two scanners at the same time
* fix: Improve build script to avoid faulty builds
* fix: Give browser more time to breathe to avoid freezing browser
* fix: Disable profile after 10 errors in a row

## [5.1.7] - 2024-05-28

### Fixed

* [native] Don't reload tree in TREE_LOAD

## [5.1.5] - 2024-05-28

### Fixed

* [native] fix tree loading mechanism that would cause issues with syncing

## [5.1.4] - 2024-05-21

### Fixed

* [native] fix(Drawer): Add icon for git profiles
* fix: Improve locking logic
* fix(BrowserController): Don't spam setIcon warnings
* fix(Account): call onSyncFail if onSyncStart fails

## [5.1.3] - 2024-05-18

### Fixed

* [native] fix: set largeHeap to true on android + fix git settings
* fix: Improve locking logic
* fix(NextcloudBookmarks#getExistingBookmarks): Don't use search-by-url for javascript links
* fix: Make Diff#inspect() output more readable
* fix: Limit concurrency for reorderings
* fix: Improve bulkImport performance by chunking
* fix: Unhandled error "Receiving end does not exist"

## [5.1.2] - 2024-05-14

### Fixed
* fix(GoogleDrive): Catch 500 errors
* [native] fix: Reload tree on app resume
* fix(NextcloudBookmarks): Remove feature detection of 5yo features
* [native] fix(intent): Register intent activity properly
* feat(NextcloudBookmarks): Accept javascript: links
* fix(webpack): Don't set DEBUG to true in production
* fix(BrowserController#setStatusBadge): Don't throw when setting icon
* fix(Account#progressCallback): Don't error if syncProcess is not defined yet
* fix: Don't error in old Chrome versions if browser.permissions.contains fails
* fix: Wrap local tree fetch error
* fix(webpack): Split initial chunks to avoid AMO review complaining

## [5.1.1] - 2024-05-10

### Fixed

* fix(SyncProcess): Do not serialize all trees each progress tick
* fix(SyncProcess): Call progressCb 2x less
* fix(Account): Extract and unify progressCallback
* fix(SyncProcess): Limit action execution concurrency to 12
* fix(Account): Properly declare DEBUG the typescript way
* fix(syncProcess): Properly count planned actions
* fix(Git): On init don't use force push
* fix(Git): Only bulldoze the repository if HEAD or branch cannot be found
* Add optional automatic error reporting to discover dormant bugs
* fix(Unidirectional): Scanner should use mappings if possible
* fix({html,xbel} parsers): Don't replace '0' by ''
* fix: Don't set lock after freeing it
* Fix(BrowserTree): Don't load full Tree on startup

## [5.1.0] - 2024-05-05

### New
 - enh(ui): Add git adapter: You can now sync via git

### Fixed
* fix(GoogleDrive): Don't pollute console
* fix(BrowserController#getStatus): Show error icon if an account hasn't been synced in two days
* fix: Ignore errors from browser.permissions.contains
* fix: Ignore errors in REQUEST_NET_PERMS
* fix: Replace node.js' url with whatwg URL
* fix(browserslist): support and_chr >=60
* fix: Don't sync tabs if floccus' browser profile is not active
* fix(performance): Turn parallel processing back on Marcel Klehr 03.05.24, 19:30
* fix(Account#sync): Don't store continuation if the adapter is caching changes internally

## [5.0.12] - 2024-04-26

### Fixed
 - fix(tests/gdrive): Don't derive file name from seed
 - chore: Allow fuzzed testing with interrupts on nextcloud-bookmarks
 - enh(ci/tests); Use github sha as seed
 - fix: Store continuation while sync is running to be able to resume after interrupts
 - chore: Update donation methods Marcel Klehr 21.04.24, 20:57
- fix: Distinguish between InterruptedSyncError and CancelledSyncError
- [android] Include dependenciesInfo in gradle file
- [native] fix(Account): Don't try to load LocalTabs resource

## [5.0.11] - 2024-03-09

### Fixed

* fix: Android app stuck on splash screen

## [5.0.10] - 2024-03-08

### Fixed

* fix(Account#sync): Break lock after 2h
* bookmarks folder selection: Select sub folder in Vivaldi

## [5.0.9] - 2024-01-08

### Fixed

* [chrome] fix(background sync): Apply hack to keep service worker alive

## [5.0.8] - 2024-01-07

### Fixed

* fix(nextcloud login flow): Use standalone browser on iOS
* fix(manifest.firefox.json): Make sure host permission matches the one in the code

## [5.0.7] - 2024-01-04

### Fixed

* [native] Fix hanging splash screen
* fix(Controller): Remember strategy when scheduling sync after lock error
* Complete translations for Japanese, Spanish and German

## [5.0.6] - 2023-12-31

### Fixed
* fix(background sync): Move back to manifest v2 for firefox
* fix(Account#setData): re-init if localRoot is changed
* fix(Options): Fix v-switch input
* fix(Controller#scheduleSync): Allow syncing if account is disabled and scheduled

## [5.0.5] - 2023-12-20

### Fixed

* Fix: Move waiting for lock out of adapters into controller
* fix(NextcloudBookmarks): Use CapacitorHttp to avoid cors errors in capacitor 5
* fix(native/START_LOGIN_FLOW): migrate to new capacitor http API

## [5.0.4] - 2023-12-15

### Fixed

* [native] upgrade capacitor-oauth2
* [native] fix(GoogleDrive): CapacitorHttp no longer encodes x-form-urlencoded
* fix(Import): Request network permissions before import
* fix(GoogleDrive): Request network permissions before login

## [5.0.3] - 2023-12-12

### Fixed

- [native] Remove capacitor community http Marcel Klehr 36 minutes ago
- [native] fix(DialogImportBookmarks): accept="text/html"
- [android] fix(webdav): Use new builtin CapacitorHttp
- fix(Unlock with credentials): Missing await 🙈
- fix(Profile import)
- fix(options): Auto-sync option was not saved
- fix(GoogleDrive): Fix permissions.contains syntax
- fix: Always cast to string before comparing item ids
- fix(HtmlSerializer): Try to fix ordering test
- fix(HtmlSerializer): Use Cheerio.text() for getting title

## [5.0.2] - 2023-12-09

### Fixed

- Fix another XBEL parser bug
- Fix HTML parser

## [5.0.1] - 2023-12-09

### Fixed

- Fixes XBEL parser

## [5.0.0] - 2023-12-09

## New

 - Avoid syncing private tabs
 - Add a 'Sync all' button
 - Overhaul profile overview UI

## Changed

 - [browser] Migrate to Manifest v3
 - [browser] remove unlock passphrase feature
 - [native] Remove background mode because it was buggy
 - Sync 3s after startup
 - Upgrade to capacitor 5
 - Upgrade to gradle 8
 - "Accounts" are now called "Profiles"

## Fixed

 - [native] Reset profile syncing state on app start
 - [native] Allow turning auto-sync back on
 - [native] fix(AddBookmarkIntent): Close intent after saving bookmark
 - [ios] fix(sharing) Fix share target
 - Allow setting sync interval to 5min
 - Local folder option: Make more clear what each option does and the implications of that
 - Store passphrase for google-drive encryption correctly
 - NextcloudBookmarks: Do not write lock after onSyncCompleted
 - Fix bookmarks change detection
 - Fix BrowserController#onchange: Don't error out on deleted items
 - fix(FileUnreadableError): Make error message more clear
 - fix(downloadLogs): Add redacted/full to file name
 - fix(messages): Make it more clear that people need to install Nextcloud Bookmarks to use it
 - fix(BrowserController): Set unlocked to true by default
 - fix(LocalTabs): Don't activate all tabs upon creating them
 - fix(ImportExport): Trigger alert when import is done
 - fix(OptionsWebdav): properly import OptionsPassphrase component
 - fix(OptionsSyncFolder): show spinner while running getTree
 - fix(HtmlSerializer): Make html output compatible with common browsers while maintaining backward compatibility

## v4.19.1

### Fixed
 - Fix Scanner ignore logic for root folders 

## v4.19.0

### New
 - Implement share extension for iOS
 - [native] Allow sharing bookmarks to other apps
 - [native] Implement bookmarks export
 - [native] Allow exporting accounts
 - [native] Download logs like in browser instead of sharing them as text

### Fixed
 - OptionSyncInterval: Allow setting 5min
 - Avoid generating diff for local absolute root folders
 - fix(Default#executeAction): Prepapre subOrder Diff correctly
 - Allow syncing bookmarks with file: protocol via WebDAV and GDrive
 - Update dependencies

## v4.18.1

### Fixed
 - Update cordova-plugin-background-mode to fix frequent crashes
 - OptionSyncInterval: Allow setting 5minutes interval
 - DialogEditBookmark: Don't allow submitting empty URL
 - Unidirectional: ignore errors when mapping reorders

## v4.18.0

### New
- [native] Display breadcrumbs when not in root folder
- [native] Implement bookmarks import

### Fixed
 - NextcloudBookmarks: Improve error message when bookmark creation fails
 - [native] Log in production
 - [native] NewAccount: Show IMPORTEXPORT button
 - [native] Remove pull-to-refresh for now as it's buggy
 - [native] Home#checkForIntent: Fix share routine 
 - Don't cast item IDs to boolean inside if statements 
 - NextcloudBookmarks: Report all statuses > 400 as HttpError
 - [native] Options & NewAccount: Allow setting sync interval on android 
 - AccountCard: Display last sync time on error 
 - TEST_WEBDAV_SERVER: Improve error message

## v4.17.1

### Fixed
 - Fix selecting HTML at setup (#1247)
 - Fix Google Drive on native (#1246)

## v4.17.0


### New
- WebDav: Allow syncing via HTML file
- Tab Sync: Name folders by window number
- NewAccount: Add back buttons
- Options{GoogleDrive, WebDAV}: Allow removing passphrase

### Fixed
 - Fixed Google Drive integration on iOS
 - Fix Sync with caching-enabled WebDAV servers
 - [native] Use themed background for body
 - Fix Nextcloud login flow for 2FA
 - [android] Fix share intent for unreachable URLs

## v4.16.0

### New
 - Performance improvements
 - Improve speed for Nextcloud Bookmarks

### Fixed
 - SyncProcesses: Remove superfluous awaits that would stall the whole app
 - a11y: improve syncing icon in browser
 - ios: Hide status bar
 - Fix InAppBrowser usage to comply with Apple policies
 - getFavicon: Load /favicon.ico as a fallback
 - UX: Remove min-width on #app
 - Replace merge icon to avoid confusion with sync icon (#1198)
 - OptionSyncStrategy: Improve wording
 - Options: Do not show strategy if isBrowser
 - [native] Fix Alphabetical sorting

## v4.15.0

### New
- [Native] AddBookmarkIntent: Autodetect page title
- NewAccount: Allow setting enabled account config
- NewAccount: Allow setting XBEL passphrase for GoogleDrive and WebDAV
- 
### Fixed
- Fix order corruption of localRoot folder
- Tabs: Fix syncing multiple windows
- NewAccount: Warn user when using server without https
- Improve UI so there's space for translations
- NewAccount: Remove stepper headings so the whole stepper fits
- Failsafe: added Math.ceil to only allow integers
- New translations for Polish, French and Chinese

## v4.14.0

### New
- New stepwise account setup flow
- NewAccount: Trigger sync after completion
- Improve progress bar behavior
- Allow more than one separator per Folder on Nc Bookmarks
- [Native] Allow sorting bookmarks
- [Native] Background sync while on wifi

### Fixed
- [Native] Fix splash screen aspect ratio
- [Native] Make app-bar absolute instead of hide on scroll
- Improve wording around sync strategies
- BrowserController: Don't get stuck in sync loop
- GoogleDrive: Add cancel method
- Fix transifex integration
- UI: Do not show passwords in new options session
- Inactivity timeout := 7s
- [Native] Add allowNetwork to default settings
- Fix Tab sync order on firefox

## v4.13.1

### New

- [Native] Implement about page

### Fixed
- UI: Re-add accidentally removed actions

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
