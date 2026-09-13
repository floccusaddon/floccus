# AGENTS Guide for floccus

Note: All AI contributions will be carefully reviewed by the project maintainers before being merged.

## Scope and source files
- This file documents discoverable project behavior for coding agents.
- AI-instruction scan performed with glob `**/{.github/copilot-instructions.md,AGENT.md,AGENTS.md,CLAUDE.md,.cursorrules,.windsurfrules,.clinerules,.cursor/rules/**,.windsurf/rules/**,.clinerules/**,README.md}`.
- Result: only `README.md` matched (no existing agent-specific rules files were found).

## Big picture architecture
- floccus is a cross-platform bookmarks sync engine with two runtimes: browser extension and Capacitor mobile app.
- Entrypoints are minimal: `src/entries/background-script.js` (browser controller), `src/entries/options.js` (web UI), `src/entries/native.js` (native UI), `src/entries/test.js` (in-extension tests).
- Runtime abstraction is via `src/lib/Controller.ts`: browser UI talks to service worker/runtime messages; native uses direct controller implementation.
- Sync orchestration is centered in `src/lib/Account.ts`:
  - creates adapter + local tree + storage
  - runs strategy (`default` / `merge` / `unidirectional`)
  - persists cache, mappings, and continuation state
  - applies failsafes and error normalization
- Core sync algorithm lives in `src/lib/strategies/Default.ts` (multi-stage diff/reconcile/execute pipeline with resumable continuation JSON).

## Data flow and boundaries
- Flow: UI action/event -> `BrowserController`/`NativeController` -> `Account.sync()` -> strategy -> local tree + server adapter.
- Storage is per-account and platform-specific:
  - browser: `src/lib/browser/BrowserAccountStorage.js` (`browser.storage.local`)
  - native: `src/lib/native/NativeAccountStorage.js` (`@capacitor/preferences` for account data, cache and continuation; SQLite rows for the local tree and the mappings, see below)
- Critical persisted state per account: `bookmarks[<id>].cache` and `bookmarks[<id>].continuation` on both platforms, plus `bookmarks[<id>].mappings` on browser; on native the mappings and the local tree are SQLite rows instead.
- Adapter implementations are server boundary points under `src/lib/adapters/` (Nextcloud, WebDAV, Git, Dropbox, Google Drive, Linkwarden, Karakeep, Fake).

## Native tree storage (SQLite)
- Since #2357 the native local tree and the sync mappings live in a shared SQLite database (`@capacitor-community/sqlite`) instead of JSON blobs in `@capacitor/preferences`.
- `src/lib/native/NativeDatabase.ts` owns the single connection, the schema (`account_meta`, `folders`, `bookmarks`, `mappings`) and an `AsyncLock` that serializes every query/batch — the plugin accepts concurrent calls, but their transactions would interleave. `CREATE TABLE IF NOT EXISTS` does not add columns to an existing table, so later columns are backfilled by `addMissingColumns`.
- `src/lib/native/NativeTreeStore.ts` keeps one account's rows in lockstep with the in-memory tree that `NativeTree` (still a `CachingAdapter`) holds, so a change costs one row write instead of re-serializing the whole tree. Writes are queued and flushed in a microtask (`enqueue`/`flushNow`); `NativeTree#save()` therefore only persists hashes and awaits `store.flush()`, and `NativeTree#load()` hydrates the tree from rows.
- Sibling order lives in the `position` column: `CachingAdapter` only ever appends to a folder's children, so new rows get an ever increasing position (`nextPosition`); only `orderFolder` and bulk imports renumber a folder's children.
- `src/lib/native/NativeMappingsStore.ts` gets the full in-memory mappings on every persist, diffs them against what it knows to be stored, and writes only the difference. Both ids are TEXT plus a `*_numeric` flag, because a remote id like `'007'` must not come back as `7`; `LocalToServer` is authoritative and `ServerToLocal` is rebuilt on load.
- Both stores migrate once per account from the old preferences keys (`bookmarks[<id>].tree`, `bookmarks[<id>].highestId`, `bookmarks[<id>].mappings`) and then remove them; the `*_migrated` flags in `account_meta` record that this happened.
- Rows of a deleted account would otherwise stay in the shared database forever, so `NativeAccountStorage#deleteAccountData` explicitly clears the tree and mapping rows.

