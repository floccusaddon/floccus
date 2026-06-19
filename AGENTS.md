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
  - native: `src/lib/native/NativeAccountStorage.js` (`@capacitor/preferences`)
- Critical persisted keys per account: `bookmarks[<id>].cache`, `bookmarks[<id>].mappings`, `bookmarks[<id>].continuation`.
- Adapter implementations are server boundary points under `src/lib/adapters/` (Nextcloud, WebDAV, Git, Dropbox, Google Drive, Linkwarden, Karakeep, Fake).

## Build, run, and test workflows
- Install/build: `npm install`, `npm run build`.
- Dev watch loop: `npm run watch` (also syncs Capacitor assets; see `gulpfile.js`).
- Release artifacts: `npm run build-release` -> zip/xpi/crx in `builds/`.
- Static checks: `npm run lint`, `npm run typecheck`.
- Selenium integration tests: `npm test` (expects Selenium server + env vars; runner in `test/selenium-runner.js`).
- Node.js test harness: `npm run build:test-node` bundles `src/entries/test-node.js` to `dist/node-tests/fake-tests.js` via `webpack.node-tests.js`.
- Node.js test execution: `npm run test:node:fake` runs the bundled Mocha suite without a browser/WebDriver. Defaults are `FLOCCUS_TEST_ACCOUNTS=fake,fake-noCache`, `FLOCCUS_TEST_BROWSER=node`, and `CI=true`; useful knobs include `FLOCCUS_TEST` (grep), `FLOCCUS_TEST_INVERT=true`, `FLOCCUS_TEST_ACCOUNTS=...`, `FLOCCUS_TEST_SEED=...`, and `FLOCCUS_NODE_INCLUDE_BENCHMARK=true` (`npm run test:node:fake:benchmark`).
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
- The `fake-noCache` benchmark interrupt test simulates nextcloud-bookmarks: both accounts share one server `bookmarksCache` and `isAtomic() === false`; `setInterrupt()` aborts syncs mid-flight (recoverable errors are E026/E027 only — see `syncAccountWithInterrupts` in `src/test/utils.js`).
- Logs are noisy and misleading: the fuzzers (`randomTreeManipulationWithDeletion`) wrap their own `NativeTree` mutations in try/catch and `console.log` the errors, so most `E001/E002/E004` lines (stack via `NativeTree.updateBookmark`) are expected noise. The real failure is the line `Syncing failed with ...` (stack through `FakeAdapter` + `SyncProcess`).
- CI job logs interleave real-time stdout with a buffered `Logger` dump at the end, and `util.inspect` truncates trees/actions (`[Bookmark]`, `[Array]`) — scan-result/plan contents are not fully recoverable from logs; trace by item id and the `Mapping <server|local> plan` markers instead.