## Folder hashes and the tree index
- `folders.hash`/`folders.hash_settings` persist each folder's subtree hash, so a sync only re-hashes the subtrees that changed. `IHashSettings` are negotiated per sync; a hash stored under different settings is ignored (`hashCacheKey` in `src/lib/Tree.ts`). The sync cache carries its hashes too — `Account.ts`, `CacheTree` and `CachingTreeWrapper` now `clone(true)`/`copy(true)`.
- Because hashes survive across syncs now, every mutation has to invalidate them. `CachingAdapter#invalidateHashes(folderId)` walks `Folder#invalidateHashUpwards` to the root and calls the `onHashesInvalidated` hook, which `NativeTree` overrides to drop the stored rows. Any new mutation path in `src/lib/adapters/Caching.ts` — and any place that rewrites `children` directly (`Scanner`, `filterOut*` in `Default.ts`, `loadServerTree` in `Merge`/`Unidirectional`) — must do the same, or the scanner concludes that nothing changed.
- `Folder#updateIndex`/`#removeFromIndex` maintain the index incrementally along the path from the root to the item rather than rebuilding it (a rebuild is O(items × depth) on every change); anything they can't make sense of falls back to a full `createIndex()`, which is always correct. `updateIndex` always rebuilds the item's own index first, because adapters rewrite ids after inserting an item.
- Callers that replace a folder's `children` wholesale must `removeFromIndex` the old children first — the folders above still list them (see `Caching#bulkImportFolder`, `NextcloudBookmarks#loadFolderChildren`/`bulkImportFolder`).
- `FLOCCUS_VERIFY_INDEX=true` enables `Folder#assertIndexConsistent`, which cross-checks the incrementally maintained index against a full rebuild after every `CachingAdapter` mutation. It is a no-op otherwise.

## Build, run, and test workflows
- Install/build: `npm install`, `npm run build`.
- Dev watch loop: `npm run watch` (also syncs Capacitor assets; see `gulpfile.js`).
- Release artifacts: `npm run build-release` -> zip/xpi/crx in `builds/`.
- Static checks: `npm run lint`, `npm run typecheck`.
- Selenium integration tests: `npm test` (expects Selenium server + env vars; runner in `test/selenium-runner.js`).
- Node.js test harness: `npm run build:test-node` bundles `src/entries/test-node.js` to `dist/node-tests/fake-tests.js` via `webpack.node-tests.js`.
- Node.js test execution: `npm run test:node:fake` runs the bundled Mocha suite without a browser/WebDriver. Defaults are `FLOCCUS_TEST_ACCOUNTS=fake`, `FLOCCUS_TEST_BROWSER=node`, and `CI=true`; useful knobs include `FLOCCUS_TEST` (grep), `FLOCCUS_TEST_INVERT=true`, `FLOCCUS_TEST_ACCOUNTS=...`, `FLOCCUS_TEST_SEED=...`, `FLOCCUS_VERIFY_INDEX=true`, and `FLOCCUS_NODE_INCLUDE_BENCHMARK=true` (`npm run test:node:fake:benchmark`).
- Fake account types available to the harness: `fake` (atomic, cached), `fake-noCache` (atomic; the tests stub out `setCache`/`setMappings`, so every sync starts without persisted state) and `fake-nc-bookmarks` (`FakeNcBookmarksAdapter`, `isAtomic() === false`, ids that embed the parent — the stand-in for nextcloud-bookmarks). The `nodejs-fake-test` CI workflow runs a matrix of `fake` and `fake-nc-bookmarks`.
- The node harness shims Capacitor plugins via webpack aliases in `webpack.node-tests.js`; `@capacitor-community/sqlite` resolves to `src/test/node-shims/capacitor-sqlite.js`, an in-memory `sql.js` database that lives for the length of the process. `sql.js` is kept as a webpack external so it can locate its own wasm file at runtime.
- `src/test/native_storage.test.js` (in `src/test/node-suite.js`) exercises `NativeTreeStore`/`NativeMappingsStore` directly: tree round-trips, folder hash persistence/invalidation, and mapping id types.
- Appium/native Android harness: `npm run test:appium` runs `test/appium-runner.js`, which waits for an Appium server, creates an Android `UiAutomator2` session, switches into the app's `WEBVIEW`, opens the native `#/test` route, and streams Mocha logs until a `FINISHED` marker is emitted.
- Appium prerequisites: the Android app/APK must already be built and installed, and an Appium server with the `uiautomator2` driver must be running. Common env vars are `APPIUM_SERVER`, `APPIUM_DEVICE_NAME`, either `APPIUM_APP` or (`APPIUM_APP_PACKAGE` + `APPIUM_APP_ACTIVITY`), plus the same test-selection env used by the browser harness (`FLOCCUS_TEST`, `FLOCCUS_TEST_SEED`, `APP_VERSION`, `TEST_HOST`, adapter-specific credentials/tokens such as Google/Dropbox/Linkwarden/Karakeep).
- Browser-local test mode is destructive to bookmarks unless using a dedicated profile (see `README.md` test section).

## Project conventions (specific to this repo)
- Mixed JS/TS/Vue2 codebase (`allowJs: true` in `tsconfig.json`); keep edits consistent with surrounding file language.
- Lint style is strict and legacy-standard-like: single quotes, no semicolons, 2-space indent (`.eslintrc.json`).
- Adapters are registered centrally in `src/lib/Account.ts` via `AdapterFactory.register(...)` (dynamic imports).
- Sync reliability relies on continuation persistence and mapping GC; avoid "simplifying" this flow without preserving resume semantics.
- `IS_BROWSER` compile-time flag (webpack define) is the platform switch; do not branch on ad-hoc runtime checks when an existing `IS_BROWSER` path exists.

## Integration notes for safe changes
- Browser manifests differ (`manifest.firefox.json` is MV2 background page; `manifest.json`/`manifest.chrome.json` are MV3 service worker).
- `gulpfile.js` contains a guard to prevent `browser-api` leakage into native chunk (`webpackCheck`).
- Nextcloud adapter (`src/lib/adapters/NextcloudBookmarks.ts`) is the most feature-rich reference for locking, sparse tree loading, ordering, and request handling.
- If adding/changing adapters, implement `interfaces/Resource.ts` capabilities (`getCapabilities`, `isAtomic`, optional `orderFolder`/`bulkImportFolder`/`loadFolderChildren`) and verify strategy interactions.
- i18n strings live in `_locales/en/messages.json`; UI text should use i18n helpers rather than hardcoded strings.

## Sync algorithm internals (diff/reconcile)
- `Scanner` (`src/lib/Scanner.ts`) diffs `cacheTreeRoot` (always local-located) against a live tree; its `mergeable` callback returns true if items are `Mappings.mappable` (known identity) OR `canMergeWith` (weak: bookmarks by URL, folders by title). The `mappable` check is already tried first per pair.
- `canMergeWith` matches are self-healing for mappings: every match path calls `Scanner.addMapping`, which evicts the stale entry and re-points it at the matched item. So a wrong/weak pairing can't strand a mapping on a deleted id — don't assume a stale mapping originates here.
- `reconcileDiffs` in `Default.ts` builds the per-target plan; it must never plan an `UPDATE`/`MOVE` against an item that's absent from the freshly-fetched target tree (executes as E002 `UnknownBookmarkUpdateError` / E004 `UnknownMoveTargetError`). Concurrent-removal detection via `REMOVE` actions + `Diff.findChain` is best-effort; a target-tree existence check (`targetTree.findItem(type, mapId(...))`) is the robust guard.

## Debugging the node benchmark suite
- The `fake-nc-bookmarks` benchmark interrupt test simulates nextcloud-bookmarks: both accounts are wired to one shared server `bookmarksCache` and the adapter reports `isAtomic() === false`; `setInterrupt()` aborts syncs mid-flight (recoverable errors are E026/E027 only — see `syncAccountWithInterrupts` in `src/test/utils.js`). The `fake`/`fake-noCache` accounts copy the server db at sync boundaries and are atomic.
- Logs are noisy and misleading: the fuzzers (`randomTreeManipulationWithDeletion`) wrap their own `NativeTree` mutations in try/catch and `console.log` the errors, so most `E001/E002/E004` lines (stack via `NativeTree.updateBookmark`) are expected noise. The real failure is the line `Syncing failed with ...` (stack through `FakeAdapter` + `SyncProcess`).
- CI job logs interleave real-time stdout with a buffered `Logger` dump at the end, and `util.inspect` truncates trees/actions (`[Bookmark]`, `[Array]`) — scan-result/plan contents are not fully recoverable from logs; trace by item id and the `Mapping <server|local> plan` markers instead.

